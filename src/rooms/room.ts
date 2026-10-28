import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { roomEvents, rooms, roomSeats } from "@/db/schema";
import type { GameEvent } from "@/game/types";
import { seatNumber } from "./meta";

// What every room operation shares on the server: errors, the stored rows and the room lock.

export * from "./meta";

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

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

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
