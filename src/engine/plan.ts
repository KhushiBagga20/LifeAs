import type { Rng } from "@/lib/rng";
import { kindCodes, type CareerProfile, type KindCode } from "@/lib/onet/types";
import type { Day, MomentKind, Relation, WorkplaceOptions } from "./types";

// Code-first planning for the career compiler (DESIGN.md §4.2 step 1). Everything here is
// decided from the seed and the O*NET® profile, before the AI writes anything, so the week's
// shape stays honest to the job whatever the model does.

export type Slot = { n: number; day: Day; time: string; kind: MomentKind; workKind: KindCode };
export type CastSlot = { id: string; relation: Relation; age: number; gender: "woman" | "man" | "nonbinary"; avatarSeed: string };

const FULL_WEEK: Record<Day, string[]> = {
  Mon: ["09:10", "11:30", "15:40"],
  Tue: ["10:00", "14:20"],
  Wed: ["09:30", "12:10", "16:00"],
  Thu: ["10:40", "15:10"],
  Fri: ["09:50", "14:30"],
};
const QUICK_SHIFT = ["09:10", "10:50", "12:40", "14:30", "16:20"];

/**
 * The shape every week must have (DESIGN.md §1.4, §4.2). The planner builds weeks this way and
 * validateWorkplace checks finished workplaces against the same rules.
 */
export const WEEK_RULES = {
  quick: { total: QUICK_SHIFT.length, pressure: { min: 1, max: 1 }, tasks: 1 },
  full: { total: Object.values(FULL_WEEK).flat().length, pressure: { min: 1, max: 2 }, tasks: 2 },
} as const;
// Also: every planned day has at least one routine moment, and the week never opens on a task
// or a pressure moment.

// Which kinds of work fit which kinds of moment best, most fitting first.
const KIND_PREFERENCE: Record<MomentKind, KindCode[]> = {
  routine: ["C", "R", "I", "S", "E", "A"],
  task: ["I", "A", "C", "R", "E", "S"],
  pressure: ["E", "S", "R", "C", "I", "A"],
  conversation: ["S", "E", "A", "I", "C", "R"],
};

const contextMean = (profile: CareerProfile, id: string) => profile.context.find((c) => c.id === id)?.mean;

/** How many moments of each kind of work, by largest remainder on the job's shares. */
export function allocateKinds(profile: CareerProfile, total: number): Record<KindCode, number> {
  const exact = kindCodes.map((k) => ({ k, value: profile.kinds[k].share * total }));
  const counts = Object.fromEntries(exact.map(({ k, value }) => [k, Math.floor(value)])) as Record<KindCode, number>;
  let left = total - Object.values(counts).reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .slice()
    .sort((a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)) || profile.kinds[b.k].share - profile.kinds[a.k].share);
  for (const { k } of byRemainder) {
    if (left-- <= 0) break;
    counts[k]++;
  }
  return counts;
}

/** Points a kind's share of the week may differ from the job's share (DESIGN.md §4.2). */
export const coverageTolerance = (total: number) => Math.max(15, Math.ceil(100 / total));

export function planSlots(profile: CareerProfile, options: WorkplaceOptions, rng: Rng): Slot[] {
  const times: { day: Day; time: string }[] =
    options.length === "quick"
      ? QUICK_SHIFT.map((time) => ({ day: "Mon" as Day, time }))
      : (Object.entries(FULL_WEEK) as [Day, string[]][]).flatMap(([day, ts]) => ts.map((time) => ({ day, time })));
  const total = times.length;

  // Moment kinds: routine every day, a pressure moment or two, a couple of real tasks.
  const kinds: (MomentKind | null)[] = times.map(() => null);
  const dayIndexes = (day: Day) => times.flatMap((t, i) => (t.day === day ? [i] : []));
  const days = [...new Set(times.map((t) => t.day))];
  for (const day of days) kinds[rng.pick(dayIndexes(day))] = "routine";

  const rules = WEEK_RULES[options.length];
  const highPressure = (contextMean(profile, "4.C.3.d.1") ?? 0) >= 4 || (contextMean(profile, "4.C.1.d.1") ?? 0) >= 3.5;
  const pressureCount = highPressure ? rules.pressure.max : rules.pressure.min;
  const taskCount = rules.tasks;
  const free = () => kinds.flatMap((k, i) => (k === null && i > 0 ? [i] : []));
  for (let i = 0; i < pressureCount; i++) kinds[rng.pick(free())] = "pressure";
  for (let i = 0; i < taskCount; i++) kinds[rng.pick(free())] = "task";
  const momentKinds = kinds.map((k) => k ?? "conversation");

  // Kinds of work: fill the allocation, giving each moment the most fitting kind still left.
  const remaining = allocateKinds(profile, total);
  const order = rng.shuffle(momentKinds.map((_, i) => i));
  const workKinds: KindCode[] = new Array(total);
  for (const i of order) {
    const kind = KIND_PREFERENCE[momentKinds[i]].find((k) => remaining[k] > 0)!;
    remaining[kind]--;
    workKinds[i] = kind;
  }

  return times.map((t, i) => ({ n: i + 1, day: t.day, time: t.time, kind: momentKinds[i], workKind: workKinds[i] }));
}

const AGE_RANGE: Record<Relation, [number, number]> = {
  boss: [34, 60],
  senior: [40, 64],
  coworker: [22, 46],
  outsider: [19, 75],
};

/** Who is in the cast and their demographics, sampled independently of role (no stereotyped casting). */
export function sampleCast(options: WorkplaceOptions, seed: string, rng: Rng): CastSlot[] {
  const relations: Relation[] =
    options.length === "quick"
      ? ["boss", "senior", "coworker", "outsider"]
      : ["boss", "senior", ...(rng.chance(0.5) ? ["coworker", "coworker"] : ["coworker"]), ...(rng.chance(0.5) ? ["outsider", "outsider"] : ["outsider"])] as Relation[];
  return relations.map((relation, i) => {
    const roll = rng.next();
    const [min, max] = AGE_RANGE[relation];
    return {
      id: `c${i + 1}`,
      relation,
      age: rng.int(min, max),
      gender: roll < 0.47 ? "woman" : roll < 0.94 ? "man" : "nonbinary",
      avatarSeed: `${seed}/cast/${i + 1}`,
    };
  });
}

/** Most important tasks first, weighting importance by how often they happen. */
export function rankTasks(profile: CareerProfile, limit = 16) {
  return profile.tasks
    .slice()
    .sort((a, b) => (b.importance ?? 2.5) * (b.frequency ?? 4) - (a.importance ?? 2.5) * (a.frequency ?? 4))
    .slice(0, limit);
}
