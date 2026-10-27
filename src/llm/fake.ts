import { z } from "zod";
import { createRng, type Rng } from "@/lib/rng";
import type { LLMProvider, ProviderRequest, ProviderResponse } from "./types";

// FakeLLM: deterministic, schema-valid answers with seeded variety, for every automated test and
// most UI work (DESIGN.md §8). The same request always gets the same answer. Purpose-specific
// fakers (registered by the game) produce realistic content; anything without
// one gets a generic answer built from its JSON schema.

export type Faker = (request: ProviderRequest, rng: Rng) => unknown;

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
};

const WORDS = [
  "schedule", "client", "report", "deadline", "team", "update", "review", "plan", "budget",
  "shift", "notes", "meeting", "draft", "follow-up", "priority", "handover", "checklist", "brief",
];

function fakeString(schema: JsonSchema, rng: Rng): string {
  const words = rng.int(2, 6);
  let text = Array.from({ length: words }, () => rng.pick(WORDS)).join(" ");
  text = text[0].toUpperCase() + text.slice(1);
  if (schema.minLength && text.length < schema.minLength) text = text.padEnd(schema.minLength, ".");
  if (schema.maxLength && text.length > schema.maxLength) text = text.slice(0, schema.maxLength);
  return text;
}

function fakeNumber(schema: JsonSchema, rng: Rng, integer: boolean): number {
  const min = schema.minimum ?? (schema.exclusiveMinimum != null ? schema.exclusiveMinimum + (integer ? 1 : 1e-6) : 0);
  const max = schema.maximum ?? (schema.exclusiveMaximum != null ? schema.exclusiveMaximum - (integer ? 1 : 1e-6) : min + 10);
  return integer ? rng.int(Math.ceil(min), Math.floor(max)) : Number(rng.float(min, max).toFixed(2));
}

export function fakeFromSchema(schema: JsonSchema, rng: Rng, root: JsonSchema = schema): unknown {
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const target = root.$defs?.[name];
    if (!target) throw new Error(`FakeLLM can't resolve ${schema.$ref}`);
    return fakeFromSchema(target, rng, root);
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return rng.pick(schema.enum);
  const options = schema.anyOf ?? schema.oneOf;
  if (options) {
    const nonNull = options.filter((o) => o.type !== "null");
    return fakeFromSchema(rng.pick(nonNull.length ? nonNull : options), rng, root);
  }
  const types = Array.isArray(schema.type) ? schema.type.filter((t) => t !== "null") : [schema.type];
  const type = types[0];
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        out[key] = fakeFromSchema(value, rng, root);
      }
      return out;
    }
    case "array": {
      const min = schema.minItems ?? 1;
      const max = Math.max(min, schema.maxItems ?? min + 2);
      return Array.from({ length: rng.int(min, max) }, () => fakeFromSchema(schema.items ?? {}, rng, root));
    }
    case "string":
      return fakeString(schema, rng);
    case "integer":
      return fakeNumber(schema, rng, true);
    case "number":
      return fakeNumber(schema, rng, false);
    case "boolean":
      return rng.chance(0.5);
    default:
      return null;
  }
}

export class FakeProvider implements LLMProvider {
  readonly name = "fake";
  /** Every request seen, for tests. */
  readonly calls: ProviderRequest[] = [];
  private readonly fakers = new Map<string, Faker>();

  register(purpose: string, faker: Faker): this {
    this.fakers.set(purpose, faker);
    return this;
  }

  modelFor(): string {
    return "fake";
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    const rng = createRng(
      JSON.stringify([request.purpose, request.seedSalt, request.system, request.messages]),
    );
    const faker = this.fakers.get(request.purpose);
    const output = faker
      ? faker(request, rng)
      : fakeFromSchema(z.toJSONSchema(request.schema) as JsonSchema, rng);
    const promptChars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      output,
      model: "fake",
      fellBack: false,
      usage: {
        inputTokens: Math.ceil(promptChars / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: Math.ceil(JSON.stringify(output).length / 4),
      },
    };
  }
}
