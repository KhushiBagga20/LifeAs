import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LLMError, type LLMProvider, type ProviderRequest, type ProviderResponse, type Tier } from "./types";

// Claude adapter. Structured output via betaZodOutputFormat; the system prompt is the cached
// prefix; effort is set per tier (thinking stays adaptive, the only mode on these models).
// Opus 5.5 requests opt into server-side fallback so a policy refusal is retried on the
// recommended fallback model instead of failing the moment. Haiku 5.5 has no fallback.

export const DEFAULT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MODELS_WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const EFFORT: Record<Tier, "low" | "medium"> = { fast: "low", smart: "medium" };

type Options = {
  client?: Anthropic;
  models?: Partial<Record<Tier, string>>;
};

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly models: Record<Tier, string>;

  constructor({ client, models = {} }: Options = {}) {
    this.client = client ?? new Anthropic({ maxRetries: 3, timeout: 90_000 });
    this.models = {
      fast: models.fast ?? DEFAULT_MODEL,
      smart: models.smart ?? DEFAULT_MODEL,
    };
  }

  modelFor(tier: Tier): string {
    return this.models[tier];
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const model = request.model;
    const withFallback = MODELS_WITH_FALLBACK.has(model);
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model,
        max_tokens: request.maxTokens,
        ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        messages: request.messages,
        output_config: { effort: EFFORT[request.tier], format: betaZodOutputFormat(request.schema) },
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(`Claude API error ${error.status ?? ""}: ${error.message}`, "provider", { cause: error });
      }
      throw new LLMError("Claude request failed", "provider", { cause: error });
    }

    if (response.stop_reason === "refusal") {
      throw new LLMError(`Claude declined (${response.stop_details?.category ?? "unknown"})`, "refusal");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LLMError(`Output hit max_tokens (${request.maxTokens})`, "truncated");
    }

    const fellBack = response.content.some((block) => block.type === "fallback");
    return {
      output: response.parsed_output,
      model: response.model,
      fellBack,
      usage: {
        inputTokens: response.usage.input_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
