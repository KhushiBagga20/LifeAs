import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { NarrationMoment } from "@/ai/narrator";
import type { Persona } from "@/ai/personas";
import type { TalkReason } from "@/ai/talk";
import type { Database } from "@/db";
import { roomEvents, rooms, roomSeats } from "@/db/schema";
import type { GameEvent, Phase, SeatId } from "@/game/types";

// What every room operation shares: errors, the stored room shape and the room lock.

export type Clock = () => number;
export type RoomDeps = { db: Database; clock: Clock };

export class RoomError extends Error {
  constructor(
    readonly code: "not-found" | "forbidden" | "full" | "started" | "bad-request" | "slow-down" | "rule",
    message: string,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

/** A move an AI seat will make at a set time; the intent is worked out when it happens. */
export type Plan = { seat: SeatId; kind: "night" | "vote" | "point"; dueAt: number; phase: Phase; round: number };

/** Something an AI (or the narrator) will say; the words are written when it's due. */
export type TalkJob = {
  id: string;
  /** null: whoever's turn it is, chosen when the job runs. */
  seat: SeatId | null;
  dueAt: number;
  phase: Phase;
  round: number;
  /** When a worker took the job, so two requests never do the same work. */
  claimedAt: number | null;
} & ({ kind: "chat" | "crew-chat"; reason: TalkReason } | { kind: "narrate"; moment: NarrationMoment });

export type Meta = {
  personas: Record<SeatId, Persona>;
  plans: Plan[];
  /** Which phase the plans are for ("round/phase"), so each phase is planned exactly once. */
  planned: string;
  /** Last chat time per human seat, for the rate limit. */
  chatAt: Record<SeatId, number>;
  talks: TalkJob[];
  /** AI messages posted per "round/phase", for the talk budget. */
  talked: Record<string, number>;
  /** When each AI last spoke. */
  spokeAt: Record<SeatId, number>;
  /** What the chat has persuaded each AI of (seat → target → score). */
  opinions: Record<SeatId, Record<SeatId, number>>;
  /** Undercover AIs who revealed themselves, and who they named. */
  claimed: Record<SeatId, SeatId>;
};

export const newMeta = (personas: Meta["personas"] = {}): Meta => ({
  personas,
  plans: [],
  planned: "",
  chatAt: {},
  talks: [],
  talked: {},
  spokeAt: {},
  opinions: {},
  claimed: {},
});

/** Meta as stored, with defaults for fields added after the room was made. */
export const readMeta = (raw: unknown): Meta => ({ ...newMeta(), ...(raw as Partial<Meta>) });

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const seatNumber = (id: SeatId) => Number(id.slice(1));

export type RoomRow = typeof rooms.$inferSelect;
export type SeatRow = typeof roomSeats.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Runs `fn` with the room locked, then saves what it changed. */
export async function withRoom<T>(
  { db }: RoomDeps,
  code: string,
  fn: (ctx: { room: RoomRow; seats: SeatRow[]; events: GameEvent[]; tx: Tx }) => Promise<{ room?: Partial<RoomRow>; events?: GameEvent[]; result: T }>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [room] = await tx.select().from(rooms).where(eq(rooms.code, code.toUpperCase())).for("update");
    if (!room) throw new RoomError("not-found", "No room with that code");
    const seats = (await tx.select().from(roomSeats).where(eq(roomSeats.roomCode, room.code))).sort((a, b) => seatNumber(a.seatId) - seatNumber(b.seatId));
    const events = room.status === "lobby" ? [] : (await tx.select().from(roomEvents).where(eq(roomEvents.roomCode, room.code)).orderBy(asc(roomEvents.seq))).map((r) => r.event as GameEvent);
    const out = await fn({ room, seats, events, tx });
    if (out.events?.length) {
      await tx.insert(roomEvents).values(out.events.map((e) => ({ roomCode: room.code, seq: e.seq, event: e })));
    }
    if (out.room) {
      await tx.update(rooms).set({ ...out.room, version: room.version + 1, updatedAt: new Date() }).where(eq(rooms.code, room.code));
    }
    return out.result;
  });
}

export function seatForToken(seats: SeatRow[], token: string | null): SeatRow | null {
  if (!token) return null;
  const hash = hashToken(token);
  return seats.find((s) => s.tokenHash === hash) ?? null;
}

export function requireSeat(seats: SeatRow[], token: string | null): SeatRow {
  const seat = seatForToken(seats, token);
  if (!seat) throw new RoomError("forbidden", "You're not in this room");
  return seat;
}
