import { createRng } from "@/lib/rng";
import { dealRoles, MAX_SEATS, MIN_SEATS } from "./lineup";
import { isCrew } from "./roles";
import {
  RuleError,
  type EventKind,
  type GameEvent,
  type GameState,
  type Intent,
  type Phase,
  type Seat,
  type SeatId,
  type Settings,
  type Visibility,
  type Winner,
} from "./types";

// The Block C engine (DESIGN.md §1). Pure: every function takes a state (and a time) and returns
// the next state plus the events it produced. Nothing here knows about rooms, networks or AI.

export const DURATIONS: Record<Settings["pace"], Record<Exclude<Phase, "ended">, number>> = {
  normal: { reveal: 8_000, night: 30_000, dawn: 10_000, day: 90_000, vote: 30_000, verdict: 8_000 },
  quick: { reveal: 6_000, night: 25_000, dawn: 8_000, day: 60_000, vote: 25_000, verdict: 6_000 },
};
export const MAX_TEXT = 280;
export const MAX_NAME = 20;

export type Player = { id: SeatId; name: string; kind: "human" | "ai" };
export type Step = { state: GameState; events: GameEvent[] };

const ALL: Visibility = { to: "all" };
const CREW: Visibility = { to: "crew" };
const only = (seat: SeatId): Visibility => ({ to: "seat", seat });

/** Collects a step's events, numbering them from the state's seq. */
function recorder(s: GameState, now: number) {
  const events: GameEvent[] = [];
  const add = (
    kind: EventKind,
    visibility: Visibility,
    fields: { actor?: SeatId | null; target?: SeatId | null; text?: string | null; data?: Record<string, unknown> } = {},
  ) => {
    events.push({
      seq: s.seq++,
      round: s.round,
      phase: s.phase,
      at: now,
      kind,
      actor: fields.actor ?? null,
      target: fields.target ?? null,
      text: fields.text ?? null,
      data: fields.data ?? {},
      visibility,
    });
  };
  return { events, add };
}

export const seatOf = (s: GameState, id: SeatId) => s.seats.find((x) => x.id === id);
export const living = (s: GameState) => s.seats.filter((x) => x.alive);

export function cleanText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) throw new RuleError("bad-text", "Say something first");
  if (t.length > MAX_TEXT) throw new RuleError("bad-text", `Keep it under ${MAX_TEXT} characters`);
  return t;
}

export function createGame({ players, settings, seed, now }: { players: Player[]; settings: Settings; seed: string; now: number }): Step {
  if (settings.seats < MIN_SEATS || settings.seats > MAX_SEATS) throw new Error(`Block C needs ${MIN_SEATS}–${MAX_SEATS} seats`);
  if (players.length !== settings.seats) throw new Error(`Expected ${settings.seats} players, got ${players.length}`);
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error("Seat ids must be unique");
  const roles = dealRoles(settings, createRng(`${seed}/roles`));
  const seats: Seat[] = players.map((p, i) => ({
    id: p.id,
    name: p.name.trim().slice(0, MAX_NAME) || `Seat ${i + 1}`,
    kind: p.kind,
    role: roles[i],
    alive: true,
    out: null,
  }));
  const s: GameState = {
    seed,
    settings,
    seats,
    phase: "reveal",
    round: 1,
    endsAt: now + DURATIONS[settings.pace].reveal,
    night: { crewVotes: {}, protect: null, check: null },
    lastProtected: null,
    pointers: {},
    votes: {},
    winner: null,
    viral: [],
    seq: 0,
  };
  const { events, add } = recorder(s, now);
  add("game-start", ALL, { data: { settings, seats: seats.map((x) => ({ id: x.id, name: x.name, kind: x.kind })) } });
  for (const seat of seats) add("role", only(seat.id), { target: seat.id, data: { role: seat.role } });
  add("crew-roster", CREW, { data: { crew: seats.filter((x) => isCrew(x.role)).map((x) => ({ id: x.id, role: x.role })) } });
  add("phase", ALL, { data: { phase: s.phase, endsAt: s.endsAt } });
  return { state: s, events };
}

/** A seat asks to do something. Throws RuleError if the rules don't allow it now. */
export function act(state: GameState, seatId: SeatId, intent: Intent, now: number): Step {
  const s = structuredClone(state);
  const seat = seatOf(s, seatId);
  if (!seat) throw new RuleError("unknown-seat", "You're not in this game");
  if (s.phase === "ended") throw new RuleError("game-over", "The game is over");
  const { events, add } = recorder(s, now);
  const requirePhase = (...ok: Phase[]) => {
    if (!ok.includes(s.phase)) throw new RuleError("not-now", `You can't do that during ${s.phase}`);
  };
  const requireAlive = () => {
    if (!seat.alive) throw new RuleError("not-allowed", "You're out of the game");
  };
  const target = (id: SeatId, { notSelf = true, notCrew = false } = {}) => {
    const t = seatOf(s, id);
    if (!t || !t.alive) throw new RuleError("bad-target", "Pick someone who's still in the game");
    if (notSelf && t.id === seat.id) throw new RuleError("bad-target", "Pick someone else");
    if (notCrew && isCrew(t.role)) throw new RuleError("bad-target", "That's one of yours");
    return t;
  };

  switch (intent.type) {
    case "crew-vote": {
      requirePhase("night");
      requireAlive();
      if (!isCrew(seat.role)) throw new RuleError("not-allowed", "Only the crew picks a target");
      const t = target(intent.target, { notCrew: true });
      s.night.crewVotes[seat.id] = t.id;
      add("crew-vote", CREW, { actor: seat.id, target: t.id });
      break;
    }
    case "crew-chat": {
      requirePhase("reveal", "night");
      requireAlive();
      if (!isCrew(seat.role)) throw new RuleError("not-allowed", "Only the crew can talk in the crew chat");
      add("crew-chat", CREW, { actor: seat.id, text: cleanText(intent.text) });
      break;
    }
    case "protect": {
      requirePhase("night");
      requireAlive();
      if (seat.role !== "medic") throw new RuleError("not-allowed", "Only the Medic protects");
      const t = target(intent.target, { notSelf: false });
      if (t.id === s.lastProtected) throw new RuleError("bad-target", "You can't protect the same person two nights running");
      s.night.protect = t.id;
      break;
    }
    case "check": {
      requirePhase("night");
      requireAlive();
      if (seat.role !== "undercover") throw new RuleError("not-allowed", "Only the Undercover checks people");
      s.night.check = target(intent.target).id;
      break;
    }
    case "chat": {
      requirePhase("dawn", "day", "vote", "verdict");
      requireAlive();
      add("chat", ALL, { actor: seat.id, text: cleanText(intent.text) });
      break;
    }
    case "point": {
      requirePhase("day");
      requireAlive();
      if (intent.target === null) delete s.pointers[seat.id];
      else s.pointers[seat.id] = target(intent.target).id;
      add("point", ALL, { actor: seat.id, target: intent.target });
      break;
    }
    case "vote": {
      requirePhase("vote");
      requireAlive();
      s.votes[seat.id] = intent.target === "skip" ? "skip" : target(intent.target).id;
      add("vote", ALL, { actor: seat.id, target: intent.target === "skip" ? null : intent.target, data: { skip: intent.target === "skip" } });
      break;
    }
    case "ghost-chat": {
      if (seat.alive) throw new RuleError("not-allowed", "Only people who are out can use the ghost chat");
      add("ghost-chat", { to: "dead" }, { actor: seat.id, text: cleanText(intent.text) });
      break;
    }
  }
  return { state: s, events };
}

/** Everyone who still has a night action, and whether they've taken it. */
export function nightActors(s: GameState): { seat: SeatId; done: boolean }[] {
  return living(s).flatMap((x) => {
    if (isCrew(x.role)) return [{ seat: x.id, done: x.id in s.night.crewVotes }];
    if (x.role === "medic") return [{ seat: x.id, done: s.night.protect !== null }];
    if (x.role === "undercover") return [{ seat: x.id, done: s.night.check !== null }];
    return [];
  });
}

function phaseComplete(s: GameState): boolean {
  if (s.phase === "night") return nightActors(s).every((a) => a.done);
  if (s.phase === "vote") return living(s).every((x) => x.id in s.votes);
  return false;
}

/** The crew's target: the most votes; a tie goes to the Boss's pick, otherwise nobody. */
export function crewTarget(s: GameState): SeatId | null {
  const votes = Object.entries(s.night.crewVotes).filter(([voter, t]) => seatOf(s, voter)?.alive && seatOf(s, t)?.alive);
  if (!votes.length) return null;
  const tally = new Map<SeatId, number>();
  for (const [, t] of votes) tally.set(t, (tally.get(t) ?? 0) + 1);
  const max = Math.max(...tally.values());
  const top = [...tally].filter(([, n]) => n === max).map(([t]) => t);
  if (top.length === 1) return top[0];
  const boss = living(s).find((x) => x.role === "boss");
  const bossPick = boss ? s.night.crewVotes[boss.id] : undefined;
  return bossPick && top.includes(bossPick) ? bossPick : null;
}

export function checkWinner(s: GameState): Winner | null {
  const alive = living(s);
  const crew = alive.filter((x) => isCrew(x.role)).length;
  const others = alive.length - crew;
  if (crew === 0) return { team: "block", reason: "Every crew member is out." };
  if (crew >= others) return { team: "crew", reason: "The crew outnumber everyone left." };
  return null;
}

function enter(s: GameState, phase: Phase, now: number, add: ReturnType<typeof recorder>["add"]) {
  s.phase = phase;
  s.endsAt = phase === "ended" ? now : now + DURATIONS[s.settings.pace][phase as Exclude<Phase, "ended">];
  if (phase === "ended") {
    add("game-end", ALL, {
      data: { winner: s.winner, viral: s.viral, roles: s.seats.map((x) => ({ id: x.id, role: x.role, alive: x.alive })) },
    });
    return;
  }
  add("phase", ALL, { data: { phase, endsAt: s.endsAt } });
}

function resolveNight(s: GameState, add: ReturnType<typeof recorder>["add"]) {
  const target = crewTarget(s);
  const medic = living(s).find((x) => x.role === "medic");
  const undercover = living(s).find((x) => x.role === "undercover");
  if (undercover && s.night.check) {
    const checked = seatOf(s, s.night.check)!;
    const result = isCrew(checked.role) && checked.role !== "boss" ? "crew" : "clear";
    add("check-result", only(undercover.id), { actor: undercover.id, target: checked.id, data: { result } });
  }
  const protectedSeat = medic ? s.night.protect : null;
  if (target && target === protectedSeat) {
    add("protect-held", only(medic!.id), { actor: medic!.id, target });
    add("quiet-night", ALL);
  } else if (target) {
    const victim = seatOf(s, target)!;
    victim.alive = false;
    victim.out = { round: s.round, cause: "night" };
    add("night-out", ALL, { target, data: { role: victim.role } });
  } else {
    add("quiet-night", ALL);
  }
  s.lastProtected = protectedSeat;
  s.night = { crewVotes: {}, protect: null, check: null };
  s.winner = checkWinner(s);
}

function resolveVote(s: GameState, add: ReturnType<typeof recorder>["add"]) {
  const tally: Record<string, number> = {};
  let skips = 0;
  for (const voter of living(s)) {
    const v = s.votes[voter.id];
    if (v === undefined) continue;
    if (v === "skip") skips++;
    else tally[v] = (tally[v] ?? 0) + 1;
  }
  const counts = Object.values(tally);
  const max = counts.length ? Math.max(...counts) : 0;
  const top = Object.keys(tally).filter((t) => tally[t] === max);
  if (max > 0 && max > skips && top.length === 1) {
    const out = seatOf(s, top[0])!;
    out.alive = false;
    out.out = { round: s.round, cause: "vote" };
    add("voted-out", ALL, { target: out.id, data: { role: out.role, tally, skips } });
    if (out.role === "influencer") {
      s.viral.push(out.id);
      add("viral", ALL, { target: out.id });
    }
  } else {
    add("no-verdict", ALL, { data: { tally, skips } });
  }
  s.pointers = {};
  s.votes = {};
  s.winner = checkWinner(s);
}

function transition(s: GameState, now: number, add: ReturnType<typeof recorder>["add"]) {
  switch (s.phase) {
    case "reveal":
      return enter(s, "night", now, add);
    case "night":
      resolveNight(s, add);
      return enter(s, "dawn", now, add);
    case "dawn":
      return enter(s, s.winner ? "ended" : "day", now, add);
    case "day":
      return enter(s, "vote", now, add);
    case "vote":
      resolveVote(s, add);
      return enter(s, "verdict", now, add);
    case "verdict":
      if (s.winner) return enter(s, "ended", now, add);
      s.round++;
      return enter(s, "night", now, add);
    case "ended":
      return;
  }
}

/**
 * Moves the game on: the current phase ends when its time is up, or early when everyone who
 * has something to do has done it. Catches up through several phases if a lot of time passed.
 */
export function advance(state: GameState, now: number): Step {
  const s = structuredClone(state);
  const { events, add } = recorder(s, now);
  for (let guard = 0; guard < 16 && s.phase !== "ended"; guard++) {
    if (now < s.endsAt && !phaseComplete(s)) break;
    // A phase that times out ends at its deadline, not "now", so catching up keeps the rhythm.
    transition(s, now >= s.endsAt ? s.endsAt : now, add);
  }
  return { state: s, events };
}

/** The narrator's text for everyone; written by the AI, placed by the room service. */
export function narrate(state: GameState, text: string, now: number): Step {
  const s = structuredClone(state);
  const { events, add } = recorder(s, now);
  add("narration", ALL, { text: text.trim().slice(0, 600) });
  return { state: s, events };
}
