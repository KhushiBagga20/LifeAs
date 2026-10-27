import { createLLM } from "@/llm";
import { FakeProvider } from "@/llm/fake";
import { MemoryCallStore } from "@/llm/store";

/** A FakeLLM wired like the app's, for tests. */
export function fakeLLM(provider = new FakeProvider()) {
  return createLLM({ provider, store: new MemoryCallStore(), caps: { runUsd: 2, dailyUsd: 10 } });
}
