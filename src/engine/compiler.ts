import { createHash } from "node:crypto";
import { z } from "zod";
import { contextGroups, jobZoneLabels } from "@/lib/career-labels";
import { kindName } from "@/lib/kinds";
import type { CareerProfile, Meta } from "@/lib/onet/types";
import { kindCodes } from "@/lib/onet/types";
import { createRng, type Rng } from "@/lib/rng";
import type { LLM } from "@/llm";
import { coverageTolerance, planSlots, rankTasks, sampleCast, type CastSlot, type Slot } from "./plan";
import {
  Personality,
  TaskSpec,
  Voice,
  Workplace,
  WorkplaceLocationKind,
  type Character,
  type Location,
  type MomentPlan,
  type WorkplaceOptions,
} from "./types";

// The career compiler (DESIGN.md §4.2): O*NET® profile + options + seed → a Workplace.
// 1. code plans the week's slots and the cast's demographics; 2. the smart tier drafts the
// content; 3. code checks the draft; 4. one repair pass, then simple fixes in code.

export const DraftCharacter = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().min(1),
  backstory: z.string().min(1),
  wants: z.string().min(1),
  agenda: z.string().min(1),
  voice: Voice,
  personality: Personality,
  workLocationKey: z.string().nullable(),
});

export const DraftMoment = z.object({
  n: z.number().int(),
  title: z.string().min(1),
  locationKey: z.string(),
  castIds: z.array(z.string()),
  onetTaskId: z.number().int(),
  setup: z.string().min(1),
  stakes: z.string().min(1),
  task: TaskSpec.nullable(),
});

export const CompilerDraft = z.object({
  setting: z.object({
    organisation: z.string().min(1),
    place: z.string().min(1),
    description: z.string().min(1),
    cultureNotes: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  cafeName: z.string().min(1),
  you: z.object({
    title: z.string().min(1),
    responsibilities: z.array(z.string().min(1)).min(2).max(5),
    workLocationKey: z.string(),
  }),
  cast: z.array(DraftCharacter),
  locations: z
    .array(z.object({ key: z.string(), name: z.string().min(1), kind: WorkplaceLocationKind, size: z.enum(["small", "medium", "large"]) }))
    .min(3)
    .max(6),
  meters: z
    .array(z.object({ key: z.string(), name: z.string().min(1), meaning: z.string().min(1), start: z.number().int().min(20).max(80) }))
    .min(2)
    .max(3),
  moments: z.array(DraftMoment),
});
export type CompilerDraft = z.infer<typeof CompilerDraft>;

export const COMPILER_SYSTEM = `You design the workplace and the week for LifeAs, a career simulator where a player lives a sped-up work week in a real job before choosing it. You receive a brief as JSON: the career (from the O*NET database: description, kinds of work, the most important tasks, working conditions), the player's options, the cast slots (id, relation, age, gender) and the week's moment slots (day, time, kind of moment, kind of work). The structure is fixed; you write the content.

What matters most:
- Honesty. The week should feel like the real job, including its ordinary parts. Routine moments are the paperwork, handovers, updates and waiting that fill real days; write them as specific and recognisable, never as filler. Pressure moments come from the job's real working conditions.
- Specific people. Each cast member is a distinct, believable person with their own wants this week and a private agenda that can create friction. Give them clearly different voices: formality, slang, language mix (fit the location; mixing languages is normal in many places), verbosity and one or two quirks. Use the age and gender in each slot as given, with names that fit the location. Don't let a role decide someone's personality.
- Moments that are real dilemmas. Each moment's setup and stakes should leave room for different reasonable choices, not one right answer.

Rules for the output:
- cast: one entry per cast slot, same id. Give boss, senior and coworkers a workLocationKey from your locations; outsiders (clients, patients, customers, students and so on) get null.
- locations: 3 to 6 rooms this workplace really has, using only the allowed kinds; keys are short lowercase words. Don't add home, café or street; those exist already and can be used as locationKey "home", "cafe" or "street".
- moments: one per slot, same n. Pick the O*NET task (by id, from the brief) that best fits the slot's kind of moment and kind of work. Every moment except routine needs at least one cast member present (castIds). Set task only for slots whose kind is "task": a 1 to 3 minute piece of the real work (write, rank, spot the mistake, choose and justify, or estimate), with items when the type needs them and a short rubric a senior would use. For every other slot, task is null.
- meters: 2 or 3 things this job keeps an eye on during a week (for example "Ward calm" or "Client trust"), each with a one-line meaning and a starting value.
- setting: the organisation, the place, one or two sentences describing it, culture notes, and the local currency code.
- Plain, concrete language. No markdown.`;

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

const DISTRICT_KEYS = ["home", "cafe", "street"];

/** Problems with a draft that the AI should fix. Empty means the draft is usable. */
export function validateDraft(draft: CompilerDraft, slots: Slot[], cast: CastSlot[], profile: CareerProfile): string[] {
  const issues: string[] = [];
  const castIds = cast.map((c) => c.id);
  const draftIds = draft.cast.map((c) => c.id);
  if (draftIds.length !== castIds.length || castIds.some((id) => !draftIds.includes(id))) {
    issues.push(`cast must have exactly one entry for each slot id: ${castIds.join(", ")}`);
  }
  const names = draft.cast.map((c) => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) issues.push("every cast member needs a different name");
  const voices = draft.cast.map((c) => `${c.voice.formality}/${c.voice.slang}/${c.voice.verbosity}/${c.voice.languageMix}`);
  if (new Set(voices).size !== voices.length) issues.push("two cast members have identical voices; make them sound different");

  const keys = draft.locations.map((l) => l.key);
  if (new Set(keys).size !== keys.length) issues.push("location keys must be unique");
  if (keys.some((k) => DISTRICT_KEYS.includes(k))) issues.push("don't add home, cafe or street as locations; they already exist");
  const anyKey = new Set([...keys, ...DISTRICT_KEYS]);
  if (!keys.includes(draft.you.workLocationKey)) issues.push(`you.workLocationKey "${draft.you.workLocationKey}" isn't one of the locations`);
  for (const c of draft.cast) {
    const relation = cast.find((s) => s.id === c.id)?.relation;
    if (relation && relation !== "outsider" && (!c.workLocationKey || !keys.includes(c.workLocationKey))) {
      issues.push(`${c.id} (${relation}) needs a workLocationKey from the locations`);
    }
  }

  const taskIds = new Set(profile.tasks.map((t) => t.id));
  const byN = new Map(draft.moments.map((m) => [m.n, m]));
  for (const slot of slots) {
    const m = byN.get(slot.n);
    if (!m) {
      issues.push(`moment ${slot.n} is missing`);
      continue;
    }
    if (!anyKey.has(m.locationKey)) issues.push(`moment ${slot.n}: locationKey "${m.locationKey}" doesn't exist`);
    if (m.castIds.some((id) => !castIds.includes(id))) issues.push(`moment ${slot.n}: castIds must come from ${castIds.join(", ")}`);
    if (slot.kind !== "routine" && m.castIds.length === 0) issues.push(`moment ${slot.n} (${slot.kind}) needs at least one cast member`);
    if (!taskIds.has(m.onetTaskId)) issues.push(`moment ${slot.n}: onetTaskId ${m.onetTaskId} isn't one of the brief's tasks`);
    if (slot.kind === "task" && !m.task) issues.push(`moment ${slot.n} is a task moment and needs a task`);
    if (slot.kind !== "task" && m.task) issues.push(`moment ${slot.n} isn't a task moment; set task to null`);
    if (m.task && ["rank", "choose", "spot"].includes(m.task.type) && m.task.items.length < 2) {
      issues.push(`moment ${slot.n}: a ${m.task.type} task needs at least two items`);
    }
  }
  if (draft.moments.length !== slots.length) issues.push(`there must be exactly ${slots.length} moments`);
  const meterKeys = draft.meters.map((m) => m.key);
  if (new Set(meterKeys).size !== meterKeys.length) issues.push("meter keys must be unique");
  return issues;
}

/** Share of the week's moments per kind of work vs the job's share; the check the plan guarantees. */
export function coverageGaps(week: Pick<MomentPlan, "workKind">[], profile: CareerProfile): { kind: string; gap: number }[] {
  const tolerance = coverageTolerance(week.length);
  return kindCodes
    .map((k) => {
      const share = week.filter((m) => m.workKind === k).length / week.length;
      return { kind: kindName(k), gap: Math.round((share - profile.kinds[k].share) * 100) };
    })
    .filter((g) => Math.abs(g.gap) > tolerance);
}

/** Simple, safe fixes for reference mistakes the repair pass didn't catch. */
export function autoFix(draft: CompilerDraft, slots: Slot[], cast: CastSlot[], profile: CareerProfile): CompilerDraft {
  const keys = draft.locations.map((l) => l.key);
  const anyKey = new Set([...keys, ...DISTRICT_KEYS]);
  const castIds = new Set(cast.map((c) => c.id));
  const taskIds = new Set(profile.tasks.map((t) => t.id));
  const fallbackTask = rankTasks(profile, 1)[0].id;
  const fallbackCast = cast.find((c) => c.relation === "coworker")?.id ?? cast[0].id;
  const workKey = keys.includes(draft.you.workLocationKey) ? draft.you.workLocationKey : keys[0];
  const seenVoices = new Set<string>();
  const verbosities = ["terse", "normal", "chatty"] as const;
  return {
    ...draft,
    you: { ...draft.you, workLocationKey: workKey },
    cast: draft.cast.map((c) => {
      const relation = cast.find((s) => s.id === c.id)?.relation;
      let fixed = relation === "outsider" || (c.workLocationKey && keys.includes(c.workLocationKey)) ? c : { ...c, workLocationKey: workKey };
      // A repeated voice gets the next verbosity that makes it unique.
      const voiceKey = (v: typeof c.voice) => `${v.formality}/${v.slang}/${v.verbosity}/${v.languageMix}`;
      for (let i = 0; i < verbosities.length && seenVoices.has(voiceKey(fixed.voice)); i++) {
        fixed = { ...fixed, voice: { ...fixed.voice, verbosity: verbosities[(verbosities.indexOf(fixed.voice.verbosity) + 1) % 3] } };
      }
      seenVoices.add(voiceKey(fixed.voice));
      return fixed;
    }),
    moments: draft.moments.map((m) => {
      const slot = slots.find((s) => s.n === m.n);
      const castInMoment = m.castIds.filter((id) => castIds.has(id));
      return {
        ...m,
        locationKey: anyKey.has(m.locationKey) ? m.locationKey : workKey,
        castIds: castInMoment.length || slot?.kind === "routine" ? castInMoment : [fallbackCast],
        onetTaskId: taskIds.has(m.onetTaskId) ? m.onetTaskId : fallbackTask,
        task: slot?.kind === "task" ? m.task : null,
      };
    }),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function assemble(
  draft: CompilerDraft,
  slots: Slot[],
  cast: CastSlot[],
  profile: CareerProfile,
  options: WorkplaceOptions,
  seed: string,
  rng: Rng,
): Workplace {
  const locId = (key: string) => `loc-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const locations: Location[] = [
    ...draft.locations.map((l) => ({ id: locId(l.key), name: l.name, kind: l.kind, size: l.size, area: "workplace" as const })),
    { id: locId("home"), name: "Home", kind: "home", size: "small", area: "district" },
    { id: locId("cafe"), name: draft.cafeName, kind: "cafe", size: "small", area: "district" },
    { id: locId("street"), name: "Street", kind: "street", size: "large", area: "district" },
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
      wants: d.wants,
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
  const id = createHash("sha256").update(JSON.stringify([profile.code, options, seed])).digest("hex").slice(0, 16);
  return Workplace.parse({
    id,
    careerCode: profile.code,
    careerTitle: profile.title,
    options,
    seed,
    setting: draft.setting,
    you: { title: draft.you.title, responsibilities: draft.you.responsibilities, workLocationId: locId(draft.you.workLocationKey) },
    cast: characters,
    locations,
    meters: draft.meters.map((m) => ({ id: `meter-${m.key}`, name: m.name, meaning: m.meaning, start: m.start })),
    week,
  });
}

export class CompileError extends Error {
  constructor(readonly issues: string[]) {
    super(`The workplace draft still has problems: ${issues.join("; ")}`);
    this.name = "CompileError";
  }
}

export async function compileWorkplace(
  { profile, meta, options, seed }: { profile: CareerProfile; meta: Meta; options: WorkplaceOptions; seed: string },
  llm: LLM,
): Promise<{ workplace: Workplace; repaired: boolean; autoFixed: string[] }> {
  const rng = createRng(`${seed}/compile`);
  const slots = planSlots(profile, options, rng.fork("slots"));
  const cast = sampleCast(options, seed, rng.fork("cast"));
  const brief = buildBrief(profile, meta, options, slots, cast);
  const base = { tier: "smart" as const, system: COMPILER_SYSTEM, schema: CompilerDraft, seedSalt: seed };

  let draft = (await llm.generate({ ...base, purpose: "compile-workplace", messages: [{ role: "user", content: brief }] })).value;
  let issues = validateDraft(draft, slots, cast, profile);
  let repaired = false;
  if (issues.length) {
    repaired = true;
    draft = (
      await llm.generate({
        ...base,
        purpose: "compile-workplace-repair",
        messages: [
          { role: "user", content: brief },
          { role: "assistant", content: JSON.stringify(draft) },
          { role: "user", content: `Fix these problems and return the whole corrected draft:\n- ${issues.join("\n- ")}` },
        ],
      })
    ).value;
    issues = validateDraft(draft, slots, cast, profile);
  }
  let autoFixed: string[] = [];
  if (issues.length) {
    autoFixed = issues;
    draft = autoFix(draft, slots, cast, profile);
    issues = validateDraft(draft, slots, cast, profile);
    if (issues.length) throw new CompileError(issues);
  }
  return { workplace: assemble(draft, slots, cast, profile, options, seed, rng.fork("assemble")), repaired, autoFixed };
}
