import type { Usage } from "./types";

// US dollars per million tokens, Anthropic list prices as cached on 2026-10-06.
// Cache writes are 1.25× input (5-minute cache); cache reads as published, except Haiku 5.5's,
// which isn't listed and is assumed to be 10% of input like the other models.
const PRICES: Record<string, { input: number; cacheRead: number; cacheWrite: number; output: number }> = {
  "claude-opus-5-5": { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
  // Server-side fallback targets for refusals.
  "claude-opus-5": { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  "claude-opus-4-8": { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  fake: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
};

export const isPriced = (model: string) => Object.hasOwn(PRICES, model);

export function priceFor(model: string) {
  const price = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!price) throw new Error(`No price for model ${model}; add it to src/llm/prices.ts`);
  return price;
}

export function costUsd(model: string, usage: Usage): number {
  const p = priceFor(model);
  const dollars =
    usage.inputTokens * p.input +
    usage.cacheReadTokens * p.cacheRead +
    usage.cacheWriteTokens * p.cacheWrite +
    usage.outputTokens * p.output;
  return Number((dollars / 1_000_000).toFixed(6));
}

/** Worst-case cost of a call before it's made, for budget checks. ~4 characters per token. */
export function estimateCostUsd(model: string, promptChars: number, maxTokens: number): number {
  const p = priceFor(model);
  return (Math.ceil(promptChars / 4) * p.input + maxTokens * p.output) / 1_000_000;
}
