import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeProvider } from "@/llm/claude";
import type { ProviderRequest } from "@/llm/types";

const schema = z.object({ answer: z.string() });

function request(tier: "fast" | "smart", model: string): ProviderRequest {
  return {
    tier,
    model,
    purpose: "test",
    system: "Stable instructions.",
    messages: [{ role: "user", content: "Hello" }],
    schema,
    maxTokens: 1234,
    seedSalt: "",
  };
}

/** A stand-in for the SDK client that records the request and returns a canned message. */
function fakeClient(message: Record<string, unknown>) {
  const seen: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          seen.push(params);
          return {
            model: params.model,
            stop_reason: "end_turn",
            stop_details: null,
            content: [{ type: "text", text: '{"answer":"hi"}' }],
            parsed_output: { answer: "hi" },
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
            ...message,
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, seen };
}

describe("ClaudeProvider", () => {
  it("defaults both tiers to Claude Opus 5.5 and lets env choose others", () => {
    expect(new ClaudeProvider({ client: fakeClient({}).client }).modelFor("fast")).toBe("claude-opus-5-5");
    const custom = new ClaudeProvider({ client: fakeClient({}).client, models: { fast: "claude-haiku-5-5" } });
    expect(custom.modelFor("fast")).toBe("claude-haiku-5-5");
    expect(custom.modelFor("smart")).toBe("claude-opus-5-5");
  });

  it("sends a cached system prompt, structured output, effort by tier and the Opus fallback", async () => {
    const { client, seen } = fakeClient({});
    const response = await new ClaudeProvider({ client }).generate(request("fast", "claude-opus-5-5"));
    const params = seen[0];
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 1234,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: "Stable instructions.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "Hello" }],
      output_config: { effort: "low" },
    });
    expect((params.output_config as { format: unknown }).format).toBeDefined();
    expect(params).not.toHaveProperty("thinking");
    expect(response).toMatchObject({
      output: { answer: "hi" },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 20 },
      fellBack: false,
    });
  });

  it("uses medium effort for the smart tier and no fallback on Haiku", async () => {
    const { client, seen } = fakeClient({});
    const provider = new ClaudeProvider({ client });
    await provider.generate(request("smart", "claude-opus-5-5"));
    await provider.generate(request("fast", "claude-haiku-5-5"));
    expect(seen[0]).toMatchObject({ output_config: { effort: "medium" } });
    expect(seen[1]).not.toHaveProperty("fallbacks");
    expect(seen[1]).not.toHaveProperty("betas");
  });

  it("reports when a fallback model answered", async () => {
    const { client } = fakeClient({
      model: "claude-opus-4-8",
      content: [{ type: "fallback" }, { type: "text", text: '{"answer":"hi"}' }],
    });
    const response = await new ClaudeProvider({ client }).generate(request("fast", "claude-opus-5-5"));
    expect(response).toMatchObject({ fellBack: true, model: "claude-opus-4-8" });
  });

  it("turns refusals and cut-off answers into typed errors", async () => {
    const refused = fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" } });
    await expect(new ClaudeProvider({ client: refused.client }).generate(request("fast", "claude-opus-5-5"))).rejects.toMatchObject({
      kind: "refusal",
    });
    const cut = fakeClient({ stop_reason: "max_tokens" });
    await expect(new ClaudeProvider({ client: cut.client }).generate(request("fast", "claude-opus-5-5"))).rejects.toMatchObject({
      kind: "truncated",
    });
  });

  it("wraps network failures as provider errors", async () => {
    const client = { beta: { messages: { parse: async () => Promise.reject(new Error("socket hang up")) } } } as unknown as Anthropic;
    await expect(new ClaudeProvider({ client }).generate(request("fast", "claude-opus-5-5"))).rejects.toMatchObject({
      kind: "provider",
    });
  });
});
