import { z } from "zod";
import type { Price } from "./prices";
import { LLMError, type LLMProvider, type ProviderRequest, type ProviderResponse, type Tier } from "./types";

// Azure adapter for a Microsoft Foundry / Azure OpenAI deployment, over the v1 Chat Completions
// API (no api-version): POST {resource}/openai/v1/chat/completions with the key in the `api-key`
// header and the deployment name as `model`. Structured output uses response_format json_schema
// in strict mode; the schema is converted to the subset strict mode accepts, and zod still
// validates the full schema afterwards in the AI layer. Plain fetch, no SDK.

export type AzureConfig = {
  /** The v1 base URL, ending in /openai/v1. */
  baseUrl: string;
  apiKey: string;
  deployment: string;
  price: Price;
};

export class AzureConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AzureConfigError";
  }
}

// e.g. <resource>.openai.azure.com, <resource>.services.ai.azure.com, and sovereign clouds.
const AZURE_HOST = /\.azure\.(com|us|cn)$/i;

/** Normalises AZURE_AI_ENDPOINT to the v1 base URL. Only https Azure hosts are accepted. */
export function azureBaseUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new AzureConfigError("AZURE_AI_ENDPOINT isn't a valid URL");
  }
  if (url.protocol !== "https:") throw new AzureConfigError("AZURE_AI_ENDPOINT must use https");
  if (!AZURE_HOST.test(url.hostname)) {
    throw new AzureConfigError("AZURE_AI_ENDPOINT must be an Azure endpoint, e.g. https://<resource>.openai.azure.com");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/openai/v1")) return `${url.origin}${path}`;
  if (path === "" || path === "/openai") return `${url.origin}/openai/v1`;
  throw new AzureConfigError(
    "AZURE_AI_ENDPOINT should be the resource endpoint (https://<resource>.openai.azure.com or " +
      "https://<resource>.services.ai.azure.com), or a URL ending in /openai/v1; project endpoints aren't supported here",
  );
}

const PRICE_VARS = {
  input: "AZURE_AI_PRICE_INPUT",
  cacheRead: "AZURE_AI_PRICE_CACHED_INPUT",
  output: "AZURE_AI_PRICE_OUTPUT",
} as const;

/** Reads the Azure settings from server-side environment variables; names, never values, in errors. */
export function azureConfigFromEnv(env: Record<string, string | undefined>): AzureConfig {
  const missing = ["AZURE_AI_ENDPOINT", "AZURE_AI_API_KEY", "AZURE_AI_DEPLOYMENT", ...Object.values(PRICE_VARS)].filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new AzureConfigError(
      `Azure needs ${missing.join(", ")}. Prices are US dollars per million tokens for your deployment, used for the spending caps.`,
    );
  }
  const deployment = env.AZURE_AI_DEPLOYMENT!.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(deployment)) throw new AzureConfigError("AZURE_AI_DEPLOYMENT isn't a valid deployment name");
  const number = (name: string) => {
    const value = Number(env[name]);
    if (!Number.isFinite(value) || value < 0) throw new AzureConfigError(`${name} must be a price in US dollars per million tokens`);
    return value;
  };
  const input = number(PRICE_VARS.input);
  return {
    baseUrl: azureBaseUrl(env.AZURE_AI_ENDPOINT!),
    apiKey: env.AZURE_AI_API_KEY!.trim(),
    deployment,
    // No separate price is configured for prompt-cache writes; they're counted as ordinary input.
    price: { input, cacheRead: number(PRICE_VARS.cacheRead), cacheWrite: input, output: number(PRICE_VARS.output) },
  };
}

type JsonSchema = Record<string, unknown>;

// Keywords strict mode rejects (Microsoft Learn, structured outputs). zod enforces them instead.
const UNSUPPORTED = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "patternProperties",
  "unevaluatedProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "unevaluatedItems",
  "contains",
  "minContains",
  "maxContains",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
]);

/**
 * Converts a zod schema to the JSON Schema subset strict structured outputs accept: no
 * unsupported keywords, every property required, additionalProperties false. Optional fields
 * can't be expressed, so AI output schemas must use .nullable() instead of .optional().
 */
export function strictSchema(schema: z.ZodType): JsonSchema {
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== "object") return node;
    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(node as JsonSchema)) {
      if (UNSUPPORTED.has(key)) continue;
      if (key === "properties") {
        out.properties = Object.fromEntries(Object.entries(value as JsonSchema).map(([k, v]) => [k, walk(v, `${path}.${k}`)]));
      } else {
        out[key] = walk(value, `${path}.${key}`);
      }
    }
    if (out.type === "object" || out.properties) {
      const keys = Object.keys((out.properties as JsonSchema | undefined) ?? {});
      const required = new Set((node as { required?: string[] }).required ?? []);
      const optional = keys.filter((k) => !required.has(k));
      if (optional.length) {
        throw new Error(`AI output schemas can't have optional fields (${path || "root"}: ${optional.join(", ")}); use .nullable() instead`);
      }
      out.required = keys;
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(z.toJSONSchema(schema), "") as JsonSchema;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type Options = {
  config: AzureConfig;
  fetch?: FetchLike;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt, for 408, 429, 5xx, timeouts and network errors. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

const EFFORT: Record<Tier, "low" | "medium"> = { fast: "low", smart: "medium" };
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_WAIT_MS = 20_000;

type ChatCompletion = {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
  };
};

type AzureErrorBody = { error?: { code?: string; message?: string; param?: string } };

export class AzureProvider implements LLMProvider {
  readonly name = "azure";
  readonly price: Price;
  private readonly config: AzureConfig;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Turned off if the deployment rejects reasoning_effort (support varies by model). */
  private sendEffort = true;

  constructor({ config, fetch: fetchImpl = fetch, timeoutMs = 90_000, maxRetries = 2, sleep }: Options) {
    this.config = config;
    this.price = config.price;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  modelFor(): string {
    return this.config.deployment;
  }

  private body(request: ProviderRequest) {
    return {
      model: this.config.deployment,
      messages: [{ role: "system", content: request.system }, ...request.messages],
      max_completion_tokens: request.maxTokens,
      ...(this.sendEffort ? { reasoning_effort: EFFORT[request.tier] } : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.purpose.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "output",
          strict: true,
          schema: strictSchema(request.schema),
        },
      },
    };
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    let lastProblem = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", "api-key": this.config.apiKey },
          body: JSON.stringify(this.body(request)),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        lastProblem = timedOut ? `timed out after ${this.timeoutMs} ms` : "network error";
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt, null));
          continue;
        }
        throw new LLMError(`Azure request ${lastProblem}`, "provider", { cause: error });
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as AzureErrorBody;
        const code = body.error?.code ?? "";
        const message = (body.error?.message ?? "").slice(0, 300);
        // Some deployments don't take reasoning_effort: drop it and try again straight away.
        if (response.status === 400 && this.sendEffort && (body.error?.param === "reasoning_effort" || /reasoning_effort/.test(message))) {
          this.sendEffort = false;
          attempt--;
          continue;
        }
        lastProblem = `${response.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`;
        if (RETRYABLE.has(response.status) && attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt, response.headers));
          continue;
        }
        if (code === "content_filter") throw new LLMError(`Azure content filter: ${message}`, "refusal");
        throw new LLMError(`Azure API error ${lastProblem}`, "provider");
      }

      const data = (await response.json().catch(() => null)) as ChatCompletion | null;
      const choice = data?.choices?.[0];
      if (!data || !choice?.message) throw new LLMError("Azure returned a response without a message", "provider");
      if (choice.message.refusal) throw new LLMError(`Azure model declined: ${choice.message.refusal.slice(0, 200)}`, "refusal");
      if (choice.finish_reason === "content_filter") throw new LLMError("Azure content filter stopped the answer", "refusal");
      if (choice.finish_reason === "length") throw new LLMError(`Output hit max_completion_tokens (${request.maxTokens})`, "truncated");

      const text = choice.message.content ?? "";
      let output: unknown = text;
      try {
        output = JSON.parse(text);
      } catch {
        // Not JSON: hand the text to the AI layer, whose validation retry shows the model what it wrote.
      }
      const prompt = data.usage?.prompt_tokens ?? 0;
      const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const written = data.usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
      return {
        output,
        model: this.config.deployment,
        fellBack: false,
        usage: {
          inputTokens: Math.max(0, prompt - cached - written),
          cacheReadTokens: cached,
          cacheWriteTokens: written,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    }
    throw new LLMError(`Azure request failed: ${lastProblem}`, "provider");
  }

  /** How long to wait before retrying: the server's retry-after if given, else exponential backoff. */
  private backoff(attempt: number, headers: Headers | null): number {
    const ms = Number(headers?.get("retry-after-ms"));
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_WAIT_MS);
    const seconds = Number(headers?.get("retry-after"));
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
    return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), MAX_WAIT_MS);
  }
}
