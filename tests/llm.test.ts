import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDatabase } from "@/db";
import { migrateDatabase } from "@/db/migrate";
import { createLLM } from "@/llm";
import { FakeProvider } from "@/llm/fake";
import { costUsd } from "@/llm/prices";
import { DbCallStore, MemoryCallStore } from "@/llm/store";
import { LLMError, type LLMProvider, type ProviderRequest, type ProviderResponse } from "@/llm/types";

const Line = z.object({
  speaker: z.string().min(1),
  line: z.string().min(1),
  emotion: z.enum(["calm", "annoyed", "worried", "pleased"]),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()).min(1).max(3),
});

const caps = { runUsd: 2, dailyUsd: 10 };
const request = {
  tier: "fast" as const,
  purpose: "test-line",
  system: "You write one line of dialogue.",
  messages: [{ role: "user" as const, content: "Monday standup." }],
  schema: Line,
};

const usage = { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 200 };

/** A provider that answers from a script, one answer per call, priced as Opus 5.5. */
class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  readonly calls: ProviderRequest[] = [];
  constructor(private readonly answers: (unknown | Error)[]) {}
  modelFor() {
    return "claude-opus-5-5";
  }
  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const answer = this.answers[this.calls.length - 1];
    if (answer instanceof Error) throw answer;
    return { output: answer, model: "claude-opus-5-5", usage, fellBack: false };
  }
}

const valid = { speaker: "Meera", line: "We promised Friday.", emotion: "worried", confidence: 0.7, tags: ["deadline"] };

describe("FakeLLM", () => {
  it("returns schema-valid answers", async () => {
    const llm = createLLM({ provider: new FakeProvider(), store: new MemoryCallStore(), caps });
    const { value } = await llm.generate(request);
    expect(() => Line.parse(value)).not.toThrow();
  });

  it("gives the same answer to the same request and varies with the seed", async () => {
    const a = await new FakeProvider().generate({ ...request, model: "fake", maxTokens: 100, seedSalt: "1" });
    const b = await new FakeProvider().generate({ ...request, model: "fake", maxTokens: 100, seedSalt: "1" });
    const c = await new FakeProvider().generate({ ...request, model: "fake", maxTokens: 100, seedSalt: "2" });
    expect(a.output).toEqual(b.output);
    expect(a.output).not.toEqual(c.output);
  });

  it("uses a registered faker for its purpose", async () => {
    const provider = new FakeProvider().register("test-line", () => valid);
    const llm = createLLM({ provider, store: new MemoryCallStore(), caps });
    expect((await llm.generate(request)).value).toEqual(valid);
  });
});

describe("createLLM", () => {
  it("serves repeated requests from the cache at no cost", async () => {
    const provider = new ScriptedProvider([valid]);
    const llm = createLLM({ provider, store: new MemoryCallStore(), caps });
    const first = await llm.generate(request);
    const second = await llm.generate(request);
    expect(provider.calls).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(first.costUsd).toBeGreaterThan(0);
    expect(second).toMatchObject({ cached: true, costUsd: 0, value: valid });
  });

  it("retries once with the validation error, then succeeds", async () => {
    const provider = new ScriptedProvider([{ speaker: "Meera" }, valid]);
    const store = new MemoryCallStore();
    const llm = createLLM({ provider, store, caps });
    const { value } = await llm.generate(request);
    expect(value).toEqual(valid);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].messages.at(-1)?.content).toMatch(/didn't match the required format/);
    // Both attempts cost money, and both are logged.
    expect(store.calls).toHaveLength(2);
  });

  it("gives up after two invalid answers", async () => {
    const llm = createLLM({ provider: new ScriptedProvider([{}, {}]), store: new MemoryCallStore(), caps });
    await expect(llm.generate(request)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("retries a truncated answer with twice the room", async () => {
    const provider = new ScriptedProvider([new LLMError("cut off", "truncated"), valid]);
    const llm = createLLM({ provider, store: new MemoryCallStore(), caps });
    await llm.generate({ ...request, maxTokens: 1000 });
    expect(provider.calls.map((c) => c.maxTokens)).toEqual([1000, 2000]);
  });

  it("passes refusals to the caller without retrying", async () => {
    const provider = new ScriptedProvider([new LLMError("declined", "refusal")]);
    const llm = createLLM({ provider, store: new MemoryCallStore(), caps });
    await expect(llm.generate(request)).rejects.toMatchObject({ kind: "refusal" });
    expect(provider.calls).toHaveLength(1);
  });

  it("refuses a call that would go over the run cap, before calling the provider", async () => {
    const store = new MemoryCallStore();
    await store.record({
      cacheKey: "earlier",
      provider: "scripted",
      model: "claude-opus-5-5",
      tier: "smart",
      purpose: "earlier",
      runId: "run-1",
      usage,
      costUsd: 1.99,
      latencyMs: 1,
      output: {},
      fellBack: false,
      cacheable: true,
    });
    const provider = new ScriptedProvider([valid]);
    const llm = createLLM({ provider, store, caps });
    await expect(llm.generate({ ...request, runId: "run-1" })).rejects.toMatchObject({ kind: "budget" });
    expect(provider.calls).toHaveLength(0);
    // Other runs still work.
    await expect(llm.generate({ ...request, runId: "run-2" })).resolves.toMatchObject({ value: valid });
  });

  it("refuses calls over the daily cap", async () => {
    const llm = createLLM({ provider: new ScriptedProvider([valid]), store: new MemoryCallStore(), caps: { runUsd: 2, dailyUsd: 0.01 } });
    await expect(llm.generate(request)).rejects.toMatchObject({ kind: "budget" });
  });
});

describe("costUsd", () => {
  it("prices each kind of token", () => {
    // Opus 5.5: $4 in, $0.20 cache read, $5 cache write, $20 out, per million tokens.
    const cost = costUsd("claude-opus-5-5", {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(29.2, 5);
  });

  it("refuses to guess a price for an unknown model", () => {
    expect(() => costUsd("constructor", usage)).toThrow(/No price/);
  });
});

describe("DbCallStore", () => {
  it("caches, logs and totals calls in Postgres", async () => {
    const db = createDatabase({ url: "", pgliteDir: "memory://" });
    await migrateDatabase(db);
    const store = new DbCallStore(async () => db);
    const llm = createLLM({ provider: new ScriptedProvider([{}, valid]), store, caps });
    await llm.generate({ ...request, runId: "run-9" });

    const again = await llm.generate({ ...request, runId: "run-9" });
    expect(again.cached).toBe(true);
    // Two paid attempts: the invalid one and the valid one.
    expect(await store.spentForRun("run-9")).toBeCloseTo(2 * costUsd("claude-opus-5-5", usage), 6);
    expect(await store.spentSince(new Date(Date.now() - 60_000))).toBeGreaterThan(0);
  });
});
