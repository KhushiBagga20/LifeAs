import { z } from "zod";
import { KindCode } from "@/lib/onet/types";

// The simulated workplace and week (DESIGN.md §1.4, §1.5, §4.1). Code decides the structure
// (slots, demographics, ids, district); the career compiler's AI draft fills in the content.

export const days = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export const Day = z.enum(days);
export type Day = z.infer<typeof Day>;

export const momentKinds = ["conversation", "task", "routine", "pressure"] as const;
export const MomentKind = z.enum(momentKinds);
export type MomentKind = z.infer<typeof MomentKind>;

/** Rooms the map can draw. The district kinds are added by code, never chosen by the AI. */
export const workplaceLocationKinds = [
  "open-office",
  "private-office",
  "meeting-room",
  "break-room",
  "reception",
  "ward",
  "nurses-station",
  "clinic-room",
  "lab",
  "classroom",
  "staff-room",
  "commercial-kitchen",
  "dining-room",
  "workshop",
  "site",
  "site-office",
  "studio",
  "shop-floor",
  "stockroom",
  "courtroom",
  "library",
  "server-room",
] as const;
export const districtLocationKinds = ["home", "cafe", "street"] as const;
export const LocationKind = z.enum([...workplaceLocationKinds, ...districtLocationKinds]);
export type LocationKind = z.infer<typeof LocationKind>;
export const WorkplaceLocationKind = z.enum(workplaceLocationKinds);

export const relations = ["boss", "senior", "coworker", "outsider"] as const;
export const Relation = z.enum(relations);
export type Relation = z.infer<typeof Relation>;

export const Voice = z.object({
  formality: z.enum(["formal", "neutral", "casual"]),
  slang: z.enum(["none", "some", "lots"]),
  /** e.g. "English", "English with some Hindi". */
  languageMix: z.string().min(1),
  verbosity: z.enum(["terse", "normal", "chatty"]),
  quirks: z.array(z.string().min(1)).min(1).max(2),
});
export type Voice = z.infer<typeof Voice>;

export const Personality = z.object({
  openness: z.number().min(0).max(1),
  conscientiousness: z.number().min(0).max(1),
  extraversion: z.number().min(0).max(1),
  agreeableness: z.number().min(0).max(1),
  neuroticism: z.number().min(0).max(1),
});
export type Personality = z.infer<typeof Personality>;

const Time = z.string().regex(/^\d{2}:\d{2}$/);

export const Routine = z.object({ arrive: Time, lunch: Time, leave: Time });
export type Routine = z.infer<typeof Routine>;

export const Character = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().min(1),
  relation: Relation,
  age: z.number().int().min(18).max(80),
  gender: z.enum(["woman", "man", "nonbinary"]),
  avatarSeed: z.string(),
  backstory: z.string().min(1),
  wants: z.string().min(1),
  agenda: z.string().min(1),
  voice: Voice,
  personality: Personality,
  /** Where they spend the working day; outsiders have none and only appear in moments. */
  workLocationId: z.string().nullable(),
  routine: Routine.nullable(),
});
export type Character = z.infer<typeof Character>;

export const Location = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: LocationKind,
  size: z.enum(["small", "medium", "large"]),
  area: z.enum(["workplace", "district"]),
});
export type Location = z.infer<typeof Location>;

export const Meter = z.object({
  id: z.string(),
  name: z.string().min(1),
  meaning: z.string().min(1),
  start: z.number().int().min(0).max(100),
});
export type Meter = z.infer<typeof Meter>;

export const TaskSpec = z.object({
  type: z.enum(["write", "rank", "spot", "choose", "estimate"]),
  prompt: z.string().min(1),
  /** For rank, choose and spot: the things to order, pick from or check. */
  items: z.array(z.string().min(1)).max(6),
  rubric: z.array(z.string().min(1)).min(2).max(4),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

export const MomentPlan = z.object({
  n: z.number().int().min(1),
  day: Day,
  time: Time,
  kind: MomentKind,
  /** The kind of work this moment stands for (one per moment keeps the fit maths simple). */
  workKind: KindCode,
  onetTaskId: z.number().int(),
  locationId: z.string(),
  castIds: z.array(z.string()),
  title: z.string().min(1),
  setup: z.string().min(1),
  stakes: z.string().min(1),
  task: TaskSpec.nullable(),
});
export type MomentPlan = z.infer<typeof MomentPlan>;

export const WorkplaceOptions = z.object({
  level: z.enum(["intern", "junior", "experienced"]),
  /** Free text, e.g. "startup", "city hospital", "government office". Empty lets the AI choose. */
  workplace: z.string().max(60),
  /** Free text, e.g. "Pune, India". Empty means a generic English-speaking city. */
  location: z.string().max(60),
  length: z.enum(["quick", "full"]),
});
export type WorkplaceOptions = z.infer<typeof WorkplaceOptions>;

export const Workplace = z.object({
  id: z.string(),
  careerCode: z.string(),
  careerTitle: z.string(),
  options: WorkplaceOptions,
  seed: z.string(),
  setting: z.object({
    organisation: z.string().min(1),
    place: z.string().min(1),
    description: z.string().min(1),
    cultureNotes: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  you: z.object({
    title: z.string().min(1),
    responsibilities: z.array(z.string().min(1)).min(2).max(5),
    workLocationId: z.string(),
  }),
  cast: z.array(Character).min(3).max(7),
  locations: z.array(Location).min(5),
  meters: z.array(Meter).min(2).max(3),
  week: z.array(MomentPlan).min(1),
});
export type Workplace = z.infer<typeof Workplace>;
