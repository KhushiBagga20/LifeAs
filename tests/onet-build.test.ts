import { describe, expect, it } from "vitest";
import { buildCareerData, interestShares, type Tables } from "@/lib/onet/build";
import { CareerProfile } from "@/lib/onet/types";

const NURSE = "29-1141.00";
const EMPTY = "11-9199.00";

function interest(code: string, element: string, scale: "OI" | "IH", value: number) {
  return { onetsoc_code: code, element_id: element, scale_id: scale, data_value: value };
}

function rating(task: number, scale: string, value: number, extra: Record<string, unknown> = {}) {
  return { onetsoc_code: NURSE, task_id: task, scale_id: scale, data_value: value, recommend_suppress: "N", ...extra };
}

const tables: Tables = {
  occupation_data: [
    { onetsoc_code: NURSE, title: "Registered Nurses", description: "Assess patient health problems." },
    { onetsoc_code: EMPTY, title: "Managers, All Other", description: "All other managers." },
  ],
  job_titles: [
    { onetsoc_code: NURSE, job_title: "Staff Nurse", short_title: null },
    { onetsoc_code: NURSE, job_title: "Registered Nurse (RN)", short_title: "RN" },
  ],
  sample_of_reported_titles: [
    { onetsoc_code: NURSE, reported_job_title: "Charge Nurse", shown_in_my_next_move: "Y" },
    { onetsoc_code: NURSE, reported_job_title: "Staff Nurse", shown_in_my_next_move: "N" },
  ],
  task_statements: [
    { onetsoc_code: NURSE, task_id: 1, task: "Maintain records.", task_type: "Core" },
    { onetsoc_code: NURSE, task_id: 2, task: "Administer medications.", task_type: "Core" },
    { onetsoc_code: NURSE, task_id: 3, task: "Teach first aid classes.", task_type: "Supplemental" },
  ],
  task_ratings: [
    rating(1, "IM", 4.2),
    rating(1, "RT", 95),
    rating(1, "FT", 50, { category: 5 }),
    rating(1, "FT", 50, { category: 7 }),
    rating(2, "IM", 4.7),
    rating(2, "RT", 99),
    rating(3, "IM", 2.1, { recommend_suppress: "Y" }),
  ],
  task_categories: [
    { scale_id: "FT", category: 5, category_description: "Daily" },
    { scale_id: "FT", category: 7, category_description: "Hourly or more" },
  ],
  work_activities: [
    { onetsoc_code: NURSE, element_id: "4.A.1.a.1", element_name: "Getting Information", scale_id: "IM", data_value: 4.7 },
    { onetsoc_code: NURSE, element_id: "4.A.1.a.1", element_name: "Getting Information", scale_id: "LV", data_value: 5.1 },
  ],
  work_context: [
    { onetsoc_code: NURSE, element_id: "4.C.3.d.1", element_name: "Time Pressure", scale_id: "CX", data_value: 3.99 },
    { onetsoc_code: NURSE, element_id: "4.C.3.d.1", element_name: "Time Pressure", scale_id: "CXP", category: 4, data_value: 33.07 },
    { onetsoc_code: NURSE, element_id: "4.C.3.d.1", element_name: "Time Pressure", scale_id: "CXP", category: 5, data_value: 42.46 },
  ],
  work_context_categories: [
    { element_id: "4.C.3.d.1", scale_id: "CXP", category: 5, category_description: "Every day" },
  ],
  career_interest_types: [
    interest(NURSE, "1.B.1.a", "OI", 3.46),
    interest(NURSE, "1.B.1.b", "OI", 4.71),
    interest(NURSE, "1.B.1.c", "OI", 1.34),
    interest(NURSE, "1.B.1.d", "OI", 5.57),
    interest(NURSE, "1.B.1.e", "OI", 2.38),
    interest(NURSE, "1.B.1.f", "OI", 4.75),
    interest(NURSE, "1.B.1.g", "IH", 4),
    interest(NURSE, "1.B.1.h", "IH", 6),
  ],
  job_zones: [{ onetsoc_code: NURSE, job_zone: 4 }],
  job_zone_reference: [
    { job_zone: 4, name: "Job Zone Four", education: "A bachelor's degree.", experience: "Some.", job_training: "Several years." },
  ],
  related_occupations: [
    { onetsoc_code: NURSE, related_onetsoc_code: EMPTY, related_title: "Managers, All Other", relatedness_tier: "Primary-Short", related_index: 1 },
  ],
};

describe("interestShares", () => {
  it("turns interest scores into shares above the floor that sum to 1", () => {
    const kinds = interestShares({ R: 1, I: 4, A: 1, S: 7, E: 1, C: 1 });
    expect(kinds.S.share).toBeCloseTo(6 / 9, 3);
    expect(kinds.I.share).toBeCloseTo(3 / 9, 3);
    expect(kinds.R.share).toBe(0);
    const total = Object.values(kinds).reduce((a, k) => a + k.share, 0);
    expect(total).toBeCloseTo(1, 3);
  });

  it("spreads evenly when every score sits on the floor", () => {
    const kinds = interestShares({ R: 1, I: 1, A: 1, S: 1, E: 1, C: 1 });
    expect(kinds.A.share).toBeCloseTo(1 / 6, 5);
  });
});

describe("buildCareerData", () => {
  const { profiles, index, skipped, meta } = buildCareerData(tables, "31.0", "August 2026");
  const nurse = profiles[0];

  it("skips occupations without tasks, interests or a job zone", () => {
    expect(profiles.map((p) => p.code)).toEqual([NURSE]);
    expect(skipped.map((s) => s.code)).toEqual([EMPTY]);
  });

  it("produces profiles that match the schema", () => {
    expect(() => CareerProfile.parse(nurse)).not.toThrow();
  });

  it("orders tasks by importance and drops suppressed ratings", () => {
    expect(nurse.tasks.map((t) => t.id)).toEqual([2, 1, 3]);
    expect(nurse.tasks[2]).toMatchObject({ importance: null, core: false });
  });

  it("averages the task frequency categories", () => {
    expect(nurse.tasks.find((t) => t.id === 1)?.frequency).toBe(6);
  });

  it("keeps the most common work-context answer", () => {
    expect(nurse.context).toEqual([{ id: "4.C.3.d.1", mean: 3.99, modal: { category: 5, percent: 42.5 } }]);
    expect(meta.context["4.C.3.d.1"].categories["5"]).toBe("Every day");
  });

  it("reads interest high points in order", () => {
    expect(nurse.highPoints).toEqual(["S", "C"]);
    expect(index[0].highPoint).toBe("S");
  });

  it("puts common titles first in the search titles, without duplicates", () => {
    expect(nurse.commonTitles).toEqual(["Charge Nurse"]);
    expect(index[0].titles).toEqual(["Charge Nurse", "Staff Nurse", "Registered Nurse (RN)", "RN"]);
    expect(index[0].commonCount).toBe(1);
  });

  it("only links to related occupations that are shipped", () => {
    expect(nurse.related).toEqual([]);
  });
});
