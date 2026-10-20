import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compileWorkplace, CompilerDraft, RepairPatch, validateWorkplace } from "@/engine/compiler";
import { fakeCompilerDraft } from "@/engine/fakes";
import { createRng } from "@/lib/rng";
import { chooseProvider, createLLM, providerFromEnv } from "@/llm";
import { AzureConfigError, azureBaseUrl, azureConfigFromEnv, AzureProvider, strictSchema, type AzureConfig } from "@/llm/azure";
import { MemoryCallStore } from "@/llm/store";
import type { ProviderRequest } from "@/llm/types";
import { loadMeta, loadProfile } from "./helpers";

// A fake key that would be easy to spot if it ever leaked into an error or log.
const KEY = "test-key-should-never-appear-0123456789";
const env = {
  AZURE_AI_ENDPOINT: "https://my-resource.openai.azure.com/",
  AZURE_AI_API_KEY: KEY,
  AZURE_AI_DEPLOYMENT: "gpt-6-astra",
  AZURE_AI_PRICE_INPUT: "10",
  AZURE_AI_PRICE_CACHED_INPUT: "1",
  AZURE_AI_PRICE_OUTPUT: "50",
};
const config: AzureConfig = azureConfigFromEnv(env);

const Answer = z.object({
  greeting: z.string().min(1).max(80),
  mood: z.enum(["calm", "busy"]),
  score: z.number().int().min(1).max(5),
  tags: z.array(z.string()).min(1).max(3),
  note: z.string().nullable(),
});
const valid = { greeting: "Morning!", mood: "busy", score: 4, tags: ["standup"], note: null };

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    tier: "fast",
    model: "gpt-6-astra",
    purpose: "smoke-test",
    system: "Stable instructions.",
    messages: [{ role: "user", content: "Hello" }],
    schema: Answer,
    maxTokens: 500,
    seedSalt: "",
    ...overrides,
  };
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** A fetch that answers from a script and records each request. */
function scriptedFetch(answers: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next.clone();
  };
  return { calls, fetchImpl };
}

const completion = (content: unknown, extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: "gpt-6-astra-2026-08-01",
      choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content), refusal: null }, ...extra }],
      usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1024 }, ...usage },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const apiError = (status: number, error: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message: "nope", ...error } }), { status, headers: { "content-type": "application/json", ...headers } });

const noSleep = async () => {};
const provider = (answers: Parameters<typeof scriptedFetch>[0], options: { timeoutMs?: number; maxRetries?: number } = {}) => {
  const f = scriptedFetch(answers);
  const waits: number[] = [];
  const p = new AzureProvider({ config, fetch: f.fetchImpl, sleep: async (ms) => void waits.push(ms), ...options });
  return { p, calls: f.calls, waits };
};

describe("Azure configuration", () => {
  it("reads the endpoint, key, deployment and prices from server-side variables", () => {
    expect(config).toEqual({
      baseUrl: "https://my-resource.openai.azure.com/openai/v1",
      apiKey: KEY,
      deployment: "gpt-6-astra",
      price: { input: 10, cacheRead: 1, cacheWrite: 10, output: 50 },
    });
  });

  it("names missing variables without showing any values", () => {
    const attempt = () => azureConfigFromEnv({ AZURE_AI_ENDPOINT: env.AZURE_AI_ENDPOINT, AZURE_AI_API_KEY: KEY });
    expect(attempt).toThrow(AzureConfigError);
    expect(attempt).toThrow(/AZURE_AI_DEPLOYMENT, AZURE_AI_PRICE_INPUT, AZURE_AI_PRICE_CACHED_INPUT, AZURE_AI_PRICE_OUTPUT/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain(KEY);
    }
  });

  it("normalises the endpoint to the v1 base URL", () => {
    expect(azureBaseUrl("https://r.openai.azure.com")).toBe("https://r.openai.azure.com/openai/v1");
    expect(azureBaseUrl("https://r.services.ai.azure.com/")).toBe("https://r.services.ai.azure.com/openai/v1");
    expect(azureBaseUrl("https://r.openai.azure.com/openai/v1/")).toBe("https://r.openai.azure.com/openai/v1");
    expect(azureBaseUrl("https://r.cognitiveservices.azure.com/openai")).toBe("https://r.cognitiveservices.azure.com/openai/v1");
  });

  it("rejects endpoints that aren't https Azure resource endpoints", () => {
    expect(() => azureBaseUrl("http://r.openai.azure.com")).toThrow(/https/);
    expect(() => azureBaseUrl("https://example.com/openai/v1")).toThrow(/Azure endpoint/);
    expect(() => azureBaseUrl("https://r.services.ai.azure.com/api/projects/p")).toThrow(/project endpoints/);
    expect(() => azureBaseUrl("not a url")).toThrow(/valid URL/);
  });

  it("rejects bad prices and deployment names", () => {
    expect(() => azureConfigFromEnv({ ...env, AZURE_AI_PRICE_OUTPUT: "lots" })).toThrow(/AZURE_AI_PRICE_OUTPUT must be a price/);
    expect(() => azureConfigFromEnv({ ...env, AZURE_AI_DEPLOYMENT: "bad name/../x" })).toThrow(/deployment name/);
  });

  it("chooses the provider from the environment", () => {
    expect(chooseProvider({})).toBe("fake");
    expect(chooseProvider(env)).toBe("azure");
    expect(chooseProvider({ ...env, ANTHROPIC_API_KEY: "x" })).toBe("claude");
    expect(chooseProvider({ ...env, ANTHROPIC_API_KEY: "x", LLM_PROVIDER: "azure" })).toBe("azure");
    expect(chooseProvider({ ...env, LLM_PROVIDER: "fake" })).toBe("fake");
    expect(() => chooseProvider({ LLM_PROVIDER: "gpt" })).toThrow(/must be claude, azure or fake/);
    expect(providerFromEnv(env).name).toBe("azure");
    expect(() => providerFromEnv({ LLM_PROVIDER: "azure" })).toThrow(AzureConfigError);
  });

  it("is never configured through NEXT_PUBLIC_ variables", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk("src");
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/NEXT_PUBLIC_(AZURE|ANTHROPIC|LLM)/);
  });
});

describe("strictSchema", () => {
  it("makes every property required, closes objects and drops keywords strict mode rejects", () => {
    const schema = strictSchema(Answer) as Record<string, unknown> & { properties: Record<string, Record<string, unknown>> };
    expect(schema.required).toEqual(["greeting", "mood", "score", "tags", "note"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema).not.toHaveProperty("$schema");
    const text = JSON.stringify(schema);
    for (const keyword of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]) expect(text).not.toContain(keyword);
    expect(schema.properties.mood.enum).toEqual(["calm", "busy"]);
  });

  it("handles the compiler's real schemas, nested objects included", () => {
    for (const s of [CompilerDraft, RepairPatch]) {
      const text = JSON.stringify(strictSchema(s));
      expect(text).not.toMatch(/"(minLength|maxLength|pattern|minItems|maxItems|minimum|maximum)"/);
    }
    const draft = strictSchema(CompilerDraft) as { properties: { cast: { items: { additionalProperties: boolean; required: string[] } } } };
    expect(draft.properties.cast.items.additionalProperties).toBe(false);
    expect(draft.properties.cast.items.required).toContain("goals");
  });

  it("refuses optional fields, which strict mode can't express", () => {
    expect(() => strictSchema(z.object({ a: z.string().optional() }))).toThrow(/use .nullable\(\)/);
  });
});

describe("AzureProvider requests", () => {
  it("posts to the v1 chat completions route with the api-key header and the deployment as model", async () => {
    const { p, calls } = provider([completion(valid)]);
    await p.generate(request());
    const [call] = calls;
    expect(call.url).toBe("https://my-resource.openai.azure.com/openai/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe(KEY);
    expect(headers).not.toHaveProperty("authorization");
    expect(call.url).not.toContain("api-version");
    expect(call.body).toMatchObject({
      model: "gpt-6-astra",
      messages: [
        { role: "system", content: "Stable instructions." },
        { role: "user", content: "Hello" },
      ],
      max_completion_tokens: 500,
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: "smoke-test", strict: true } },
    });
    expect(call.body).not.toHaveProperty("max_tokens");
    expect(call.body).not.toHaveProperty("temperature");
  });

  it("uses medium reasoning effort for the smart tier", async () => {
    const { p, calls } = provider([completion(valid)]);
    await p.generate(request({ tier: "smart" }));
    expect(calls[0].body.reasoning_effort).toBe("medium");
  });
});

describe("AzureProvider responses", () => {
  it("parses the JSON answer and maps usage, cached tokens included", async () => {
    const { p } = provider([completion(valid, {}, { prompt_tokens_details: { cached_tokens: 1024, cache_write_tokens: 100 } })]);
    const response = await p.generate(request());
    expect(response).toEqual({
      output: valid,
      model: "gpt-6-astra",
      fellBack: false,
      usage: { inputTokens: 76, cacheReadTokens: 1024, cacheWriteTokens: 100, outputTokens: 80 },
    });
  });

  it("passes non-JSON text on for the AI layer's validation retry", async () => {
    const { p } = provider([completion("Sure! Here's your answer: greeting Morning")]);
    expect((await p.generate(request())).output).toBe("Sure! Here's your answer: greeting Morning");
  });

  it("turns refusals, filtered answers and cut-off answers into typed errors", async () => {
    await expect(provider([completion(valid, { message: { content: null, refusal: "I can't help with that." } })]).p.generate(request())).rejects.toMatchObject({ kind: "refusal" });
    await expect(provider([completion(valid, { finish_reason: "content_filter" })]).p.generate(request())).rejects.toMatchObject({ kind: "refusal" });
    await expect(provider([apiError(400, { code: "content_filter" })]).p.generate(request())).rejects.toMatchObject({ kind: "refusal" });
    await expect(provider([completion(valid, { finish_reason: "length" })]).p.generate(request())).rejects.toMatchObject({ kind: "truncated" });
  });

  it("rejects a response without a message", async () => {
    const empty = new Response(JSON.stringify({ choices: [] }), { status: 200 });
    await expect(provider([empty]).p.generate(request())).rejects.toMatchObject({ kind: "provider" });
  });
});

describe("AzureProvider failures", () => {
  it("doesn't retry auth errors, and never puts the key in the error", async () => {
    const { p, calls } = provider([apiError(401, { code: "Unauthorized", message: "Access denied due to invalid subscription key." })]);
    const error = await p.generate(request()).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "provider" });
    expect(String((error as Error).message)).toMatch(/401 Unauthorized/);
    expect(String((error as Error).message)).not.toContain(KEY);
    expect(calls).toHaveLength(1);
  });

  it("waits as long as a 429 asks, then succeeds", async () => {
    const { p, calls, waits } = provider([apiError(429, {}, { "retry-after-ms": "1500" }), completion(valid)]);
    expect((await p.generate(request())).output).toEqual(valid);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1500]);
  });

  it("honours retry-after in seconds and caps long waits", async () => {
    const { p, waits } = provider([apiError(429, {}, { "retry-after": "3" }), apiError(503, {}, { "retry-after": "999" }), completion(valid)]);
    await p.generate(request());
    expect(waits).toEqual([3000, 20000]);
  });

  it("gives up after the retry budget on repeated server errors", async () => {
    const { p, calls } = provider([apiError(500)], { maxRetries: 2 });
    await expect(p.generate(request())).rejects.toMatchObject({ kind: "provider", message: expect.stringMatching(/500/) });
    expect(calls).toHaveLength(3);
  });

  it("retries network errors", async () => {
    const { p, calls } = provider([new TypeError("fetch failed"), completion(valid)]);
    expect((await p.generate(request())).output).toEqual(valid);
    expect(calls).toHaveLength(2);
  });

  it("times out a hung request, retries, then reports the timeout", async () => {
    // A fetch that only ends when the request's own timeout aborts it.
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    let attempts = 0;
    const p = new AzureProvider({
      config,
      timeoutMs: 30,
      maxRetries: 1,
      sleep: noSleep,
      fetch: (url, init) => {
        attempts++;
        return hang(url, init);
      },
    });
    await expect(p.generate(request())).rejects.toMatchObject({ kind: "provider", message: expect.stringMatching(/timed out after 30 ms/) });
    expect(attempts).toBe(2);
  });

  it("drops reasoning_effort if the deployment doesn't support it, and remembers", async () => {
    const { p, calls } = provider([
      apiError(400, { code: "unsupported_parameter", param: "reasoning_effort", message: "Unsupported parameter: 'reasoning_effort'." }),
      completion(valid),
      completion(valid),
    ]);
    await p.generate(request());
    await p.generate(request());
    expect(calls.map((c) => "reasoning_effort" in c.body)).toEqual([true, false, false]);
  });
});

describe("Azure through the AI layer", () => {
  const llmWith = (answers: Parameters<typeof scriptedFetch>[0], dailyUsd = 10) => {
    const f = scriptedFetch(answers);
    const p = new AzureProvider({ config, fetch: f.fetchImpl, sleep: noSleep });
    return { llm: createLLM({ provider: p, store: new MemoryCallStore(), caps: { runUsd: 2, dailyUsd } }), calls: f.calls };
  };
  const generate = (llm: ReturnType<typeof llmWith>["llm"]) =>
    llm.generate({ tier: "fast", purpose: "smoke-test", system: "Stable instructions.", messages: [{ role: "user", content: "Hello" }], schema: Answer, maxTokens: 500 });

  it("prices calls with the deployment's configured price", async () => {
    const { llm } = llmWith([completion(valid)]);
    const result = await generate(llm);
    // 176 input × $10 + 1024 cached × $1 + 80 output × $50, per million tokens.
    expect(result.costUsd).toBeCloseTo((176 * 10 + 1024 * 1 + 80 * 50) / 1e6, 6);
    expect(result.model).toBe("gpt-6-astra");
  });

  it("retries malformed output once with the validation error, within the zod schema", async () => {
    const { llm, calls } = llmWith([completion({ greeting: "", mood: "angry" }), completion(valid)]);
    expect((await generate(llm)).value).toEqual(valid);
    expect(calls).toHaveLength(2);
    const retry = calls[1].body.messages as { role: string; content: string }[];
    expect(retry.at(-1)?.content).toMatch(/didn't match the required format/);
  });

  it("stops at the spending cap before calling Azure", async () => {
    const { llm, calls } = llmWith([completion(valid)], 0.0001);
    await expect(generate(llm)).rejects.toMatchObject({ kind: "budget" });
    expect(calls).toHaveLength(0);
  });

  it("drives the career compiler unchanged: validation, repair and fallback still apply", async () => {
    // Azure answers with what FakeLLM's compiler would write, but every moment points at an
    // unknown place; the repair pass fixes it through the same provider.
    const f = {
      calls: [] as Call[],
      fetchImpl: async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } };
        f.calls.push({ url, init, body });
        const req = { messages: body.messages.slice(1) } as unknown as ProviderRequest;
        const draft = fakeCompilerDraft(req, createRng("azure"));
        if (body.response_format.json_schema.name === "compile-workplace") {
          return completion({ ...draft, moments: draft.moments.map((m) => ({ ...m, locationKey: "moon" })) });
        }
        const ask = JSON.parse(body.messages.at(-1)!.content) as { replace: { moments: number[] } };
        return completion({ cast: [], moments: draft.moments.filter((m) => ask.replace.moments.includes(m.n)), locations: null, you: null, meters: null });
      },
    };
    const p = new AzureProvider({ config, fetch: f.fetchImpl, sleep: noSleep });
    const llm = createLLM({ provider: p, store: new MemoryCallStore(), caps: { runUsd: 2, dailyUsd: 10 } });
    const profile = loadProfile("29-1141.00");
    const { workplace, report } = await compileWorkplace(
      { profile, meta: loadMeta(), options: { level: "junior", workplace: "", location: "", length: "quick" }, seed: "azure" },
      llm,
    );
    expect(report.calls).toBe(2);
    expect(report.repairIssues.some((i) => /moon/.test(i))).toBe(true);
    expect(validateWorkplace(workplace, profile)).toEqual([]);
    expect(f.calls.map((c) => (c.body as { response_format: { json_schema: { name: string } } }).response_format.json_schema.name)).toEqual([
      "compile-workplace",
      "compile-workplace-repair",
    ]);
  });
});
