import { describe, expect, it } from "vitest";
import {
  applyPatch,
  buildBrief,
  COMPILER_VERSION,
  CompileError,
  compileWorkplace,
  coverageGaps,
  dataNotes,
  repairRequest,
  validateDraft,
  validateWorkplace,
  workplaceId,
  type CompilerDraft,
} from "@/engine/compiler";
import { fakeCompilerDraft, fakeRepairPatch, registerEngineFakers } from "@/engine/fakes";
import { allocateKinds, planSlots, sampleCast, WEEK_RULES } from "@/engine/plan";
import { Workplace, type WorkplaceOptions } from "@/engine/types";
import { featuredCareers } from "@/lib/featured";
import { createRng } from "@/lib/rng";
import { createLLM } from "@/llm";
import { FakeProvider } from "@/llm/fake";
import { MemoryCallStore } from "@/llm/store";
import { LLMError, type LLMProvider, type ProviderRequest } from "@/llm/types";
import { allProfileCodes, fakeLLM, loadMeta, loadProfile } from "./helpers";

const NURSE = "29-1141.00";
const full: WorkplaceOptions = { level: "junior", workplace: "", location: "Pune, India", length: "full" };
const quick: WorkplaceOptions = { ...full, length: "quick" };
const meta = loadMeta();

const compile = (code: string, options = full, seed = "demo", llm = fakeLLM()) =>
  compileWorkplace({ profile: loadProfile(code), meta, options, seed }, llm);

// ---------------------------------------------------------------------------------------------
describe("Stage 1: planning in code", () => {
  const profile = loadProfile(NURSE);

  it("plans a full week of 12 moments with routine every day", () => {
    const slots = planSlots(profile, full, createRng("s1"));
    expect(slots).toHaveLength(WEEK_RULES.full.total);
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(slots.some((s) => s.day === day && s.kind === "routine")).toBe(true);
    }
    expect(slots.filter((s) => s.kind === "task")).toHaveLength(WEEK_RULES.full.tasks);
    expect(slots.filter((s) => s.kind === "pressure").length).toBeGreaterThanOrEqual(1);
    expect(["task", "pressure"]).not.toContain(slots[0].kind);
  });

  it("plans a quick shift as five moments in one day", () => {
    const slots = planSlots(profile, quick, createRng("s1"));
    expect(slots).toHaveLength(5);
    expect(new Set(slots.map((s) => s.day))).toEqual(new Set(["Mon"]));
    expect(slots.filter((s) => s.kind === "routine")).toHaveLength(1);
  });

  it("matches every career's mix of work within tolerance, for both lengths", () => {
    for (const code of allProfileCodes()) {
      const p = loadProfile(code);
      for (const options of [full, quick]) {
        expect(coverageGaps(planSlots(p, options, createRng(code)), p), `${code} ${options.length}`).toEqual([]);
      }
    }
  });

  it("allocates exactly one kind of work per moment", () => {
    expect(Object.values(allocateKinds(profile, 12)).reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("samples a boss, a senior, coworkers and outsiders, with gender independent of role", () => {
    const cast = sampleCast(full, "seed", createRng("cast"));
    expect(cast.map((c) => c.relation)).toEqual(expect.arrayContaining(["boss", "senior", "coworker", "outsider"]));
    expect(new Set(cast.map((c) => c.id)).size).toBe(cast.length);
    let bossWomen = 0;
    let coworkerWomen = 0;
    for (let i = 0; i < 3000; i++) {
      const c = sampleCast(quick, `seed-${i}`, createRng(`cast-${i}`));
      if (c.find((x) => x.relation === "boss")?.gender === "woman") bossWomen++;
      if (c.find((x) => x.relation === "coworker")?.gender === "woman") coworkerWomen++;
    }
    expect(Math.abs(bossWomen - coworkerWomen) / 3000).toBeLessThan(0.05);
  });

  it("tells the AI what the data doesn't cover, without inventing it", () => {
    const taxi = loadProfile("53-3054.00");
    const notes = dataNotes(taxi);
    expect(notes.join(" ")).toMatch(/No working-conditions survey/);
    expect(notes.join(" ")).toMatch(/Tasks aren't rated/);
    const slots = planSlots(taxi, full, createRng("t"));
    const brief = JSON.parse(buildBrief(taxi, meta, full, slots, sampleCast(full, "t", createRng("t"))));
    expect(brief.career.workingConditions).toEqual([]);
    expect(brief.career.dataNotes).toEqual(notes);
    expect(dataNotes(loadProfile(NURSE)).join(" ")).not.toMatch(/No working-conditions/);
  });

  it("gives the AI tasks with ids, the cast slots and the allowed rooms, but not the district", () => {
    const slots = planSlots(profile, full, createRng("s"));
    const brief = JSON.parse(buildBrief(profile, meta, full, slots, sampleCast(full, "seed", createRng("c"))));
    expect(brief.career.tasks[0]).toHaveProperty("id");
    expect(brief.week).toHaveLength(12);
    expect(brief.allowedLocationKinds).not.toContain("home");
    expect(brief.allowedLocationKinds).toEqual(expect.arrayContaining(["vehicle", "field", "depot"]));
  });
});

// ---------------------------------------------------------------------------------------------
describe("compiling with FakeLLM", () => {
  it.each(featuredCareers)("builds a valid workplace for featured $name", async ({ code }) => {
    const { workplace, report } = await compile(code);
    expect(validateWorkplace(workplace, loadProfile(code))).toEqual([]);
    expect(report).toMatchObject({ calls: 1, repairIssues: [], fallbackFixes: [] });
    expect(workplace.sources).toEqual({ onetVersion: "31.0", compilerVersion: COMPILER_VERSION });
    expect(workplace.week.map((m) => m.id)).toEqual(workplace.week.map((m) => `m${m.n}`));
    for (const c of workplace.cast) expect(c.goals.every((g) => g.status === "open")).toBe(true);
  });

  // A spread of unusual workplaces and data gaps (no working-conditions survey, unrated tasks).
  const sample = [
    "53-3054.00", // Taxi Drivers: no ratings or working conditions
    "29-2042.00", // Emergency Medical Technicians: no ratings or working conditions
    "11-1031.00", // Legislators: no ratings or working conditions
    "49-9092.00", // Commercial Divers
    "19-2011.00", // Astronomers
    "33-2011.00", // Firefighters
    "25-2011.00", // Preschool Teachers
    "39-4031.00", // Morticians, Undertakers, and Funeral Arrangers
    "45-2091.00", // Agricultural Equipment Operators
    "53-2011.00", // Airline Pilots
  ];
  it.each(sample)("builds a valid workplace for %s, quick and full", async (code) => {
    for (const options of [quick, full]) {
      const { workplace, report } = await compile(code, options);
      expect(validateWorkplace(workplace, loadProfile(code)), `${code} ${options.length}`).toEqual([]);
      expect(report.dataNotes.length).toBeGreaterThan(0);
    }
  });

  it("gives every place a two-way link and joins the district through the street", async () => {
    const { workplace } = await compile(NURSE);
    const street = workplace.locations.find((l) => l.kind === "street")!;
    expect(street.adjacentIds).toEqual(expect.arrayContaining(["loc-home", "loc-cafe"]));
    expect(street.adjacentIds.some((id) => workplace.locations.find((l) => l.id === id)?.area === "workplace")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("validateWorkplace: the independent check on finished workplaces", () => {
  const profile = loadProfile(NURSE);
  const valid = async () => structuredClone((await compile(NURSE)).workplace);
  const issuesFor = async (mutate: (wp: Workplace) => void) => {
    const wp = await valid();
    mutate(wp);
    return validateWorkplace(wp, profile).join("\n");
  };

  it("passes a valid workplace", async () => {
    expect(validateWorkplace(await valid(), profile)).toEqual([]);
  });

  it("rejects unknown occupational tasks", async () => {
    expect(await issuesFor((wp) => (wp.week[2].onetTaskId = 999999))).toMatch(/task 999999, which isn't in the O\*NET profile/);
  });

  it("rejects unknown people", async () => {
    expect(await issuesFor((wp) => (wp.week[1].castIds = ["c99"]))).toMatch(/unknown person c99/);
  });

  it("rejects unknown places", async () => {
    expect(await issuesFor((wp) => (wp.week[1].locationId = "loc-moon"))).toMatch(/unknown place loc-moon/);
  });

  it("rejects missing required fields and invalid moment types", async () => {
    expect(await issuesFor((wp) => delete (wp.week[0] as Partial<Workplace["week"][number]>).setup)).toMatch(/schema/);
    expect(await issuesFor((wp) => ((wp.week[0] as { kind: string }).kind = "meeting"))).toMatch(/schema/);
  });

  it("rejects invalid meters", async () => {
    expect(await issuesFor((wp) => (wp.meters[0].start = 140))).toMatch(/schema/);
    expect(await issuesFor((wp) => (wp.meters[1].id = wp.meters[0].id))).toMatch(/meter id .* used twice/);
  });

  it("rejects a mix of work outside the tolerance", async () => {
    expect(await issuesFor((wp) => wp.week.forEach((m) => (m.workKind = "A")))).toMatch(/Creating is \+\d+ points off/);
  });

  it("rejects a day without routine and the wrong number of tasks", async () => {
    const text = await issuesFor((wp) => wp.week.filter((m) => m.day === "Tue" && m.kind === "routine").forEach((m) => (m.kind = "conversation")));
    expect(text).toMatch(/Tue has no routine moment/);
    expect(await issuesFor((wp) => (wp.week.find((m) => m.kind === "task")!.kind = "conversation"))).toMatch(/needs 2 task moments|only task moments/);
  });

  it("rejects repeated ids, names and voices", async () => {
    expect(await issuesFor((wp) => (wp.cast[1].id = wp.cast[0].id))).toMatch(/cast id c1 is used twice/);
    expect(await issuesFor((wp) => (wp.cast[1].name = wp.cast[0].name))).toMatch(/share a name/);
    expect(await issuesFor((wp) => (wp.cast[1].voice = wp.cast[0].voice))).toMatch(/identical voices/);
  });

  it("rejects goals that involve nobody real, and insiders without an actionable goal", async () => {
    expect(await issuesFor((wp) => (wp.cast[0].goals[0].involves = ["c42"]))).toMatch(/involves c42/);
    const insider = (wp: Workplace) => wp.cast.find((c) => c.relation === "coworker")!;
    expect(await issuesFor((wp) => insider(wp).goals.forEach((g) => (g.involves = [])))).toMatch(/no goal involving/);
  });

  it("rejects one-way and unreachable places", async () => {
    expect(await issuesFor((wp) => (wp.locations[0].adjacentIds = [...wp.locations[0].adjacentIds, "loc-home"]))).toMatch(/isn't two-way/);
    const isolate = (wp: Workplace) => {
      const target = wp.locations.find((l) => l.kind === "home")!;
      wp.locations.forEach((l) => (l.adjacentIds = l.adjacentIds.filter((a) => a !== target.id)));
      target.adjacentIds = [];
    };
    expect(await issuesFor(isolate)).toMatch(/not every place is reachable/);
  });

  it("rejects tasks on non-task moments and tasks without a rubric", async () => {
    const spec = { type: "write" as const, prompt: "x", items: [], rubric: ["a", "b"] };
    expect(await issuesFor((wp) => (wp.week.find((m) => m.kind === "conversation")!.task = spec))).toMatch(/only task moments have a task/);
    expect(await issuesFor((wp) => (wp.week.find((m) => m.kind === "task")!.task!.rubric = []))).toMatch(/schema/);
  });
});

// ---------------------------------------------------------------------------------------------
/** A FakeLLM whose compile draft is changed by `breakDraft`, and whose repair can be changed too. */
function brokenLLM(
  breakDraft: (d: CompilerDraft) => CompilerDraft,
  breakRepair?: (p: ReturnType<typeof fakeRepairPatch>) => ReturnType<typeof fakeRepairPatch>,
) {
  const provider = new FakeProvider()
    .register("compile-workplace", (req, rng) => breakDraft(fakeCompilerDraft(req, rng)))
    .register("compile-workplace-repair", (req, rng) => (breakRepair ?? ((p) => p))(fakeRepairPatch(req, rng)));
  return { provider, llm: fakeLLM(provider) };
}

describe("Stage 4: one bounded repair of the broken parts", () => {
  it("repairs a moment written for the wrong kind of work", async () => {
    const { provider, llm } = brokenLLM((d) => ({ ...d, moments: d.moments.map((m, i) => (i < 6 ? { ...m, kindOfWork: "Creating" } : m)) }));
    const { workplace, report } = await compile(NURSE, full, "cov", llm);
    expect(report.calls).toBe(2);
    expect(report.repairIssues.some((i) => /planned as .* but was written as Creating/.test(i))).toBe(true);
    expect(report.fallbackFixes).toEqual([]);
    expect(validateWorkplace(workplace, loadProfile(NURSE))).toEqual([]);
    const repairAsk = JSON.parse(provider.calls[1].messages.at(-1)!.content);
    expect(repairAsk.replace.moments.length).toBeGreaterThan(0);
    expect(repairAsk.replace.cast).toEqual([]);
  });

  it("adds a missing moment and fixes unknown people", async () => {
    const { llm } = brokenLLM((d) => ({ ...d, moments: d.moments.slice(1).map((m) => ({ ...m, castIds: m.castIds.length ? ["nobody"] : [] })) }));
    const { workplace, report } = await compile(NURSE, quick, "miss", llm);
    expect(report.repairIssues.join("\n")).toMatch(/moment 1: is missing/);
    expect(workplace.week).toHaveLength(5);
    expect(workplace.week.every((m) => !m.castIds.includes("nobody"))).toBe(true);
  });

  it("only replaces the parts it asked for", () => {
    const profile = loadProfile(NURSE);
    const slots = planSlots(profile, quick, createRng("p"));
    const cast = sampleCast(quick, "p", createRng("p"));
    const brief = buildBrief(profile, meta, quick, slots, cast);
    const draft = fakeCompilerDraft({ tier: "smart", model: "fake", purpose: "", system: "", messages: [{ role: "user", content: brief }], schema: null as never, maxTokens: 1, seedSalt: "" }, createRng("d"));
    const request = repairRequest([{ part: "moment", ref: 2, problem: "x" }]);
    const patched = applyPatch(
      draft,
      { cast: [{ ...draft.cast[0], name: "Should Not Apply" }], moments: [{ ...draft.moments[1], title: "Fixed" }], locations: null, you: null, meters: null },
      request,
    );
    expect(patched.moments[1].title).toBe("Fixed");
    expect(patched.cast[0].name).toBe(draft.cast[0].name);
    expect(validateDraft(patched, slots, cast, profile)).toEqual([]);
  });
});

describe("Stage 5: safe fallback and typed failure", () => {
  it("relabels a moment's kind of work when the week still matches the job", async () => {
    // Nurse, full week: 3 Helping and 3 Organising moments. One Helping moment written as
    // Organising gives 2 and 4, still within 15 points of the job's 28% and 23%.
    const toOrganising = (moments: CompilerDraft["moments"]) => {
      const n = moments.find((m) => m.kindOfWork === "Helping")?.n;
      return moments.map((m) => (m.n === n ? { ...m, kindOfWork: "Organising" as const } : m));
    };
    const { llm } = brokenLLM(
      (d) => ({ ...d, moments: toOrganising(d.moments) }),
      (p) => ({ ...p, moments: p.moments.map((m) => ({ ...m, kindOfWork: "Organising" as const })) }),
    );
    const { workplace, report } = await compile(NURSE, full, "relabel", llm);
    expect(report.calls).toBe(2);
    expect(report.fallbackFixes.join(" ")).toMatch(/relabelled/);
    expect(workplace.week.filter((m) => m.workKind === "S")).toHaveLength(2);
    expect(workplace.week.filter((m) => m.workKind === "C")).toHaveLength(4);
    expect(validateWorkplace(workplace, loadProfile(NURSE))).toEqual([]);
  });

  it("fails with a typed error, never a malformed workplace, when the repair doesn't fix coverage", async () => {
    const allCreating = (d: CompilerDraft) => ({ ...d, moments: d.moments.map((m) => ({ ...m, kindOfWork: "Creating" as const })) });
    const { llm } = brokenLLM(allCreating, (p) => ({ ...p, moments: p.moments.map((m) => ({ ...m, kindOfWork: "Creating" as const })) }));
    const error = await compile(NURSE, full, "fail", llm).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompileError);
    expect((error as CompileError).reason).toBe("invalid");
    expect((error as CompileError).issues.join("\n")).toMatch(/written as Creating/);
  });

  it("fixes simple references in code when the repair doesn't", async () => {
    const badRefs = (d: CompilerDraft) => ({ ...d, moments: d.moments.map((m) => ({ ...m, locationKey: "moon", onetTaskId: -1 })) });
    const { llm } = brokenLLM(badRefs, (p) => ({ ...p, moments: p.moments.map((m) => ({ ...m, locationKey: "moon", onetTaskId: -1 })) }));
    const { workplace, report } = await compile(NURSE, quick, "refs", llm);
    expect(report.fallbackFixes.join("\n")).toMatch(/place set to/);
    expect(report.fallbackFixes.join("\n")).toMatch(/task set to the job's top task/);
    expect(validateWorkplace(workplace, loadProfile(NURSE))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
/** A provider for reliability tests: answers by script and counts calls. */
class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  readonly calls: ProviderRequest[] = [];
  constructor(private readonly answer: (req: ProviderRequest, n: number) => unknown) {}
  modelFor() {
    return "claude-opus-5-5";
  }
  async generate(req: ProviderRequest) {
    this.calls.push(req);
    const out = this.answer(req, this.calls.length);
    if (out instanceof Error) throw out;
    return { output: out, model: "claude-opus-5-5", usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 }, fellBack: false };
  }
}
const scriptedLLM = (provider: LLMProvider, dailyUsd = 10) => createLLM({ provider, store: new MemoryCallStore(), caps: { runUsd: 2, dailyUsd } });

describe("reliability", () => {
  it("turns a model timeout into a typed provider error", async () => {
    const provider = new ScriptedProvider(() => new LLMError("Request timed out", "provider"));
    const error = await compile(NURSE, quick, "t", scriptedLLM(provider)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompileError);
    expect((error as CompileError).reason).toBe("provider");
    expect(provider.calls).toHaveLength(1);
  });

  it("retries invalid structured output once, then fails with a typed error", async () => {
    const provider = new ScriptedProvider(() => ({ not: "a draft" }));
    const error = await compile(NURSE, quick, "i", scriptedLLM(provider)).catch((e: unknown) => e);
    expect((error as CompileError).reason).toBe("invalid");
    // One draft call, with the AI layer's single schema retry: two provider calls in total.
    expect(provider.calls).toHaveLength(2);
  });

  it("keeps the whole compile within its call budget even when everything goes wrong", async () => {
    // A schema-valid draft with problems, then a repair that never validates.
    const provider = new ScriptedProvider((req) => {
      if (req.purpose === "compile-workplace") {
        const d = fakeCompilerDraft(req, createRng("x"));
        return { ...d, moments: d.moments.map((m) => ({ ...m, kindOfWork: "Creating" })) };
      }
      return { nope: true };
    });
    const error = await compile(NURSE, full, "b", scriptedLLM(provider)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompileError);
    // Draft (1) + repair with its schema retry (2): never more than 4 provider calls.
    expect(provider.calls.length).toBeLessThanOrEqual(4);
    expect(provider.calls.map((c) => c.purpose)).toEqual(["compile-workplace", "compile-workplace-repair", "compile-workplace-repair"]);
  });

  it("respects the spending cap", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const error = await compile(NURSE, quick, "money", scriptedLLM(provider, 0)).catch((e: unknown) => e);
    expect((error as CompileError).reason).toBe("budget");
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a career without tasks as a data problem", async () => {
    const profile = { ...loadProfile(NURSE), tasks: [] };
    const error = await compileWorkplace({ profile, meta, options: quick, seed: "d" }, fakeLLM()).catch((e: unknown) => e);
    expect((error as CompileError).reason).toBe("data");
  });
});

// ---------------------------------------------------------------------------------------------
describe("reproducibility", () => {
  it("gives the same workplace for the same inputs and seed", async () => {
    expect((await compile(NURSE, full, "one")).workplace).toEqual((await compile(NURSE, full, "one")).workplace);
  });

  it("varies with the seed without breaking any rule", async () => {
    const results = await Promise.all(["a", "b", "c", "d", "e"].map((s) => compile(NURSE, full, s)));
    for (const { workplace } of results) expect(validateWorkplace(workplace, loadProfile(NURSE))).toEqual([]);
    const casts = new Set(results.map((r) => r.workplace.cast.map((c) => c.name).join()));
    expect(casts.size).toBeGreaterThan(1);
  });

  it("gives careers that share a seed different casts", async () => {
    const people = async (code: string) => (await compile(code, full, "shared")).workplace.cast.map((c) => `${c.relation}/${c.age}/${c.gender}`).join();
    const all = await Promise.all(featuredCareers.map((c) => people(c.code)));
    expect(new Set(all).size).toBeGreaterThan(1);
  });

  it("keys stored workplaces on career, options, seed and data version", () => {
    const base = workplaceId(NURSE, full, "s", "31.0");
    expect(workplaceId(NURSE, full, "s", "31.0")).toBe(base);
    expect(workplaceId(NURSE, quick, "s", "31.0")).not.toBe(base);
    expect(workplaceId(NURSE, { ...full, location: "London" }, "s", "31.0")).not.toBe(base);
    expect(workplaceId(NURSE, { ...full, level: "intern" }, "s", "31.0")).not.toBe(base);
    expect(workplaceId(NURSE, full, "t", "31.0")).not.toBe(base);
    expect(workplaceId(NURSE, full, "s", "32.0")).not.toBe(base);
    expect(workplaceId("47-2111.00", full, "s", "31.0")).not.toBe(base);
  });

  it("records the data and compiler version on every workplace", async () => {
    const { workplace } = await compile(NURSE, quick, "v");
    expect(workplace.id).toBe(workplaceId(NURSE, quick, "v", meta.version));
    expect(Workplace.parse(workplace).sources.compilerVersion).toBe(COMPILER_VERSION);
  });
});

// ---------------------------------------------------------------------------------------------
describe("getWorkplace: persistence", () => {
  it("compiles once, stores the workplace, then reads it back", async () => {
    const { createDatabase } = await import("@/db");
    const { migrateDatabase } = await import("@/db/migrate");
    const { getWorkplace } = await import("@/engine/workplaces");
    const db = createDatabase({ url: "", pgliteDir: "memory://" });
    await migrateDatabase(db);
    const provider = registerEngineFakers(new FakeProvider());
    const llm = fakeLLM(provider);
    const first = await getWorkplace({ code: NURSE, options: quick, seed: "store" }, { db, llm });
    const again = await getWorkplace({ code: NURSE, options: quick, seed: "store" }, { db, llm });
    expect(again).toEqual(first);
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
