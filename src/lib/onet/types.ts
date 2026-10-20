import { z } from "zod";

// Shapes of the career data generated from the O*NET® database by scripts/import-onet.ts.
// DESIGN.md §2 and §4.1 (CareerProfile).

export const kindCodes = ["R", "I", "A", "S", "E", "C"] as const;
export const KindCode = z.enum(kindCodes);
export type KindCode = z.infer<typeof KindCode>;

const KindScores = z.object({
  /** O*NET occupational interest score, 1–7. */
  score: z.number().min(1).max(7),
  /** Share of the job's interest profile above the floor of 1, 0–1. All six sum to 1. */
  share: z.number().min(0).max(1),
});

export const Task = z.object({
  id: z.number().int(),
  text: z.string().min(1),
  core: z.boolean(),
  /** 1–5, null when O*NET hasn't rated it or suppresses the rating. */
  importance: z.number().min(1).max(5).nullable(),
  /** Percent of workers who say the task is relevant to their job. */
  relevance: z.number().min(0).max(100).nullable(),
  /** Mean frequency category, 1 (yearly or less) to 7 (hourly or more). */
  frequency: z.number().min(1).max(7).nullable(),
});

export const Activity = z.object({
  id: z.string(),
  /** Importance, 1–5. */
  importance: z.number().min(1).max(5),
});

export const Context = z.object({
  id: z.string(),
  /** Mean rating on the element's own scale (CX: 1–5, CT: 1–3). */
  mean: z.number(),
  /** The most common answer and the percent of workers who gave it. */
  modal: z.object({ category: z.number().int(), percent: z.number().min(0).max(100) }),
});

export const CareerProfile = z.object({
  code: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/),
  title: z.string().min(1),
  description: z.string().min(1),
  jobZone: z.number().int().min(2).max(5),
  kinds: z.record(KindCode, KindScores),
  /** Up to three interest high points, strongest first. */
  highPoints: z.array(KindCode).max(3),
  /** Sorted by importance, highest first; unrated tasks last. */
  tasks: z.array(Task).min(1),
  /** Generalised work activities, sorted by importance. Empty when not rated. */
  activities: z.array(Activity),
  /** Work context ratings. Empty when not rated. */
  context: z.array(Context),
  related: z.array(z.object({ code: z.string(), title: z.string(), primary: z.boolean() })),
  /** Common titles people use for this job. */
  commonTitles: z.array(z.string()),
});
export type CareerProfile = z.infer<typeof CareerProfile>;

export const IndexEntry = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string(),
  jobZone: z.number().int(),
  highPoint: KindCode.nullable(),
  /** Common titles first, then every other title, for search. */
  titles: z.array(z.string()),
  /** How many of `titles` are common (shown first in results). */
  commonCount: z.number().int().min(0),
});
export type IndexEntry = z.infer<typeof IndexEntry>;

export const Meta = z.object({
  version: z.string(),
  release: z.string(),
  occupations: z.number().int(),
  jobZones: z.record(
    z.string(),
    z.object({ name: z.string(), education: z.string(), experience: z.string(), training: z.string() }),
  ),
  activities: z.record(z.string(), z.string()),
  context: z.record(
    z.string(),
    z.object({ name: z.string(), scale: z.enum(["CX", "CT"]), categories: z.record(z.string(), z.string()) }),
  ),
  taskFrequency: z.record(z.string(), z.string()),
});
export type Meta = z.infer<typeof Meta>;
