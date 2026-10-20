import { boolean, index, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Drizzle table definitions. See DESIGN.md §4.1.

/** Every real AI call: the cost log, and the cache (by `cacheKey`). */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: serial("id").primaryKey(),
    cacheKey: text("cache_key").notNull().unique(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    tier: text("tier").notNull(),
    purpose: text("purpose").notNull(),
    runId: text("run_id"),
    inputTokens: integer("input_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    response: jsonb("response").notNull(),
    fellBack: boolean("fell_back").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_run_idx").on(t.runId), index("llm_calls_created_idx").on(t.createdAt)],
);

/** Compiled workplaces (DESIGN.md §4.2), keyed by career, options and seed. */
export const workplaces = pgTable("workplaces", {
  id: text("id").primaryKey(),
  careerCode: text("career_code").notNull(),
  options: jsonb("options").notNull(),
  seed: text("seed").notNull(),
  data: jsonb("data").notNull(),
  /** "ai" when a real model wrote it, "fake" when FakeLLM did. */
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
