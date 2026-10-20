import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLLM } from "@/llm";
import { FakeProvider } from "@/llm/fake";
import { MemoryCallStore } from "@/llm/store";
import { registerEngineFakers } from "@/engine/fakes";
import { CareerProfile, Meta } from "@/lib/onet/types";

// Test helpers: the committed O*NET data, read straight from disk (no Next.js cache), and a
// FakeLLM wired like the app's.

const DIR = "src/data/onet";

export const loadMeta = () => Meta.parse(JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")));

export const loadProfile = (code: string) =>
  CareerProfile.parse(JSON.parse(readFileSync(join(DIR, "profiles", `${code}.json`), "utf8")));

export const allProfileCodes = () => readdirSync(join(DIR, "profiles")).map((f) => f.replace(/\.json$/, ""));

export function fakeLLM(provider = registerEngineFakers(new FakeProvider())) {
  return createLLM({ provider, store: new MemoryCallStore(), caps: { runUsd: 2, dailyUsd: 10 } });
}
