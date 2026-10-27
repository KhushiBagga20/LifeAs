import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

// Drizzle table definitions. Game tables (rooms, seats, events) arrive in G2; see DESIGN.md §3.

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

/** A Block C room (DESIGN.md §3): the lobby, then the game's state once it starts. */
export const rooms = pgTable("rooms", {
  code: text("code").primaryKey(),
  status: text("status").notNull(), // "lobby" | "playing" | "ended"
  settings: jsonb("settings").notNull(),
  hostSeat: text("host_seat").notNull(),
  seed: text("seed").notNull(),
  /** The engine's GameState once the game has started. */
  state: jsonb("state"),
  /** AI bookkeeping: personas, planned moves, chat rate limits. */
  meta: jsonb("meta").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Who sits where. Humans hold a token (stored hashed); AI seats have none. */
export const roomSeats = pgTable(
  "room_seats",
  {
    roomCode: text("room_code").notNull(),
    seatId: text("seat_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // "human" | "ai"
    tokenHash: text("token_hash"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomCode, t.seatId] })],
);

/** The game's append-only event log, one row per engine event. */
export const roomEvents = pgTable(
  "room_events",
  {
    roomCode: text("room_code").notNull(),
    seq: integer("seq").notNull(),
    event: jsonb("event").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomCode, t.seq] })],
);
