import { createHash } from "node:crypto";
import { z } from "zod";
import { getReadyDb } from "@/db/migrate";
import { ClaudeProvider } from "./claude";
import { FakeProvider } from "./fake";
import { costUsd, estimateCostUsd, isPriced } from "./prices";
import { DbCallStore, MemoryCallStore, type CallStore } from "./store";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResult, type Message, type Tier } from "./types";

export { LLMError } from "./types";
export type { LLMRequest, LLMResult, Tier } from "./types";

const DEFAULT_MAX_TOKENS: Record<Tier, number> = { fast: 4_000, smart: 16_000 };
const MAX_TOKENS_CEILING = 32_000;
const CONCURRENCY = 6;

export type Caps = {
  /** Most one run may spend, in US dollars. */
  runUsd: number;
  /** Most all calls together may spend in a UTC day, in US dollars. */
  dailyUsd: number;
};

export type LLM = {
  readonly provider: LLMProvider;
  generate<T>(request: LLMRequest<T>): Promise<LLMResult<T>>;
};

function cacheKey(provider: string, model: string, request: LLMRequest<unknown>, maxTokens: number): string {
  const payload = JSON.stringify([
    provider,
    model,
    request.tier,
    request.purpose,
    request.system,
    request.messages,
    z.toJSONSchema(request.schema),
    request.seedSalt ?? "",
    maxTokens,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Limits how many provider calls run at once. */
function semaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

export function createLLM({ provider, store, caps }: { provider: LLMProvider; store: CallStore; caps: Caps }): LLM {
  const limit = semaphore(CONCURRENCY);

  async function generate<T>(request: LLMRequest<T>): Promise<LLMResult<T>> {
    const model = provider.modelFor(request.tier);
    let maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS[request.tier];
    const key = cacheKey(provider.name, model, request as LLMRequest<unknown>, maxTokens);

    const hit = await store.lookup(key);
    if (hit) {
      const parsed = request.schema.safeParse(hit.output);
      if (parsed.success) {
        return {
          value: parsed.data,
          provider: hit.provider,
          model: hit.model,
          usage: hit.usage,
          costUsd: 0,
          latencyMs: 0,
          cached: true,
          fellBack: hit.fellBack,
        };
      }
    }

    let messages: Message[] = request.messages;
    let lastIssue = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const promptChars = request.system.length + messages.reduce((n, m) => n + m.content.length, 0);
      const estimate = estimateCostUsd(model, promptChars, maxTokens);
      if (request.runId && (await store.spentForRun(request.runId)) + estimate > caps.runUsd) {
        throw new LLMError(`Run ${request.runId} would go over its $${caps.runUsd} cap`, "budget");
      }
      if ((await store.spentSince(startOfUtcDay())) + estimate > caps.dailyUsd) {
        throw new LLMError(`Today's AI spending would go over the $${caps.dailyUsd} cap`, "budget");
      }

      const started = Date.now();
      let response;
      try {
        response = await limit(() =>
          provider.generate({
            tier: request.tier,
            model,
            purpose: request.purpose,
            system: request.system,
            messages,
            schema: request.schema,
            maxTokens,
            seedSalt: request.seedSalt ?? "",
          }),
        );
      } catch (error) {
        // One retry with more room when the answer was cut off; everything else goes to the caller.
        if (error instanceof LLMError && error.kind === "truncated" && attempt === 1) {
          maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_CEILING);
          continue;
        }
        throw error;
      }
      const latencyMs = Date.now() - started;
      // A fallback model answers under its own name and price.
      const cost = costUsd(isPriced(response.model) ? response.model : model, response.usage);
      const parsed = request.schema.safeParse(response.output);

      await store.record({
        cacheKey: key,
        provider: provider.name,
        model: response.model,
        tier: request.tier,
        purpose: request.purpose,
        runId: request.runId ?? null,
        usage: response.usage,
        costUsd: cost,
        latencyMs,
        output: response.output,
        fellBack: response.fellBack,
        cacheable: parsed.success,
      });

      if (parsed.success) {
        return {
          value: parsed.data,
          provider: provider.name,
          model: response.model,
          usage: response.usage,
          costUsd: cost,
          latencyMs,
          cached: false,
          fellBack: response.fellBack,
        };
      }

      // One retry that shows the model what didn't validate.
      lastIssue = z.prettifyError(parsed.error);
      messages = [
        ...request.messages,
        { role: "assistant", content: JSON.stringify(response.output) },
        {
          role: "user",
          content: `That answer didn't match the required format:\n${lastIssue}\nAnswer again with valid output only.`,
        },
      ];
    }
    throw new LLMError(`AI output for ${request.purpose} failed validation twice: ${lastIssue}`, "invalid");
  }

  return { provider, generate };
}

let shared: LLM | undefined;

/**
 * The app's AI layer, configured from the environment:
 * - LLM_PROVIDER: "claude" or "fake" (default: claude when ANTHROPIC_API_KEY is set, otherwise fake)
 * - LLM_SMART_MODEL / LLM_FAST_MODEL: model ids per tier (default claude-opus-5-5 for both)
 * - LLM_RUN_CAP_USD / LLM_DAILY_CAP_USD: spending caps (default $2 per run, $10 per day)
 */
export function getLLM(): LLM {
  if (shared) return shared;
  const env = process.env;
  const useClaude = (env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "claude" : "fake")) === "claude";
  const caps = {
    runUsd: Number(env.LLM_RUN_CAP_USD ?? 2),
    dailyUsd: Number(env.LLM_DAILY_CAP_USD ?? 10),
  };
  shared = useClaude
    ? createLLM({
        provider: new ClaudeProvider({ models: { smart: env.LLM_SMART_MODEL, fast: env.LLM_FAST_MODEL } }),
        store: new DbCallStore(getReadyDb),
        caps,
      })
    : createLLM({ provider: new FakeProvider(), store: new MemoryCallStore(), caps });
  return shared;
}
