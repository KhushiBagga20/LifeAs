import { kindCodes, type CareerProfile, type IndexEntry, type Meta } from "./types";

// Turns raw O*NET® database tables into the trimmed career data the app ships with.
// Pure: the import script does the file reading and writing.

type Row = Record<string, string | number | null>;
export type Tables = Record<
  | "occupation_data"
  | "job_titles"
  | "sample_of_reported_titles"
  | "task_statements"
  | "task_ratings"
  | "task_categories"
  | "work_activities"
  | "work_context"
  | "work_context_categories"
  | "career_interest_types"
  | "job_zones"
  | "job_zone_reference"
  | "related_occupations",
  Row[]
>;

export type BuildResult = {
  meta: Meta;
  index: IndexEntry[];
  profiles: CareerProfile[];
  skipped: { code: string; title: string; reason: string }[];
};

const INTEREST_ELEMENTS: Record<string, (typeof kindCodes)[number]> = {
  "1.B.1.a": "R",
  "1.B.1.b": "I",
  "1.B.1.c": "A",
  "1.B.1.d": "S",
  "1.B.1.e": "E",
  "1.B.1.f": "C",
};
const HIGH_POINT_ELEMENTS = ["1.B.1.g", "1.B.1.h", "1.B.1.i"];
const MAX_RELATED = 10;

const str = (v: Row[string]) => (v == null ? "" : String(v));
const num = (v: Row[string]) => (typeof v === "number" ? v : Number(v));
const suppressed = (r: Row) => r.recommend_suppress === "Y";
const round = (n: number, places = 2) => Number(n.toFixed(places));

function groupBy(rows: Row[], key = "onetsoc_code"): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const k = str(row[key]);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

/** Interest scores above the floor of 1, as shares of the whole profile. */
export function interestShares(scores: Record<string, number>): CareerProfile["kinds"] {
  const above = kindCodes.map((k) => Math.max(0, (scores[k] ?? 1) - 1));
  const total = above.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    kindCodes.map((k, i) => [
      k,
      { score: scores[k] ?? 1, share: total === 0 ? 1 / kindCodes.length : round(above[i] / total, 4) },
    ]),
  ) as CareerProfile["kinds"];
}

function buildTasks(statements: Row[], ratings: Row[]): CareerProfile["tasks"] {
  const byTask = groupBy(ratings, "task_id");
  const tasks = statements.map((s) => {
    const rows = byTask.get(str(s.task_id)) ?? [];
    const scalar = (scale: string) => {
      const r = rows.find((x) => x.scale_id === scale);
      return r && !suppressed(r) ? round(num(r.data_value)) : null;
    };
    const freqRows = rows.filter((x) => x.scale_id === "FT");
    let frequency: number | null = null;
    if (freqRows.length && !freqRows.some(suppressed)) {
      const total = freqRows.reduce((a, r) => a + num(r.data_value), 0);
      if (total > 0) {
        frequency = round(freqRows.reduce((a, r) => a + num(r.category) * num(r.data_value), 0) / total);
      }
    }
    return {
      id: num(s.task_id),
      text: str(s.task),
      core: s.task_type !== "Supplemental",
      importance: scalar("IM"),
      relevance: scalar("RT"),
      frequency,
    };
  });
  return tasks.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.id - b.id);
}

function buildContext(rows: Row[]): CareerProfile["context"] {
  const byElement = groupBy(rows, "element_id");
  const context: CareerProfile["context"] = [];
  for (const [id, list] of byElement) {
    const mean = list.find((r) => r.scale_id === "CX" || r.scale_id === "CT");
    if (!mean || suppressed(mean)) continue;
    const categories = list.filter((r) => r.scale_id === "CXP" || r.scale_id === "CTP");
    if (!categories.length) continue;
    const modal = categories.reduce((best, r) => (num(r.data_value) > num(best.data_value) ? r : best));
    context.push({
      id,
      mean: round(num(mean.data_value)),
      modal: { category: num(modal.category), percent: round(num(modal.data_value), 1) },
    });
  }
  return context.sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueTitles(titles: string[], exclude: string): string[] {
  const seen = new Set([exclude.toLowerCase()]);
  const out: string[] = [];
  for (const t of titles) {
    const key = t.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t.trim());
  }
  return out;
}

export function buildCareerData(t: Tables, version: string, release: string): BuildResult {
  const statements = groupBy(t.task_statements);
  const ratings = groupBy(t.task_ratings);
  const activities = groupBy(t.work_activities);
  const context = groupBy(t.work_context);
  const interests = groupBy(t.career_interest_types);
  const zones = new Map(t.job_zones.map((r) => [str(r.onetsoc_code), num(r.job_zone)]));
  const related = groupBy(t.related_occupations);
  const jobTitles = groupBy(t.job_titles);
  const reported = groupBy(t.sample_of_reported_titles);

  const profiles: CareerProfile[] = [];
  const index: IndexEntry[] = [];
  const skipped: BuildResult["skipped"] = [];

  for (const occ of t.occupation_data) {
    const code = str(occ.onetsoc_code);
    const title = str(occ.title);
    const interestRows = (interests.get(code) ?? []).filter((r) => !suppressed(r));
    const zone = zones.get(code);
    const taskRows = statements.get(code) ?? [];
    if (!taskRows.length || !interestRows.length || zone == null) {
      skipped.push({ code, title, reason: "no tasks, interests or job zone in this release" });
      continue;
    }

    const scores: Record<string, number> = {};
    const highPoints: CareerProfile["highPoints"] = [];
    for (const r of interestRows) {
      const kind = INTEREST_ELEMENTS[str(r.element_id)];
      if (r.scale_id === "OI" && kind) scores[kind] = round(num(r.data_value));
    }
    for (const element of HIGH_POINT_ELEMENTS) {
      const r = interestRows.find((x) => x.scale_id === "IH" && x.element_id === element);
      const position = r ? num(r.data_value) : 0;
      if (position >= 1 && position <= 6) highPoints.push(kindCodes[position - 1]);
    }

    const common = (reported.get(code) ?? [])
      .filter((r) => r.shown_in_my_next_move === "Y")
      .map((r) => str(r.reported_job_title));
    const other = [
      ...(reported.get(code) ?? []).map((r) => str(r.reported_job_title)),
      ...(jobTitles.get(code) ?? []).flatMap((r) => [str(r.job_title), str(r.short_title)]),
    ];
    const commonTitles = uniqueTitles(common, title);
    const allTitles = uniqueTitles([...commonTitles, ...other], title);

    const relatedRows = (related.get(code) ?? [])
      .slice()
      .sort((a, b) => num(a.related_index) - num(b.related_index))
      .slice(0, MAX_RELATED);

    const profile: CareerProfile = {
      code,
      title,
      description: str(occ.description),
      jobZone: zone,
      kinds: interestShares(scores),
      highPoints,
      tasks: buildTasks(taskRows, ratings.get(code) ?? []),
      activities: (activities.get(code) ?? [])
        .filter((r) => r.scale_id === "IM" && !suppressed(r))
        .map((r) => ({ id: str(r.element_id), importance: round(num(r.data_value)) }))
        .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id)),
      context: buildContext(context.get(code) ?? []),
      related: relatedRows.map((r) => ({
        code: str(r.related_onetsoc_code),
        title: str(r.related_title),
        primary: str(r.relatedness_tier).startsWith("Primary"),
      })),
      commonTitles,
    };
    profiles.push(profile);
    index.push({
      code,
      title,
      description: profile.description,
      jobZone: zone,
      highPoint: highPoints[0] ?? null,
      titles: allTitles,
      commonCount: commonTitles.length,
    });
  }

  // Related links can only point at occupations we ship.
  const shipped = new Set(profiles.map((p) => p.code));
  for (const p of profiles) p.related = p.related.filter((r) => shipped.has(r.code));

  const meta: Meta = {
    version,
    release,
    occupations: profiles.length,
    jobZones: Object.fromEntries(
      t.job_zone_reference.map((r) => [
        str(r.job_zone),
        {
          name: str(r.name),
          education: str(r.education),
          experience: str(r.experience),
          training: str(r.job_training),
        },
      ]),
    ),
    activities: Object.fromEntries(
      [...groupBy(t.work_activities, "element_id")].map(([id, rows]) => [id, str(rows[0].element_name)]),
    ),
    context: buildContextDictionary(t.work_context, t.work_context_categories),
    taskFrequency: Object.fromEntries(
      t.task_categories
        .filter((r) => r.scale_id === "FT")
        .map((r) => [str(r.category), str(r.category_description)]),
    ),
  };

  return { meta, index, profiles, skipped };
}

function buildContextDictionary(ratings: Row[], categories: Row[]): Meta["context"] {
  const byElement = groupBy(categories, "element_id");
  const dictionary: Meta["context"] = {};
  for (const [id, rows] of groupBy(ratings, "element_id")) {
    const scale = rows.some((r) => r.scale_id === "CT") ? "CT" : "CX";
    dictionary[id] = {
      name: str(rows[0].element_name),
      scale,
      categories: Object.fromEntries(
        (byElement.get(id) ?? []).map((r) => [str(r.category), str(r.category_description)]),
      ),
    };
  }
  return dictionary;
}
