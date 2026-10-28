import { eq } from "drizzle-orm";
import { checkNarration, Narration, NARRATOR_SYSTEM } from "@/ai/narrator";
import { CHAT_SYSTEM, ChatReply, checkMessage } from "@/ai/talk";
import { rooms } from "@/db/schema";
import type { GameState } from "@/game/types";
import { LLMError, type LLM } from "@/llm";
import { readMeta, withRoom, type Meta, type RoomDeps, type SeatRow } from "./room";
import { tick } from "./timeline";
import { applyWritten, pickWork, profilesFor, type Work, type Written } from "./voices";

// The talk runner (DESIGN.md §2, §3): after a request is answered, it claims the AI lines that
// are due, has the model write them (outside the room lock, so nobody waits), then posts them if
// the moment hasn't passed. Templates stand in when there's no model or the room's budget is spent.

export type TalkDeps = RoomDeps & { llm: LLM };

const LLM_TIMEOUT_MS = 20_000;

const profilesOf = (seats: SeatRow[], meta: Meta) => profilesFor(seats.map((s) => ({ id: s.seatId, name: s.name })), meta);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function logProblem(what: string, error: unknown) {
  // A spent budget is expected; anything else is worth seeing in the server log.
  if (error instanceof LLMError && error.kind === "budget") return;
  console.warn(`AI ${what} fell back to a template:`, error instanceof Error ? error.message : error);
}

/** Has the model write one piece of work; the template answers if anything goes wrong. */
async function write(llm: LLM, code: string, w: Work): Promise<Written> {
  const fallback: Written = { message: w.fallback, pointAt: null, suspects: [], trusts: [] };
  try {
    if (w.job.kind === "narrate") {
      const result = await withTimeout(
        llm.generate({ tier: "smart", purpose: "narrate", system: NARRATOR_SYSTEM, messages: [{ role: "user", content: w.prompt }], schema: Narration, runId: `room:${code}`, seedSalt: w.job.id, maxTokens: 2_000 }),
        LLM_TIMEOUT_MS,
      );
      const text = checkNarration(result.value.text);
      return text ? { ...fallback, message: text } : fallback;
    }
    const result = await withTimeout(
      llm.generate({ tier: "fast", purpose: "ai-chat", system: CHAT_SYSTEM, messages: [{ role: "user", content: w.prompt }], schema: ChatReply, runId: `room:${code}`, seedSalt: w.job.id, maxTokens: 1_500 }),
      LLM_TIMEOUT_MS,
    );
    const message = "seat" in w ? checkMessage(result.value.message, w.persona, w.role, w.job.kind) : null;
    return message ? { ...result.value, message } : fallback;
  } catch (error) {
    logProblem(w.job.kind === "narrate" ? "narration" : "chat", error);
    return fallback;
  }
}

/** Posts what was written, if its moment hasn't passed. */
async function commit(deps: TalkDeps, code: string, work: Work[], written: Written[]): Promise<number> {
  const now = deps.clock();
  return withRoom(deps, code, async ({ room, seats, events }) => {
    if (!room.state) return { result: 0 };
    const caught = tick(room, events, now);
    const state = caught?.state ?? (room.state as GameState);
    const meta = caught?.meta ?? readMeta(room.meta);
    const log = [...events, ...(caught?.events ?? [])];
    const done = applyWritten(state, meta, log, profilesOf(seats, meta), work, written, now);
    const fresh = [...(caught?.events ?? []), ...done.events];
    return { room: { state: done.state, meta: done.meta, status: done.state.phase === "ended" ? "ended" : "playing" }, events: fresh, result: done.posted };
  });
}

/**
 * Runs whatever AI talk is due in a room: claims it, writes it, posts it. Safe to call after
 * every request; it returns quickly when nothing is due. Returns how many lines were posted.
 */
export async function runTalk(deps: TalkDeps, code: string): Promise<number> {
  const now = deps.clock();
  // A cheap look first, without the lock: most polls have nothing to do.
  const [peek] = await deps.db.select({ meta: rooms.meta, status: rooms.status }).from(rooms).where(eq(rooms.code, code.toUpperCase()));
  if (!peek || peek.status === "lobby") return 0;
  const pending = readMeta(peek.meta).talks;
  if (peek.status === "ended" && !pending.length) return 0;

  const work = await withRoom(deps, code, async ({ room, seats, events }) => {
    if (room.status === "lobby" || !room.state) return { result: [] as Work[] };
    const caught = tick(room, events, now);
    const state = caught?.state ?? (room.state as GameState);
    const before = caught?.meta ?? readMeta(room.meta);
    const log = [...events, ...(caught?.events ?? [])];
    const picked = pickWork(state, before, log, profilesOf(seats, before), now);
    const changed = caught !== null || JSON.stringify(picked.meta) !== JSON.stringify(before);
    return {
      room: changed ? { state, meta: picked.meta, status: state.phase === "ended" ? "ended" : "playing" } : undefined,
      events: caught?.events,
      result: picked.work,
    };
  });
  if (!work.length) return 0;
  const written = await Promise.all(work.map((w) => write(deps.llm, code.toUpperCase(), w)));
  return commit(deps, code, work, written);
}
