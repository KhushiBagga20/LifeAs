import { randomBytes } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { personasFor, type Persona } from "@/ai/personas";
import { roomEvents, rooms, roomSeats } from "@/db/schema";
import { act, createGame, MAX_NAME } from "@/game/engine";
import { MAX_SEATS, MIN_SEATS } from "@/game/lineup";
import { RuleError, type GameEvent, type GameState, type Intent, type SeatId, type Settings } from "@/game/types";
import { viewFor, type SeatView } from "@/game/view";
import { hashToken, newMeta, readMeta, requireSeat, RoomError, seatForToken, withRoom, type RoomDeps } from "./room";
import { catchUp, react, tick } from "./timeline";

// The room service (DESIGN.md §3). The server owns every game: clients send intents with their
// seat token, and the engine decides. Time moves on "tick on read": every request first catches
// the game up to now, running timers and the AI's planned moves in time order (./timeline).

export { RoomError, type RoomDeps } from "./room";

export const DEFAULT_SETTINGS: Settings = { seats: 7, boss: true, influencer: true, pace: "normal" };
export const SettingsPatch = z.object({
  seats: z.number().int().min(MIN_SEATS).max(MAX_SEATS).optional(),
  boss: z.boolean().optional(),
  influencer: z.boolean().optional(),
  pace: z.enum(["quick", "normal"]).optional(),
});

const seat = z.string().regex(/^s\d{1,2}$/);
const text = z.string().max(1_000);
/** What a client may send to /act; the engine still checks every rule. */
export const IntentBody: z.ZodType<Intent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("crew-vote"), target: seat }),
  z.object({ type: z.literal("crew-chat"), text }),
  z.object({ type: z.literal("protect"), target: seat }),
  z.object({ type: z.literal("check"), target: seat }),
  z.object({ type: z.literal("chat"), text }),
  z.object({ type: z.literal("point"), target: seat.nullable() }),
  z.object({ type: z.literal("vote"), target: z.union([seat, z.literal("skip")]) }),
  z.object({ type: z.literal("ghost-chat"), text }),
]);

const CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const CHAT_GAP_MS = 1_200;

const newToken = () => randomBytes(24).toString("base64url");
const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

/** `seed` is for tests, so a game can be replayed; rooms made over HTTP always get a random one. */
export async function createRoom(deps: RoomDeps, input: { name: string; settings?: z.infer<typeof SettingsPatch>; seed?: string }) {
  const name = cleanName(input.name);
  if (!name) throw new RoomError("bad-request", "Pick a name first");
  const settings: Settings = { ...DEFAULT_SETTINGS, ...SettingsPatch.parse(input.settings ?? {}) };
  const token = newToken();
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from(randomBytes(4), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("");
    const inserted = await deps.db
      .insert(rooms)
      .values({ code, status: "lobby", settings, hostSeat: "s1", seed: input.seed ?? randomBytes(8).toString("hex"), state: null, meta: newMeta() })
      .onConflictDoNothing()
      .returning({ code: rooms.code });
    if (!inserted.length) continue;
    await deps.db.insert(roomSeats).values({ roomCode: code, seatId: "s1", name, kind: "human", tokenHash: hashToken(token) });
    return { code, seatId: "s1", token };
  }
  throw new Error("Couldn't find a free room code");
}

export async function joinRoom(deps: RoomDeps, code: string, input: { name: string }) {
  const base = cleanName(input.name);
  if (!base) throw new RoomError("bad-request", "Pick a name first");
  const token = newToken();
  return withRoom(deps, code, async ({ room, seats, tx }) => {
    if (room.status !== "lobby") throw new RoomError("started", "This game has already started");
    const settings = room.settings as Settings;
    if (seats.length >= settings.seats) throw new RoomError("full", "This room is full");
    // Keep names distinct so everyone can tell each other apart.
    let name = base;
    for (let i = 2; seats.some((s) => s.name.toLowerCase() === name.toLowerCase()); i++) name = `${base.slice(0, MAX_NAME - 2)} ${i}`;
    const seatId = `s${seats.length + 1}`;
    await tx.insert(roomSeats).values({ roomCode: room.code, seatId, name, kind: "human", tokenHash: hashToken(token) });
    return { room: {}, result: { seatId, token, name } };
  });
}

export async function updateSettings(deps: RoomDeps, code: string, token: string | null, patch: z.infer<typeof SettingsPatch>) {
  return withRoom(deps, code, async ({ room, seats }) => {
    const seat = requireSeat(seats, token);
    if (seat.seatId !== room.hostSeat) throw new RoomError("forbidden", "Only the host can change the settings");
    if (room.status !== "lobby") throw new RoomError("started", "The game has already started");
    const settings: Settings = { ...(room.settings as Settings), ...SettingsPatch.parse(patch) };
    if (settings.seats < seats.length) throw new RoomError("bad-request", `There are already ${seats.length} people in the room`);
    return { room: { settings }, result: settings };
  });
}

export async function startGame(deps: RoomDeps, code: string, token: string | null) {
  const now = deps.clock();
  return withRoom(deps, code, async ({ room, seats, tx }) => {
    const seat = requireSeat(seats, token);
    if (seat.seatId !== room.hostSeat) throw new RoomError("forbidden", "Only the host can start the game");
    if (room.status !== "lobby") throw new RoomError("started", "The game has already started");
    const settings = room.settings as Settings;
    // AI neighbours take every empty seat.
    const personas = personasFor(room.seed, settings.seats - seats.length, seats.map((s) => s.name));
    const aiSeats = personas.map((p, i) => ({ seatId: `s${seats.length + i + 1}`, name: p.name, persona: p }));
    if (aiSeats.length) {
      await tx.insert(roomSeats).values(aiSeats.map((a) => ({ roomCode: room.code, seatId: a.seatId, name: a.name, kind: "ai", tokenHash: null })));
    }
    const players = [
      ...seats.map((s) => ({ id: s.seatId, name: s.name, kind: "human" as const })),
      ...aiSeats.map((a) => ({ id: a.seatId, name: a.name, kind: "ai" as const })),
    ];
    const step = createGame({ players, settings, seed: room.seed, now });
    // The narrator's opening line is the first thing the talk scheduler queues.
    const meta = react(step.state, newMeta(Object.fromEntries(aiSeats.map((a) => [a.seatId, a.persona]))), step.events);
    return { room: { status: "playing", state: step.state, meta }, events: step.events, result: { started: true } };
  });
}

export async function actInRoom(deps: RoomDeps, code: string, token: string | null, intent: Intent) {
  const now = deps.clock();
  return withRoom(deps, code, async ({ room, seats, events }) => {
    const seat = requireSeat(seats, token);
    if (room.status === "lobby") throw new RoomError("bad-request", "The game hasn't started yet");
    let state = room.state as GameState;
    let meta = readMeta(room.meta);
    const fresh: GameEvent[] = [];
    const caught = tick(room, events, now);
    if (caught) {
      state = caught.state;
      meta = caught.meta;
      fresh.push(...caught.events);
    }
    if (intent.type === "chat" || intent.type === "crew-chat" || intent.type === "ghost-chat") {
      const last = meta.chatAt[seat.seatId] ?? 0;
      if (now - last < CHAT_GAP_MS) throw new RoomError("slow-down", "Slow down a little");
      meta = { ...meta, chatAt: { ...meta.chatAt, [seat.seatId]: now } };
    }
    try {
      const step = act(state, seat.seatId, intent, now);
      state = step.state;
      fresh.push(...step.events);
      // AI neighbours may want to answer.
      meta = react(state, meta, step.events);
    } catch (error) {
      if (error instanceof RuleError) throw new RoomError("rule", error.message);
      throw error;
    }
    // A human's move can finish a phase early.
    const after = catchUp(state, meta, [...events, ...fresh], now);
    state = after.state;
    meta = after.meta;
    fresh.push(...after.events);
    return { room: { state, meta, status: state.phase === "ended" ? "ended" : "playing" }, events: fresh, result: { ok: true } };
  });
}

export type Profile = { name: string; kind: "human" | "ai"; flat: string | null; job: string | null; look: Persona["look"] | null };

export type Poll = {
  code: string;
  status: "lobby" | "playing" | "ended";
  serverTime: number;
  me: { seatId: SeatId; host: boolean } | null;
  settings: Settings;
  /** Who's here: lobby members, then every seat once the game starts. */
  profiles: Record<SeatId, Profile>;
  view: SeatView | null;
  /** Events this seat may see with seq greater than `since`. */
  events: GameEvent[];
  lastSeq: number;
  /** AI neighbours writing a public message right now. */
  typing: SeatId[];
};

export async function pollRoom(deps: RoomDeps, code: string, token: string | null, since = -1): Promise<Poll> {
  const now = deps.clock();
  return withRoom(deps, code, async ({ room, seats, events }) => {
    const me = seatForToken(seats, token);
    const caught = tick(room, events, now);
    const state = caught?.state ?? (room.state as GameState | null);
    const meta = caught?.meta ?? readMeta(room.meta);
    const log = caught ? [...events, ...caught.events] : events;
    const status = state?.phase === "ended" ? "ended" : (room.status as Poll["status"]);
    const profiles: Record<SeatId, Profile> = Object.fromEntries(
      seats.map((s) => {
        const persona = meta.personas[s.seatId];
        return [s.seatId, { name: s.name, kind: s.kind as Profile["kind"], flat: persona?.flat ?? null, job: persona?.job ?? null, look: persona?.look ?? null }];
      }),
    );
    let view: SeatView | null = null;
    let visible: GameEvent[] = [];
    if (state) {
      const v = viewFor(state, log, me?.seatId ?? null);
      view = v.view;
      visible = v.events.filter((e) => e.seq > since);
    }
    return {
      room: caught ? { state, meta, status } : undefined,
      events: caught?.events,
      result: {
        code: room.code,
        status,
        serverTime: now,
        me: me ? { seatId: me.seatId, host: me.seatId === room.hostSeat } : null,
        settings: room.settings as Settings,
        profiles,
        view,
        events: visible,
        lastSeq: log.length ? log[log.length - 1].seq : -1,
        typing: meta.talks.filter((t) => t.kind === "chat" && t.seat && t.claimedAt !== null && now - t.claimedAt < 20_000).map((t) => t.seat!),
      },
    };
  });
}

/** For tests and tools: the raw events after `since`, unfiltered. */
export async function rawEvents({ db }: RoomDeps, code: string, since = -1) {
  const rows = await db.select().from(roomEvents).where(and(eq(roomEvents.roomCode, code), gt(roomEvents.seq, since))).orderBy(asc(roomEvents.seq));
  return rows.map((r) => r.event as GameEvent);
}
