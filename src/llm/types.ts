import type { z } from "zod";
import type { Price } from "./prices";

// The app's AI layer (DESIGN.md §3, §4.9). Callers ask for a tier and a zod schema; they never
// see provider SDKs. Every result is validated before it reaches them.

/** smart: compiler, task review, report, ask a senior. fast: character lines, resolve, director. */
export type Tier = "fast" | "smart";

export type Message = { role: "user" | "assistant"; content: string };

export type LLMRequest<T> = {
  tier: Tier;
  /** What the call is for, e.g. "compile-workplace". Used for logs and by FakeLLM. */
  purpose: string;
  /** Stable instructions first: this is the cached prefix, so keep volatile data out of it. */
  system: string;
  messages: Message[];
  schema: z.ZodType<T>;
  /** Run the cost counts against, if any. */
  runId?: string;
  /** Extra cache-key input, e.g. a seed, so the same prompt can give different results. */
  seedSalt?: string;
  maxTokens?: number;
};

export type Usage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type LLMResult<T> = {
  value: T;
  provider: string;
  model: string;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  /** True when the answer came from the cache (cost 0). */
  cached: boolean;
  /** True when the provider's fallback model answered after a refusal. */
  fellBack: boolean;
};

/** What a provider returns before validation. */
export type ProviderResponse = {
  /** The parsed JSON the model returned, not yet validated. */
  output: unknown;
  model: string;
  usage: Usage;
  fellBack: boolean;
};

export type ProviderRequest = {
  tier: Tier;
  model: string;
  purpose: string;
  system: string;
  messages: Message[];
  schema: z.ZodType;
  maxTokens: number;
  seedSalt: string;
};

export interface LLMProvider {
  readonly name: string;
  /** The provider's own price, for deployments not in src/llm/prices.ts (e.g. Azure). */
  readonly price?: Price;
  modelFor(tier: Tier): string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "truncated" | "invalid" | "budget" | "provider",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LLMError";
  }
}
