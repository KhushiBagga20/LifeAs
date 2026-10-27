import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { nightIntent, pointIntent, voteIntent } from "@/ai/brain";
import { personasFor, type Persona } from "@/ai/personas";
import type { Database } from "@/db";
import { roomEvents, rooms, roomSeats } from "@/db/schema";
import { act, advance, createGame, DURATIONS, MAX_NAME, nightActors } from "@/game/engine";
import { MAX_SEATS, MIN_SEATS } from "@/game/lineup";
import { RuleError, type GameEvent, type GameState, type Intent, type Phase, type SeatId, type Settings } from "@/game/types";
import { viewFor, type SeatView } from "@/game/view";
import { createRng } from "@/lib/rng";

// The room service (DESIGN.md §3). The server owns every game: clients send intents with their
// seat token, and the engine decides. Time moves on "tick on read": every request first catches
// the game up to now, running timers and the AI's planned moves in time order.

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

/** A move an AI seat will make at a set time; the intent is worked out when it happens. */
type Plan = { seat: SeatId; kind: "night" | "vote" | "point"; dueAt: number; phase: Phase; round: number };

type Meta = {
  personas: Record<SeatId, Persona>;
  plans: Plan[];
  /** Which phase the plans are for ("round/phase"), so each phase is planned exactly once. */
  planned: string;
  /** Last chat time per human seat, for the rate limit. */
  chatAt: Record<SeatId, number>;
};

const CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const CHAT_GAP_MS = 1_200;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");
const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
const seatNumber = (id: SeatId) => Number(id.slice(1));

type RoomRow = typeof rooms.$inferSelect;
type SeatRow = typeof roomSeats.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Runs `fn` with the room locked, then saves what it changed. */
async function withRoom<T>(
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

function seatForToken(seats: SeatRow[], token: string | null): SeatRow | null {
  if (!token) return null;
  const hash = hashToken(token);
  return seats.find((s) => s.tokenHash === hash) ?? null;
}

function requireSeat(seats: SeatRow[], token: string | null): SeatRow {
  const seat = seatForToken(seats, token);
  if (!seat) throw new RoomError("forbidden", "You're not in this room");
  return seat;
}

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
      .values({ code, status: "lobby", settings, hostSeat: "s1", seed: input.seed ?? randomBytes(8).toString("hex"), state: null, meta: { personas: {}, plans: [], planned: "", chatAt: {} } satisfies Meta })
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
    const meta: Meta = { personas: Object.fromEntries(aiSeats.map((a) => [a.seatId, a.persona])), plans: [], planned: "", chatAt: {} };
    return { room: { status: "playing", state: step.state, meta }, events: step.events, result: { started: true } };
  });
}

const phaseStart = (s: GameState) => s.endsAt - (s.phase === "ended" ? 0 : DURATIONS[s.settings.pace][s.phase as Exclude<Phase, "ended">]);

/** The AI's moves for the phase that just began, spread out so they feel human. */
function planPhase(state: GameState, meta: Meta): Plan[] {
  const start = phaseStart(state);
  const length = state.endsAt - start;
  const rng = createRng(`${state.seed}/${state.round}/${state.phase}/plans`);
  const ai = state.seats.filter((s) => s.alive && s.kind === "ai" && meta.personas[s.id]);
  const at = (from: number, to: number) => start + Math.round(rng.float(from, to) * length);
  if (state.phase === "night") {
    const actors = new Set(nightActors(state).map((a) => a.seat));
    return ai.filter((s) => actors.has(s.id)).map((s) => ({ seat: s.id, kind: "night", dueAt: at(0.15, 0.7), phase: "night", round: state.round }));
  }
  if (state.phase === "vote") return ai.map((s) => ({ seat: s.id, kind: "vote", dueAt: at(0.15, 0.8), phase: "vote", round: state.round }));
  if (state.phase === "day") {
    return ai.filter(() => rng.chance(0.6)).map((s) => ({ seat: s.id, kind: "point", dueAt: at(0.3, 0.85), phase: "day", round: state.round }));
  }
  return [];
}

function aiIntent(plan: Plan, state: GameState, events: GameEvent[], meta: Meta): Intent | null {
  const { view, events: visible } = viewFor(state, events, plan.seat);
  const persona = meta.personas[plan.seat];
  if (!persona) return null;
  const salt = String(state.seq);
  if (plan.kind === "night") return nightIntent(view, visible, persona, salt);
  if (plan.kind === "vote") return voteIntent(view, visible, persona, salt);
  return pointIntent(view, visible, persona, salt);
}

/**
 * Catches a game up to `now`: AI moves and phase deadlines happen in time order, one phase at a
 * time, and each phase gets its AI plans when it begins. Returns the new state, meta and events.
 */
export function catchUp(state: GameState, meta: Meta, log: GameEvent[], now: number): { state: GameState; meta: Meta; events: GameEvent[] } {
  let s = state;
  let m = meta;
  const fresh: GameEvent[] = [];
  const run = (step: { state: GameState; events: GameEvent[] }) => {
    s = step.state;
    fresh.push(...step.events);
    return step.events.length > 0;
  };
  for (let guard = 0; guard < 1_000 && s.phase !== "ended"; guard++) {
    const key = `${s.round}/${s.phase}`;
    if (m.planned !== key) m = { ...m, planned: key, plans: planPhase(s, m) };
    const next = [...m.plans].sort((a, b) => a.dueAt - b.dueAt || seatNumber(a.seat) - seatNumber(b.seat))[0];
    if (next && next.dueAt <= now && next.dueAt <= s.endsAt) {
      m = { ...m, plans: m.plans.filter((p) => p !== next) };
      const intent = aiIntent(next, s, [...log, ...fresh], m);
      if (intent) {
        try {
          run(act(s, next.seat, intent, next.dueAt));
        } catch (error) {
          if (!(error instanceof RuleError)) throw error;
        }
      }
      // The last move of a night or vote ends it straight away.
      run(advance(s, next.dueAt));
      continue;
    }
    // Step to the phase deadline (or to now), never past it, so the next phase's AI gets its turn.
    if (!run(advance(s, Math.min(now, s.endsAt)))) break;
  }
  return { state: s, meta: m, events: fresh };
}

/** Moves the game on to now (if it's running) and returns what changed. */
function tick(room: RoomRow, events: GameEvent[], now: number) {
  if (room.status !== "playing" || !room.state) return null;
  const meta = room.meta as Meta;
  const caught = catchUp(room.state as GameState, meta, events, now);
  if (!caught.events.length && caught.meta.planned === meta.planned && caught.meta.plans.length === meta.plans.length) return null;
  return caught;
}

export async function actInRoom(deps: RoomDeps, code: string, token: string | null, intent: Intent) {
  const now = deps.clock();
  return withRoom(deps, code, async ({ room, seats, events }) => {
    const seat = requireSeat(seats, token);
    if (room.status === "lobby") throw new RoomError("bad-request", "The game hasn't started yet");
    let state = room.state as GameState;
    let meta = room.meta as Meta;
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
};

export async function pollRoom(deps: RoomDeps, code: string, token: string | null, since = -1): Promise<Poll> {
  const now = deps.clock();
  return withRoom(deps, code, async ({ room, seats, events }) => {
    const me = seatForToken(seats, token);
    const caught = tick(room, events, now);
    const state = caught?.state ?? (room.state as GameState | null);
    const meta = caught?.meta ?? (room.meta as Meta);
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
      },
    };
  });
}

/** For tests and tools: the raw events after `since`, unfiltered. */
export async function rawEvents({ db }: RoomDeps, code: string, since = -1) {
  const rows = await db.select().from(roomEvents).where(and(eq(roomEvents.roomCode, code), gt(roomEvents.seq, since))).orderBy(asc(roomEvents.seq));
  return rows.map((r) => r.event as GameEvent);
}
