import { createHash } from "node:crypto";
import { z } from "zod";
import { contextGroups, jobZoneLabels } from "@/lib/career-labels";
import { kindName, kindsOfWork } from "@/lib/kinds";
import { CareerProfile, kindCodes, type KindCode, type Meta } from "@/lib/onet/types";
import { createRng, type Rng } from "@/lib/rng";
import { LLMError, type LLM } from "@/llm";
import { coverageTolerance, planSlots, rankTasks, sampleCast, WEEK_RULES, type CastSlot, type Slot } from "./plan";
import {
  days,
  Personality,
  PLAYER_ID,
  TaskSpec,
  Voice,
  Workplace,
  WorkplaceLocationKind,
  type Character,
  type Location,
  type MomentPlan,
  type WorkplaceOptions,
} from "./types";

// The career compiler, "Career Architect" (DESIGN.md §4.2): O*NET® profile + options + seed
// → a validated Workplace. The AI proposes content inside a structure decided by code; code
// validates every proposal and decides what is accepted.
//
// Stage 1  prepare    code plans slots, cast demographics, tasks, constraints and data notes
// Stage 2  generate   the smart tier drafts the content from a JSON brief
// Stage 3  validate   code checks the draft; every problem names the part it's in
// Stage 4  repair     one bounded pass that replaces only the broken parts
// Stage 5  fallback   safe fixes in code (references, links, labels that keep coverage);
//                     anything else is a typed CompileError, never a malformed workplace
// Then     assemble   build the Workplace and validate it again on its own (validateWorkplace)

/** Bump when the compiler's output for the same inputs would change, so stored workplaces aren't reused. */
export const COMPILER_VERSION = 2;

const kindNames = kindsOfWork.map((k) => k.name) as [string, ...string[]];
const KindOfWork = z.enum(kindNames);
const codeForKind = (name: string): KindCode => kindsOfWork.find((k) => k.name === name)!.code;

// ---------------------------------------------------------------------------------------------
// What the AI writes

export const DraftCharacter = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().min(1),
  backstory: z.string().min(1),
  goals: z.array(z.object({ description: z.string().min(1), involves: z.array(z.string()) })).min(1).max(2),
  agenda: z.string().min(1),
  voice: Voice,
  personality: Personality,
  workLocationKey: z.string().nullable(),
});

const DraftLocation = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: WorkplaceLocationKind,
  size: z.enum(["small", "medium", "large"]),
  /** Keys of the rooms you can walk straight to from this one. */
  nextTo: z.array(z.string()),
});
const DraftLocations = z.array(DraftLocation).min(3).max(6);

const DraftYou = z.object({
  title: z.string().min(1),
  responsibilities: z.array(z.string().min(1)).min(2).max(5),
  workLocationKey: z.string(),
});

const DraftMeters = z
  .array(z.object({ key: z.string().min(1), name: z.string().min(1), meaning: z.string().min(1), start: z.number().int().min(20).max(80) }))
  .min(2)
  .max(3);

export const DraftMoment = z.object({
  n: z.number().int(),
  title: z.string().min(1),
  /** The kind of work the written moment mostly exercises; must match the slot's. */
  kindOfWork: KindOfWork,
  locationKey: z.string(),
  castIds: z.array(z.string()),
  onetTaskId: z.number().int(),
  setup: z.string().min(1),
  stakes: z.string().min(1),
  task: TaskSpec.nullable(),
});

const DraftSetting = z.object({
  organisation: z.string().min(1),
  place: z.string().min(1),
  description: z.string().min(1),
  cultureNotes: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const CompilerDraft = z.object({
  setting: DraftSetting,
  cafeName: z.string().min(1),
  you: DraftYou,
  cast: z.array(DraftCharacter),
  locations: DraftLocations,
  meters: DraftMeters,
  moments: z.array(DraftMoment),
});
export type CompilerDraft = z.infer<typeof CompilerDraft>;

/** The repair pass returns replacements for the broken parts only. */
export const RepairPatch = z.object({
  cast: z.array(DraftCharacter),
  moments: z.array(DraftMoment),
  locations: DraftLocations.nullable(),
  you: DraftYou.nullable(),
  meters: DraftMeters.nullable(),
});
export type RepairPatch = z.infer<typeof RepairPatch>;

export const COMPILER_SYSTEM = `You design the workplace and the week for LifeAs, a career simulator where a player lives a sped-up work week in a real job before choosing it. You receive a brief as JSON: the career (from the O*NET database: description, kinds of work, the most important tasks, working conditions, and notes on what the data doesn't cover), the player's options, the cast slots (id, relation, age, gender) and the week's moment slots (day, time, kind of moment, kind of work). The structure is fixed; you write the content.

What matters most:
- Accuracy first. The occupational facts come from the brief; don't invent tasks, conditions or requirements beyond it, and where the brief's notes say data is missing, keep those details general rather than making them up. Narrative details (names, the organisation, what happens) are yours.
- Honesty. The week should feel like the real job, including its ordinary parts. Routine moments are the paperwork, handovers, updates and waiting that fill real days; write them as specific and recognisable, never as filler. Pressure moments come from the job's real working conditions.
- Specific people. Each cast member is a distinct, believable person with clear goals for this week and a private agenda that can create friction. Give them clearly different voices: formality, slang, language mix (fit the location; mixing languages is normal in many places), verbosity and one or two quirks. Use the age and gender in each slot as given, with names that fit the location. Don't let a role decide someone's personality.
- Moments that are real dilemmas. Each moment's setup and stakes should leave room for different reasonable choices, not one right answer.

Rules for the output:
- cast: one entry per cast slot, same id. Give boss, senior and coworkers a workLocationKey from your locations; outsiders (clients, patients, customers, passengers and so on) get null. Each person has 1 or 2 goals they can act on this week; "involves" lists who the goal depends on, as cast ids or "you" for the player. Boss, senior and coworkers need at least one goal that involves the player or a colleague.
- locations: 3 to 6 places this work really happens, using only the allowed kinds; keys are short lowercase words; nextTo lists the keys of places you can walk straight to (all places must be reachable from each other). Don't add home, café or street; those exist already and can be used as locationKey "home", "cafe" or "street".
- moments: one per slot, same n. Write each so it mostly exercises the slot's kind of work, and set kindOfWork to that same kind. Pick the O*NET task (by id, from the brief) that best fits the slot. Every moment except routine needs at least one cast member present (castIds). Set task only for slots whose kind is "task": a 1 to 3 minute piece of the real work (write, rank, spot the mistake, choose and justify, or estimate), with items when the type needs them and a short rubric a senior would use. For every other slot, task is null.
- meters: 2 or 3 things this job keeps an eye on during a week (for example "Ward calm" or "Client trust"), each with a one-line meaning and a starting value.
- setting: the organisation, the place, one or two sentences describing it, culture notes, and the local currency code.
- Plain, concrete language. No markdown.`;

export const REPAIR_SYSTEM = `${COMPILER_SYSTEM}

You are now repairing a draft you wrote. The message lists specific problems and which parts to replace. Return replacements only for those parts, following all the rules above, and leave everything else as it was: use an empty list or null for parts you weren't asked to replace.`;

// ---------------------------------------------------------------------------------------------
// Stage 1: prepare

export const workplaceId = (code: string, options: WorkplaceOptions, seed: string, onetVersion: string) =>
  createHash("sha256").update(JSON.stringify([code, options, seed, onetVersion, COMPILER_VERSION])).digest("hex").slice(0, 16);

/** What the O*NET data doesn't cover for this career, told to the AI and kept in the report. */
export function dataNotes(profile: CareerProfile): string[] {
  const notes: string[] = [];
  if (!profile.context.length) notes.push("No working-conditions survey for this job: keep pressure, physical conditions and hours general.");
  if (profile.tasks.every((t) => t.importance == null)) notes.push("Tasks aren't rated for importance or frequency: treat the task list as unordered.");
  if (!profile.activities.length) notes.push("No work-activity ratings for this job.");
  notes.push("The data describes work in the United States; adapt the setting to the location without changing what the job involves.");
  return notes;
}

const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

export function buildBrief(profile: CareerProfile, meta: Meta, options: WorkplaceOptions, slots: Slot[], cast: CastSlot[]): string {
  const context = new Map(profile.context.map((c) => [c.id, c]));
  const conditions = contextGroups.flatMap((g) =>
    g.items.flatMap((item) => {
      const c = context.get(item.id);
      const answer = c ? meta.context[item.id]?.categories[String(c.modal.category)] : undefined;
      return answer ? [{ condition: item.label, mostCommonAnswer: answer }] : [];
    }),
  );
  return JSON.stringify({
    career: {
      title: profile.title,
      description: profile.description,
      alsoCalled: profile.commonTitles.slice(0, 4),
      kindsOfWork: Object.fromEntries(kindCodes.map((k) => [kindName(k), fmtPct(profile.kinds[k].share)])),
      preparation: jobZoneLabels[profile.jobZone],
      tasks: rankTasks(profile).map((t) => ({
        id: t.id,
        task: t.text,
        ...(t.frequency != null ? { howOften: meta.taskFrequency[String(Math.round(t.frequency))] } : {}),
      })),
      workingConditions: conditions,
      dataNotes: dataNotes(profile),
    },
    options: {
      level: options.level,
      workplace: options.workplace || "your choice of a typical workplace for this job",
      location: options.location || "your choice of an English-speaking city",
    },
    allowedLocationKinds: WorkplaceLocationKind.options,
    cast,
    week: slots.map((s) => ({ n: s.n, day: s.day, time: s.time, kind: s.kind, kindOfWork: kindName(s.workKind) })),
  });
}

// ---------------------------------------------------------------------------------------------
// Stage 3: validate the draft

export type Issue = {
  part: "cast" | "moment" | "locations" | "you" | "meters";
  /** The cast id or moment n the problem is in, when it's in one. */
  ref?: string | number;
  problem: string;
};

const DISTRICT_KEYS = ["home", "cafe", "street"];
const voiceKey = (v: z.infer<typeof Voice>) => `${v.formality}/${v.slang}/${v.verbosity}/${v.languageMix}`;

/** The groups of keys that can reach each other through nextTo (treated as two-way). */
function components(locations: { key: string; nextTo: string[] }[]): string[][] {
  const keys = new Set(locations.map((l) => l.key));
  const links = new Map(locations.map((l) => [l.key, new Set<string>()]));
  for (const l of locations) {
    for (const k of l.nextTo) {
      if (!keys.has(k) || k === l.key) continue;
      links.get(l.key)!.add(k);
      links.get(k)!.add(l.key);
    }
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of keys) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      group.push(k);
      stack.push(...links.get(k)!);
    }
    groups.push(group);
  }
  return groups;
}

export function validateDraft(draft: CompilerDraft, slots: Slot[], cast: CastSlot[], profile: CareerProfile): Issue[] {
  const issues: Issue[] = [];
  const castIds = cast.map((c) => c.id);
  const relationOf = new Map(cast.map((c) => [c.id, c.relation]));

  // Cast: one entry per slot, distinct names and voices, actionable goals, a place to work.
  for (const id of castIds) {
    if (!draft.cast.some((c) => c.id === id)) issues.push({ part: "cast", ref: id, problem: `${id} is missing` });
  }
  for (const c of draft.cast) {
    if (!relationOf.has(c.id)) issues.push({ part: "cast", ref: c.id, problem: `${c.id} isn't one of the cast slots (${castIds.join(", ")})` });
  }
  const byName = new Map<string, string[]>();
  const byVoice = new Map<string, string[]>();
  for (const c of draft.cast) {
    byName.set(c.name.trim().toLowerCase(), [...(byName.get(c.name.trim().toLowerCase()) ?? []), c.id]);
    byVoice.set(voiceKey(c.voice), [...(byVoice.get(voiceKey(c.voice)) ?? []), c.id]);
  }
  for (const ids of byName.values()) {
    for (const id of ids.slice(1)) issues.push({ part: "cast", ref: id, problem: `has the same name as ${ids[0]}; every cast member needs a different name` });
  }
  for (const ids of byVoice.values()) {
    for (const id of ids.slice(1)) issues.push({ part: "cast", ref: id, problem: `sounds exactly like ${ids[0]}; give them a different voice` });
  }
  const keys = draft.locations.map((l) => l.key);
  for (const c of draft.cast) {
    const relation = relationOf.get(c.id);
    if (!relation) continue;
    const people = new Set([...castIds, PLAYER_ID]);
    for (const g of c.goals) {
      const unknown = g.involves.filter((x) => !people.has(x) || x === c.id);
      if (unknown.length) issues.push({ part: "cast", ref: c.id, problem: `a goal involves ${unknown.join(", ")}, which must be other cast ids or "you"` });
    }
    if (relation !== "outsider") {
      if (!c.goals.some((g) => g.involves.some((x) => x !== c.id && people.has(x)))) {
        issues.push({ part: "cast", ref: c.id, problem: "needs at least one goal that involves the player or a colleague" });
      }
      if (!c.workLocationKey || !keys.includes(c.workLocationKey)) {
        issues.push({ part: "cast", ref: c.id, problem: `(${relation}) needs a workLocationKey from the locations` });
      }
    } else if (c.workLocationKey !== null) {
      issues.push({ part: "cast", ref: c.id, problem: "is an outsider; set workLocationKey to null" });
    }
  }

  // Locations: unique keys, no district places, all reachable from each other.
  if (new Set(keys).size !== keys.length) issues.push({ part: "locations", problem: "location keys must be unique" });
  if (keys.some((k) => DISTRICT_KEYS.includes(k))) issues.push({ part: "locations", problem: "don't add home, cafe or street; they already exist" });
  const badLinks = draft.locations.flatMap((l) => l.nextTo.filter((k) => !keys.includes(k)).map((k) => `${l.key}→${k}`));
  if (badLinks.length) issues.push({ part: "locations", problem: `nextTo refers to unknown keys: ${badLinks.join(", ")}` });
  if (components(draft.locations).length > 1) issues.push({ part: "locations", problem: "every place must be reachable from every other through nextTo" });
  if (!keys.includes(draft.you.workLocationKey)) issues.push({ part: "you", problem: `workLocationKey "${draft.you.workLocationKey}" isn't one of the locations` });

  // Moments: one per slot, written for the slot's kind of work, valid references and tasks.
  const anyKey = new Set([...keys, ...DISTRICT_KEYS]);
  const taskIds = new Set(profile.tasks.map((t) => t.id));
  for (const slot of slots) {
    const m = draft.moments.find((x) => x.n === slot.n);
    if (!m) {
      issues.push({ part: "moment", ref: slot.n, problem: "is missing" });
      continue;
    }
    const at = (problem: string) => issues.push({ part: "moment", ref: slot.n, problem });
    if (codeForKind(m.kindOfWork) !== slot.workKind) {
      at(`is planned as ${kindName(slot.workKind)} work but was written as ${m.kindOfWork}; rewrite it so it mostly exercises ${kindName(slot.workKind)}`);
    }
    if (!anyKey.has(m.locationKey)) at(`locationKey "${m.locationKey}" doesn't exist`);
    const unknownCast = m.castIds.filter((id) => !castIds.includes(id));
    if (unknownCast.length) at(`castIds ${unknownCast.join(", ")} aren't in the cast (${castIds.join(", ")})`);
    if (slot.kind !== "routine" && m.castIds.length === 0) at(`is a ${slot.kind} moment and needs at least one cast member`);
    if (!taskIds.has(m.onetTaskId)) at(`onetTaskId ${m.onetTaskId} isn't one of the brief's tasks`);
    if (slot.kind === "task" && !m.task) at("is a task moment and needs a task");
    if (slot.kind !== "task" && m.task) at("isn't a task moment; set task to null");
    if (m.task && ["rank", "choose", "spot"].includes(m.task.type) && m.task.items.length < 2) at(`a ${m.task.type} task needs at least two items`);
  }

  const meterKeys = draft.meters.map((m) => m.key);
  if (new Set(meterKeys).size !== meterKeys.length) issues.push({ part: "meters", problem: "meter keys must be unique" });
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Stage 4: repair (the merge half; the call is in compileWorkplace)

export function repairRequest(issues: Issue[]) {
  return {
    problems: issues.map((i) => ({ part: i.part, ...(i.ref !== undefined ? { ref: i.ref } : {}), problem: i.problem })),
    replace: {
      cast: [...new Set(issues.filter((i) => i.part === "cast").map((i) => String(i.ref)))],
      moments: [...new Set(issues.filter((i) => i.part === "moment").map((i) => Number(i.ref)))],
      locations: issues.some((i) => i.part === "locations"),
      you: issues.some((i) => i.part === "you"),
      meters: issues.some((i) => i.part === "meters"),
    },
  };
}

/** Applies a repair: replaces only the parts that were asked for. */
export function applyPatch(draft: CompilerDraft, patch: RepairPatch, request: ReturnType<typeof repairRequest>): CompilerDraft {
  const castFix = new Map(patch.cast.filter((c) => request.replace.cast.includes(c.id)).map((c) => [c.id, c]));
  const momentFix = new Map(patch.moments.filter((m) => request.replace.moments.includes(m.n)).map((m) => [m.n, m]));
  const cast = draft.cast.map((c) => castFix.get(c.id) ?? c);
  for (const [id, c] of castFix) if (!cast.some((x) => x.id === id)) cast.push(c);
  const moments = draft.moments.map((m) => momentFix.get(m.n) ?? m);
  for (const [n, m] of momentFix) if (!moments.some((x) => x.n === n)) moments.push(m);
  return {
    ...draft,
    cast,
    moments,
    locations: request.replace.locations && patch.locations ? patch.locations : draft.locations,
    you: request.replace.you && patch.you ? patch.you : draft.you,
    meters: request.replace.meters && patch.meters ? patch.meters : draft.meters,
  };
}

// ---------------------------------------------------------------------------------------------
// Stage 5: fallback, safe fixes in code

/** Points a kind's share of the week may differ from the job's share, as {kind, gap}. */
export function coverageGaps(week: Pick<MomentPlan, "workKind">[], profile: CareerProfile): { kind: string; gap: number }[] {
  const tolerance = coverageTolerance(week.length);
  return kindCodes
    .map((k) => {
      const share = week.filter((m) => m.workKind === k).length / week.length;
      return { kind: kindName(k), gap: Math.round((share - profile.kinds[k].share) * 100) };
    })
    .filter((g) => Math.abs(g.gap) > tolerance);
}

/**
 * The "closest valid plan" (DESIGN.md §4.2): fixes that don't invent content. Wrong references
 * fall back to safe defaults, unreachable rooms get linked, a repeated voice is nudged, and a
 * moment written for a different kind of work is relabelled only if the week still matches the
 * job's mix. Returns the fixes it made; anything it can't fix stays for validation to report.
 */
export function fallbackFix(
  draft: CompilerDraft,
  slots: Slot[],
  cast: CastSlot[],
  profile: CareerProfile,
): { draft: CompilerDraft; slots: Slot[]; fixes: string[] } {
  const fixes: string[] = [];
  const keys = draft.locations.map((l) => l.key);
  const anyKey = new Set([...keys, ...DISTRICT_KEYS]);
  const castIds = new Set(cast.map((c) => c.id));
  const taskIds = new Set(profile.tasks.map((t) => t.id));
  const fallbackTask = rankTasks(profile, 1)[0].id;
  const fallbackCast = cast.find((c) => c.relation === "coworker")?.id ?? cast[0].id;
  const workKey = keys.includes(draft.you.workLocationKey) ? draft.you.workLocationKey : keys[0];
  if (workKey !== draft.you.workLocationKey) fixes.push(`player's work place set to ${workKey}`);

  // Rooms: drop unknown links, then join separate groups so everything is reachable.
  let locations = draft.locations.map((l) => ({ ...l, nextTo: l.nextTo.filter((k) => keys.includes(k) && k !== l.key) }));
  const groups = components(locations);
  for (const group of groups.slice(1)) {
    const a = groups[0][0];
    const b = group[0];
    locations = locations.map((l) => (l.key === a ? { ...l, nextTo: [...l.nextTo, b] } : l));
    fixes.push(`linked ${b} to ${a} so every place is reachable`);
  }

  const seenVoices = new Set<string>();
  const verbosities = ["terse", "normal", "chatty"] as const;
  const people = new Set([...castIds, PLAYER_ID]);
  const castOut = draft.cast.map((c) => {
    const relation = cast.find((s) => s.id === c.id)?.relation;
    let fixed = { ...c, goals: c.goals.map((g) => ({ ...g, involves: g.involves.filter((x) => people.has(x) && x !== c.id) })) };
    if (relation === "outsider" && fixed.workLocationKey !== null) {
      fixed = { ...fixed, workLocationKey: null };
      fixes.push(`${c.id}: outsiders have no work place`);
    }
    if (relation && relation !== "outsider" && !(fixed.workLocationKey && keys.includes(fixed.workLocationKey))) {
      fixed = { ...fixed, workLocationKey: workKey };
      fixes.push(`${c.id}: work place set to ${workKey}`);
    }
    for (let i = 0; i < verbosities.length && seenVoices.has(voiceKey(fixed.voice)); i++) {
      fixed = { ...fixed, voice: { ...fixed.voice, verbosity: verbosities[(verbosities.indexOf(fixed.voice.verbosity) + 1) % 3] } };
      if (!seenVoices.has(voiceKey(fixed.voice))) fixes.push(`${c.id}: verbosity changed so their voice is distinct`);
    }
    seenVoices.add(voiceKey(fixed.voice));
    return fixed;
  });

  const moments = draft.moments
    .filter((m) => slots.some((s) => s.n === m.n))
    .map((m) => {
      const slot = slots.find((s) => s.n === m.n)!;
      const castIn = m.castIds.filter((id) => castIds.has(id));
      const next = {
        ...m,
        locationKey: anyKey.has(m.locationKey) ? m.locationKey : workKey,
        castIds: castIn.length || slot.kind === "routine" ? castIn : [fallbackCast],
        onetTaskId: taskIds.has(m.onetTaskId) ? m.onetTaskId : fallbackTask,
      };
      if (next.locationKey !== m.locationKey) fixes.push(`moment ${m.n}: place set to ${workKey}`);
      if (next.castIds.length !== m.castIds.length || next.castIds.some((id, i) => id !== m.castIds[i])) fixes.push(`moment ${m.n}: unknown people removed`);
      if (next.onetTaskId !== m.onetTaskId) fixes.push(`moment ${m.n}: task set to the job's top task`);
      return next;
    });

  // Relabel a moment's kind of work to what was written, only if the week still matches the job.
  const relabelled = slots.map((s) => {
    const m = moments.find((x) => x.n === s.n);
    return m && codeForKind(m.kindOfWork) !== s.workKind ? { ...s, workKind: codeForKind(m.kindOfWork) } : s;
  });
  let slotsOut = slots;
  if (relabelled.some((s, i) => s.workKind !== slots[i].workKind)) {
    if (coverageGaps(relabelled, profile).length === 0) {
      slotsOut = relabelled;
      fixes.push("relabelled moments to the kind of work they were written for; the week still matches the job's mix");
    }
  }
  return { draft: { ...draft, cast: castOut, locations, moments }, slots: slotsOut, fixes };
}

// ---------------------------------------------------------------------------------------------
// Assemble, then validate the finished workplace on its own

const pad = (n: number) => String(n).padStart(2, "0");
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const ENTRANCE_KINDS = ["reception", "site-office", "depot", "shop-floor", "open-office"];

export function assemble(
  draft: CompilerDraft,
  slots: Slot[],
  cast: CastSlot[],
  profile: CareerProfile,
  meta: Meta,
  options: WorkplaceOptions,
  seed: string,
  rng: Rng,
): Workplace {
  const locId = (key: string) => `loc-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  // Links are made two-way; the street joins the district to the workplace's entrance.
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    links.set(a, (links.get(a) ?? new Set()).add(b));
    links.set(b, (links.get(b) ?? new Set()).add(a));
  };
  for (const l of draft.locations) for (const k of l.nextTo) link(locId(l.key), locId(k));
  const entrance = draft.locations.find((l) => ENTRANCE_KINDS.includes(l.kind)) ?? draft.locations[0];
  for (const k of ["home", "cafe"]) link(locId("street"), locId(k));
  link(locId("street"), locId(entrance.key));
  const adjacent = (id: string) => [...(links.get(id) ?? [])].sort();

  const locations: Location[] = [
    ...draft.locations.map((l) => ({ id: locId(l.key), name: l.name, kind: l.kind, size: l.size, area: "workplace" as const, adjacentIds: adjacent(locId(l.key)) })),
    { id: locId("home"), name: "Home", kind: "home", size: "small", area: "district", adjacentIds: adjacent(locId("home")) },
    { id: locId("cafe"), name: draft.cafeName, kind: "cafe", size: "small", area: "district", adjacentIds: adjacent(locId("cafe")) },
    { id: locId("street"), name: "Street", kind: "street", size: "large", area: "district", adjacentIds: adjacent(locId("street")) },
  ];
  const characters: Character[] = cast.map((slot) => {
    const d = draft.cast.find((c) => c.id === slot.id)!;
    const works = slot.relation !== "outsider" && d.workLocationKey;
    const lateness = Math.round((1 - d.personality.conscientiousness) * 35) + rng.int(0, 12);
    return {
      id: slot.id,
      name: d.name,
      role: d.role,
      relation: slot.relation,
      age: slot.age,
      gender: slot.gender,
      avatarSeed: slot.avatarSeed,
      backstory: d.backstory,
      goals: d.goals.map((g, i) => ({ id: `${slot.id}-g${i + 1}`, description: g.description, involves: g.involves, status: "open" as const })),
      agenda: d.agenda,
      voice: d.voice,
      personality: d.personality,
      workLocationId: works ? locId(d.workLocationKey!) : null,
      routine: works
        ? {
            arrive: addMinutes("08:20", lateness),
            lunch: addMinutes("12:00", rng.int(0, 18) * 5),
            leave: addMinutes("17:00", rng.int(0, 14) * 5 + (slot.relation === "boss" ? 20 : 0)),
          }
        : null,
    };
  });
  const week: MomentPlan[] = slots.map((slot) => {
    const m = draft.moments.find((x) => x.n === slot.n)!;
    return {
      id: `m${slot.n}`,
      n: slot.n,
      day: slot.day,
      time: slot.time,
      kind: slot.kind,
      workKind: slot.workKind,
      onetTaskId: m.onetTaskId,
      locationId: locId(m.locationKey),
      castIds: m.castIds,
      title: m.title,
      setup: m.setup,
      stakes: m.stakes,
      task: slot.kind === "task" ? m.task : null,
    };
  });
  return Workplace.parse({
    id: workplaceId(profile.code, options, seed, meta.version),
    careerCode: profile.code,
    careerTitle: profile.title,
    options,
    seed,
    sources: { onetVersion: meta.version, compilerVersion: COMPILER_VERSION },
    setting: draft.setting,
    you: { title: draft.you.title, responsibilities: draft.you.responsibilities, workLocationId: locId(draft.you.workLocationKey) },
    cast: characters,
    locations,
    meters: draft.meters.map((m) => ({ id: `meter-${m.key}`, name: m.name, meaning: m.meaning, start: m.start })),
    week,
  });
}

const dupes = (items: string[]) => [...new Set(items.filter((x, i) => items.indexOf(x) !== i))];
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/**
 * Checks a finished Workplace on its own terms, independently of the draft checks, so nothing
 * malformed reaches the engine whatever produced it. Empty means valid.
 */
export function validateWorkplace(wp: Workplace, profile: CareerProfile): string[] {
  const issues: string[] = [];
  const parsed = Workplace.safeParse(wp);
  if (!parsed.success) return [`doesn't match the Workplace schema: ${z.prettifyError(parsed.error)}`];
  if (wp.careerCode !== profile.code) issues.push(`built for ${wp.careerCode}, not ${profile.code}`);

  // Identity: every id is unique.
  for (const [what, ids] of [
    ["cast", wp.cast.map((c) => c.id)],
    ["location", wp.locations.map((l) => l.id)],
    ["meter", wp.meters.map((m) => m.id)],
    ["moment", wp.week.map((m) => m.id)],
    ["goal", wp.cast.flatMap((c) => c.goals.map((g) => g.id))],
  ] as const) {
    for (const id of dupes([...ids])) issues.push(`${what} id ${id} is used twice`);
  }
  if (dupes(wp.cast.map((c) => c.name.trim().toLowerCase())).length) issues.push("two cast members share a name");
  if (dupes(wp.cast.map((c) => voiceKey(c.voice))).length) issues.push("two cast members have identical voices");

  // Places: references resolve, links are two-way, the district is there and connected.
  const locations = new Map(wp.locations.map((l) => [l.id, l]));
  const workplaceIds = wp.locations.filter((l) => l.area === "workplace").map((l) => l.id);
  for (const l of wp.locations) {
    for (const a of l.adjacentIds) {
      if (!locations.has(a)) issues.push(`${l.id} links to unknown place ${a}`);
      else if (!locations.get(a)!.adjacentIds.includes(l.id)) issues.push(`${l.id}→${a} isn't two-way`);
    }
  }
  const district = wp.locations.filter((l) => l.area === "district").map((l) => l.kind).sort();
  if (district.join() !== "cafe,home,street") issues.push(`the district must be home, café and street, not ${district.join(", ")}`);
  const reachable = new Set<string>();
  const stack = [wp.locations[0].id];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...(locations.get(id)?.adjacentIds ?? []));
  }
  if (reachable.size !== wp.locations.length) issues.push("not every place is reachable from every other");
  if (!workplaceIds.includes(wp.you.workLocationId)) issues.push(`the player's work place ${wp.you.workLocationId} isn't in the workplace`);

  // People: the required cast, consistent routines and actionable goals.
  const relations = wp.cast.map((c) => c.relation);
  for (const r of ["boss", "senior", "coworker", "outsider"] as const) {
    if (!relations.includes(r)) issues.push(`the cast has no ${r}`);
  }
  const people = new Set([...wp.cast.map((c) => c.id), PLAYER_ID]);
  for (const c of wp.cast) {
    for (const g of c.goals) {
      for (const x of g.involves) if (!people.has(x) || x === c.id) issues.push(`${g.id} involves ${x}, who isn't someone else in the workplace`);
    }
    if (c.relation === "outsider") {
      if (c.workLocationId || c.routine) issues.push(`${c.id} is an outsider but has a work place or routine`);
      continue;
    }
    if (!c.workLocationId || !workplaceIds.includes(c.workLocationId)) issues.push(`${c.id} has no work place in the workplace`);
    if (!c.routine || !(minutes(c.routine.arrive) < minutes(c.routine.lunch) && minutes(c.routine.lunch) < minutes(c.routine.leave))) {
      issues.push(`${c.id}'s routine must arrive, then lunch, then leave`);
    }
    if (!c.goals.some((g) => g.involves.length > 0)) issues.push(`${c.id} has no goal involving the player or a colleague`);
  }

  // The week: the required shape, valid references and real tasks.
  const rules = WEEK_RULES[wp.options.length];
  if (wp.week.length !== rules.total) issues.push(`a ${wp.options.length} week has ${rules.total} moments, not ${wp.week.length}`);
  const ns = wp.week.map((m) => m.n);
  if (ns.some((n, i) => n !== i + 1)) issues.push("moments must be numbered 1, 2, 3… in order");
  const order = wp.week.map((m) => days.indexOf(m.day) * 1440 + minutes(m.time));
  if (order.some((t, i) => i > 0 && t <= order[i - 1])) issues.push("moments must be in time order");
  const count = (k: MomentPlan["kind"]) => wp.week.filter((m) => m.kind === k).length;
  if (count("pressure") < rules.pressure.min || count("pressure") > rules.pressure.max) {
    issues.push(`needs ${rules.pressure.min}–${rules.pressure.max} pressure moments, has ${count("pressure")}`);
  }
  if (count("task") !== rules.tasks) issues.push(`needs ${rules.tasks} task moments, has ${count("task")}`);
  for (const day of new Set(wp.week.map((m) => m.day))) {
    if (!wp.week.some((m) => m.day === day && m.kind === "routine")) issues.push(`${day} has no routine moment`);
  }
  if (wp.week[0] && ["task", "pressure"].includes(wp.week[0].kind)) issues.push("the week can't open on a task or pressure moment");
  const taskIds = new Set(profile.tasks.map((t) => t.id));
  const castIds = new Set(wp.cast.map((c) => c.id));
  for (const m of wp.week) {
    if (!locations.has(m.locationId)) issues.push(`${m.id} is at unknown place ${m.locationId}`);
    for (const id of m.castIds) if (!castIds.has(id)) issues.push(`${m.id} includes unknown person ${id}`);
    if (m.kind !== "routine" && m.castIds.length === 0) issues.push(`${m.id} (${m.kind}) has nobody in it`);
    if (!taskIds.has(m.onetTaskId)) issues.push(`${m.id} refers to task ${m.onetTaskId}, which isn't in the O*NET profile`);
    if ((m.kind === "task") !== (m.task !== null)) issues.push(`${m.id}: only task moments have a task`);
    if (m.task && ["rank", "choose", "spot"].includes(m.task.type) && m.task.items.length < 2) issues.push(`${m.id}: a ${m.task.type} task needs items`);
  }
  for (const g of coverageGaps(wp.week, profile)) {
    issues.push(`${g.kind} is ${g.gap > 0 ? "+" : ""}${g.gap} points off the job's share (tolerance ${coverageTolerance(wp.week.length)})`);
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// The pipeline

export type CompileFailure = "invalid" | "provider" | "budget" | "refusal" | "data";

export class CompileError extends Error {
  constructor(
    readonly reason: CompileFailure,
    readonly issues: string[],
    options?: { cause?: unknown },
  ) {
    super(`Couldn't compile the workplace (${reason}): ${issues.join("; ")}`, options);
    this.name = "CompileError";
  }
}

export type CompileReport = {
  /** AI generate calls made (each may include one schema retry inside the AI layer). */
  calls: number;
  repairIssues: string[];
  fallbackFixes: string[];
  dataNotes: string[];
};

const MAX_GENERATE_CALLS = 2;

function asCompileError(error: unknown, stage: string): CompileError {
  if (error instanceof LLMError) {
    const reason: CompileFailure = error.kind === "truncated" ? "invalid" : error.kind;
    return new CompileError(reason, [`${stage}: ${error.message}`], { cause: error });
  }
  throw error;
}

export async function compileWorkplace(
  { profile, meta, options, seed }: { profile: CareerProfile; meta: Meta; options: WorkplaceOptions; seed: string },
  llm: LLM,
): Promise<{ workplace: Workplace; report: CompileReport }> {
  // Stage 1: prepare.
  const checked = CareerProfile.safeParse(profile);
  if (!checked.success) throw new CompileError("data", [`the career profile is invalid: ${z.prettifyError(checked.error)}`]);
  if (!profile.tasks.length) throw new CompileError("data", ["the career has no tasks in the O*NET data"]);
  // The career is part of every random draw, so careers sharing a seed don't share a cast.
  const careerSeed = `${profile.code}/${seed}`;
  const rng = createRng(`${careerSeed}/compile`);
  let slots = planSlots(profile, options, rng.fork("slots"));
  const cast = sampleCast(options, careerSeed, rng.fork("cast"));
  const brief = buildBrief(profile, meta, options, slots, cast);
  const report: CompileReport = { calls: 0, repairIssues: [], fallbackFixes: [], dataNotes: dataNotes(profile) };

  // Stage 2: generate.
  let draft: CompilerDraft;
  try {
    report.calls++;
    draft = (
      await llm.generate({
        tier: "smart",
        purpose: "compile-workplace",
        system: COMPILER_SYSTEM,
        messages: [{ role: "user", content: brief }],
        schema: CompilerDraft,
        seedSalt: seed,
      })
    ).value;
  } catch (error) {
    throw asCompileError(error, "draft");
  }

  // Stage 3: validate.
  let issues = validateDraft(draft, slots, cast, profile);

  // Stage 4: one repair pass for the broken parts only.
  if (issues.length && report.calls < MAX_GENERATE_CALLS) {
    report.repairIssues = issues.map((i) => `${i.part}${i.ref !== undefined ? ` ${i.ref}` : ""}: ${i.problem}`);
    const request = repairRequest(issues);
    try {
      report.calls++;
      const patch = (
        await llm.generate({
          tier: "smart",
          purpose: "compile-workplace-repair",
          system: REPAIR_SYSTEM,
          messages: [
            { role: "user", content: brief },
            { role: "assistant", content: JSON.stringify(draft) },
            { role: "user", content: JSON.stringify(request) },
          ],
          schema: RepairPatch,
          seedSalt: seed,
        })
      ).value;
      draft = applyPatch(draft, patch, request);
    } catch (error) {
      // A failed repair isn't fatal: the fallback below may still produce a valid plan.
      if (!(error instanceof LLMError)) throw error;
      report.repairIssues.push(`repair call failed: ${error.kind}`);
    }
    issues = validateDraft(draft, slots, cast, profile);
  }

  // Stage 5: fallback.
  if (issues.length) {
    const fixed = fallbackFix(draft, slots, cast, profile);
    draft = fixed.draft;
    slots = fixed.slots;
    report.fallbackFixes = fixed.fixes;
    issues = validateDraft(draft, slots, cast, profile);
    if (issues.length) {
      throw new CompileError("invalid", issues.map((i) => `${i.part}${i.ref !== undefined ? ` ${i.ref}` : ""}: ${i.problem}`));
    }
  }

  // Assemble and check the finished workplace independently.
  const workplace = assemble(draft, slots, cast, profile, meta, options, seed, rng.fork("assemble"));
  const problems = validateWorkplace(workplace, profile);
  if (problems.length) throw new CompileError("invalid", problems);
  return { workplace, report };
}
