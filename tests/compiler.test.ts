import { describe, expect, it } from "vitest";
import { buildBrief, compileWorkplace, coverageGaps, validateDraft, type CompilerDraft } from "@/engine/compiler";
import { fakeCompilerDraft, registerEngineFakers } from "@/engine/fakes";
import { allocateKinds, planSlots, sampleCast } from "@/engine/plan";
import { Workplace, type WorkplaceOptions } from "@/engine/types";
import { featuredCareers } from "@/lib/featured";
import { createRng } from "@/lib/rng";
import { FakeProvider } from "@/llm/fake";
import { allProfileCodes, fakeLLM, loadMeta, loadProfile } from "./helpers";

const NURSE = "29-1141.00";
const full: WorkplaceOptions = { level: "junior", workplace: "", location: "Pune, India", length: "full" };
const quick: WorkplaceOptions = { ...full, length: "quick" };
const meta = loadMeta();

describe("planSlots", () => {
  const profile = loadProfile(NURSE);

  it("plans a full week of 12 moments with routine every day", () => {
    const slots = planSlots(profile, full, createRng("s1"));
    expect(slots).toHaveLength(12);
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(slots.some((s) => s.day === day && s.kind === "routine")).toBe(true);
    }
    expect(slots.filter((s) => s.kind === "task")).toHaveLength(2);
    expect(slots.filter((s) => s.kind === "pressure").length).toBeGreaterThanOrEqual(1);
    expect(["task", "pressure"]).not.toContain(slots[0].kind);
  });

  it("plans a quick shift as five moments in one day", () => {
    const slots = planSlots(profile, quick, createRng("s1"));
    expect(slots).toHaveLength(5);
    expect(new Set(slots.map((s) => s.day))).toEqual(new Set(["Mon"]));
    expect(slots.filter((s) => s.kind === "routine")).toHaveLength(1);
  });

  it("is the same for the same seed", () => {
    expect(planSlots(profile, full, createRng("x"))).toEqual(planSlots(profile, full, createRng("x")));
  });

  it("matches every career's mix of work within tolerance, for both lengths", () => {
    for (const code of allProfileCodes()) {
      const p = loadProfile(code);
      for (const options of [full, quick]) {
        const slots = planSlots(p, options, createRng(code));
        expect(coverageGaps(slots, p), `${code} ${options.length}`).toEqual([]);
      }
    }
  });

  it("allocates exactly one kind of work per moment", () => {
    const counts = allocateKinds(profile, 12);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(12);
  });
});

describe("sampleCast", () => {
  it("always has a boss, a senior, coworkers and outsiders", () => {
    const cast = sampleCast(full, "seed", createRng("cast"));
    expect(cast.map((c) => c.relation)).toEqual(expect.arrayContaining(["boss", "senior", "coworker", "outsider"]));
    expect(new Set(cast.map((c) => c.id)).size).toBe(cast.length);
  });

  it("samples gender independently of role", () => {
    let bossWomen = 0;
    let coworkerWomen = 0;
    const runs = 3000;
    for (let i = 0; i < runs; i++) {
      const cast = sampleCast(quick, `seed-${i}`, createRng(`cast-${i}`));
      if (cast.find((c) => c.relation === "boss")?.gender === "woman") bossWomen++;
      if (cast.find((c) => c.relation === "coworker")?.gender === "woman") coworkerWomen++;
    }
    expect(Math.abs(bossWomen - coworkerWomen) / runs).toBeLessThan(0.05);
  });
});

describe("buildBrief", () => {
  it("gives the AI the tasks, cast slots and allowed rooms, but not the district", () => {
    const profile = loadProfile(NURSE);
    const slots = planSlots(profile, full, createRng("s"));
    const cast = sampleCast(full, "seed", createRng("c"));
    const brief = JSON.parse(buildBrief(profile, meta, full, slots, cast));
    expect(brief.career.tasks[0]).toHaveProperty("id");
    expect(brief.cast).toHaveLength(cast.length);
    expect(brief.week).toHaveLength(12);
    expect(brief.allowedLocationKinds).not.toContain("home");
    expect(brief.career.workingConditions.length).toBeGreaterThan(5);
  });
});

describe("compileWorkplace with FakeLLM", () => {
  it.each(featuredCareers)("builds a valid workplace for $name", async ({ code }) => {
    const { workplace, repaired } = await compileWorkplace({ profile: loadProfile(code), meta, options: full, seed: "demo" }, fakeLLM());
    expect(() => Workplace.parse(workplace)).not.toThrow();
    expect(repaired).toBe(false);
    const ids = new Set(workplace.locations.map((l) => l.id));
    expect(workplace.locations.filter((l) => l.area === "district").map((l) => l.kind)).toEqual(["home", "cafe", "street"]);
    for (const m of workplace.week) {
      expect(ids.has(m.locationId)).toBe(true);
      for (const id of m.castIds) expect(workplace.cast.some((c) => c.id === id)).toBe(true);
    }
    for (const c of workplace.cast) {
      if (c.relation === "outsider") expect(c.routine).toBeNull();
      else expect(ids.has(c.workLocationId!)).toBe(true);
    }
    expect(coverageGaps(workplace.week, loadProfile(code))).toEqual([]);
  });

  it("is the same for the same seed and different for another", async () => {
    const profile = loadProfile(NURSE);
    const a = await compileWorkplace({ profile, meta, options: full, seed: "one" }, fakeLLM());
    const b = await compileWorkplace({ profile, meta, options: full, seed: "one" }, fakeLLM());
    const c = await compileWorkplace({ profile, meta, options: full, seed: "two" }, fakeLLM());
    expect(a.workplace).toEqual(b.workplace);
    expect(c.workplace.id).not.toBe(a.workplace.id);
  });

  it("sends a draft with problems back once for repair", async () => {
    const provider = registerEngineFakers(new FakeProvider()).register("compile-workplace", (req, rng) => {
      const draft = fakeCompilerDraft(req, rng);
      return { ...draft, moments: draft.moments.map((m) => ({ ...m, castIds: ["nobody"] })) };
    });
    const { workplace, repaired, autoFixed } = await compileWorkplace(
      { profile: loadProfile(NURSE), meta, options: quick, seed: "r" },
      fakeLLM(provider),
    );
    expect(repaired).toBe(true);
    expect(autoFixed).toEqual([]);
    expect(provider.calls.map((c) => c.purpose)).toEqual(["compile-workplace", "compile-workplace-repair"]);
    expect(provider.calls[1].messages.at(-1)?.content).toMatch(/castIds must come from/);
    expect(workplace.week.every((m) => !m.castIds.includes("nobody"))).toBe(true);
  });

  it("fixes simple reference mistakes in code when the repair doesn't", async () => {
    const broken = (req: Parameters<typeof fakeCompilerDraft>[0], rng: Parameters<typeof fakeCompilerDraft>[1]) => {
      const draft = fakeCompilerDraft(req, rng);
      return { ...draft, moments: draft.moments.map((m) => ({ ...m, locationKey: "moon", onetTaskId: -1 })) };
    };
    const provider = new FakeProvider().register("compile-workplace", broken).register("compile-workplace-repair", broken);
    const { workplace, autoFixed } = await compileWorkplace({ profile: loadProfile(NURSE), meta, options: quick, seed: "f" }, fakeLLM(provider));
    expect(autoFixed.some((i) => i.includes("doesn't exist"))).toBe(true);
    expect(workplace.week.every((m) => m.locationId !== "loc-moon")).toBe(true);
  });
});

describe("validateDraft", () => {
  const profile = loadProfile(NURSE);
  const slots = planSlots(profile, quick, createRng("v"));
  const cast = sampleCast(quick, "v", createRng("v"));
  const brief = buildBrief(profile, meta, quick, slots, cast);
  const good: CompilerDraft = fakeCompilerDraft(
    { tier: "smart", model: "fake", purpose: "compile-workplace", system: "", messages: [{ role: "user", content: brief }], schema: null as never, maxTokens: 1, seedSalt: "" },
    createRng("draft"),
  );

  it("accepts the fake draft", () => {
    expect(validateDraft(good, slots, cast, profile)).toEqual([]);
  });

  it("catches missing moments, tasks in the wrong place and repeated names", () => {
    const bad: CompilerDraft = {
      ...good,
      cast: good.cast.map((c) => ({ ...c, name: "Same Name" })),
      moments: good.moments.slice(1).map((m) => ({ ...m, task: { type: "write", prompt: "x", items: [], rubric: ["a", "b"] } })),
    };
    const issues = validateDraft(bad, slots, cast, profile).join("\n");
    expect(issues).toMatch(/moment 1 is missing/);
    expect(issues).toMatch(/set task to null/);
    expect(issues).toMatch(/different name/);
  });
});

describe("getWorkplace", () => {
  it("compiles once, stores the workplace, then reads it back", async () => {
    const { createDatabase } = await import("@/db");
    const { migrateDatabase } = await import("@/db/migrate");
    const { getWorkplace, workplaceId } = await import("@/engine/workplaces");
    const db = createDatabase({ url: "", pgliteDir: "memory://" });
    await migrateDatabase(db);
    const provider = registerEngineFakers(new FakeProvider());
    const llm = fakeLLM(provider);
    const first = await getWorkplace({ code: NURSE, options: quick, seed: "store" }, { db, llm });
    const again = await getWorkplace({ code: NURSE, options: quick, seed: "store" }, { db, llm });
    expect(again).toEqual(first);
    expect(first.id).toBe(workplaceId(NURSE, quick, "store"));
    expect(provider.calls).toHaveLength(1);
  });

  it("rejects unknown careers", async () => {
    const { createDatabase } = await import("@/db");
    const { migrateDatabase } = await import("@/db/migrate");
    const { getWorkplace } = await import("@/engine/workplaces");
    const db = createDatabase({ url: "", pgliteDir: "memory://" });
    await migrateDatabase(db);
    await expect(getWorkplace({ code: "99-9999.00", options: quick, seed: "x" }, { db, llm: fakeLLM() })).rejects.toThrow(/No career/);
  });
});
