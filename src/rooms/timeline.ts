import { nightIntent, pointIntent, voteIntent } from "@/ai/brain";
import type { TalkReason } from "@/ai/talk";
import { act, advance, DURATIONS, nightActors } from "@/game/engine";
import { isCrew } from "@/game/roles";
import { RuleError, type GameEvent, type GameState, type Intent, type Phase, type SeatId } from "@/game/types";
import { viewFor } from "@/game/view";
import { createRng } from "@/lib/rng";
import { readMeta, seatNumber, type Meta, type Plan, type TalkJob } from "./meta";
import type { RoomRow } from "./room";

// Game time for a room (DESIGN.md §3): "tick on read" catch-up, the AI's planned moves, and the
// talk scheduler that decides when AI neighbours and the narrator should speak. All pure: the
// same state, meta and time always give the same result.

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

/** What a seat's AI weighs besides the evidence: chat opinions, and for the crew, anyone who has publicly claimed Undercover. */
export function opinionsFor(state: GameState, meta: Meta, seat: SeatId): Record<SeatId, number> {
  const own = { ...(meta.opinions[seat] ?? {}) };
  const role = state.seats.find((x) => x.id === seat)?.role;
  if (role && isCrew(role)) for (const claimer of Object.keys(meta.claimed)) own[claimer] = (own[claimer] ?? 0) + 3;
  return own;
}

export function aiIntent(plan: Pick<Plan, "seat" | "kind">, state: GameState, events: GameEvent[], meta: Meta): Intent | null {
  const { view, events: visible } = viewFor(state, events, plan.seat);
  const persona = meta.personas[plan.seat];
  if (!persona) return null;
  const salt = String(state.seq);
  const opinions = opinionsFor(state, meta, plan.seat);
  if (plan.kind === "night") return nightIntent(view, visible, persona, salt, opinions);
  if (plan.kind === "vote") return voteIntent(view, visible, persona, salt, opinions);
  return pointIntent(view, visible, persona, salt, opinions);
}

const mentions = (text: string, name: string, flat: string) =>
  new RegExp(`(^|[^\\p{L}])(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${flat})($|[^\\p{L}\\d])`, "iu").test(text);

/** How many AI messages a phase may have, so the chat feels alive without flooding. */
export function talkBudget(phase: Phase, aiAlive: number): number {
  if (phase === "day") return Math.min(10, 3 + aiAlive);
  if (phase === "vote") return 3;
  if (phase === "night") return 3;
  return 0;
}

/**
 * The talk scheduler: given new events, which AI neighbours should speak and when, and when the
 * narrator should tell the story. Speakers who reply to someone are picked now; the regular
 * turns through the day leave the speaker open until the turn comes.
 */
export function react(s: GameState, m: Meta, events: GameEvent[]): Meta {
  const talks: TalkJob[] = [...m.talks];
  const aiAlive = s.seats.filter((x) => x.alive && x.kind === "ai" && m.personas[x.id]);
  const isAi = (id: SeatId | null) => !!id && aiAlive.some((x) => x.id === id);
  const busy = (id: SeatId) => talks.some((t) => t.seat === id && t.kind !== "narrate");
  for (const e of events) {
    const rng = createRng(`${s.seed}/${e.seq}/talk`);
    let n = 0;
    const base = (dueAt: number, phase: Phase = e.phase, round = e.round) => ({ id: `${e.seq}/${n++}`, dueAt, phase, round, claimedAt: null });
    const narrate = (moment: "intro" | "dawn" | "verdict" | "end", delay: number) => talks.push({ ...base(e.at + delay), seat: null, kind: "narrate", moment });
    const say = (seat: SeatId | null, reason: TalkReason, dueAt: number, phase: Phase = e.phase, kind: "chat" | "crew-chat" = "chat") =>
      talks.push({ ...base(dueAt, phase), seat, kind, reason });

    switch (e.kind) {
      case "game-start":
        narrate("intro", 1_200);
        break;
      case "game-end":
        narrate("end", 400);
        break;
      case "phase": {
        const phase = e.data.phase as Phase;
        const length = (e.data.endsAt as number) - e.at;
        if (phase === "dawn") narrate("dawn", 300);
        if (phase === "verdict") narrate("verdict", 300);
        if (phase === "day" && aiAlive.length) {
          rng.shuffle(aiAlive).slice(0, 2).forEach((x, i) => say(x.id, { type: "day-open" }, e.at + 2_500 + i * 4_000 + rng.int(0, 2_500), phase));
          // Regular turns through the day, roughly every 7–12 s; the speaker is picked when it's due.
          for (let t = e.at + 14_000 + rng.int(0, 3_000); t < e.at + length * 0.88; t += rng.int(7_000, 12_000)) say(null, { type: "hunch" }, t, phase);
        }
        if (phase === "vote" && aiAlive.length) {
          rng.shuffle(aiAlive).slice(0, rng.int(1, 2)).forEach((x, i) => say(x.id, { type: "vote-call", target: "skip" }, e.at + length * (0.1 + i * 0.2) + rng.int(0, 2_000), phase));
        }
        if (phase === "night") {
          // The crew AI only talks tactics when there's a human in the crew to talk to.
          const crew = s.seats.filter((x) => x.alive && isCrew(x.role));
          const aiCrew = crew.filter((x) => isAi(x.id));
          if (aiCrew.length && crew.some((x) => x.kind === "human")) say(rng.pick(aiCrew).id, { type: "crew-plan", target: null }, e.at + rng.int(3_000, 7_000), phase, "crew-chat");
        }
        break;
      }
      case "point":
        if (e.target && e.actor !== e.target && isAi(e.target) && !busy(e.target) && rng.chance(0.7)) say(e.target, { type: "accused", by: e.actor! }, e.at + rng.int(2_500, 6_000));
        break;
      case "vote":
        if (e.target && isAi(e.target) && !busy(e.target) && rng.chance(0.35)) say(e.target, { type: "accused", by: e.actor! }, e.at + rng.int(2_000, 4_000));
        break;
      case "chat": {
        if (!e.actor || !e.text) break;
        const human = s.seats.find((x) => x.id === e.actor)?.kind === "human";
        const named = aiAlive.filter((x) => x.id !== e.actor && mentions(e.text!, m.personas[x.id].name, m.personas[x.id].flat));
        if (named.length) {
          for (const x of named.slice(0, 2)) if (!busy(x.id) && rng.chance(human ? 0.9 : 0.45)) say(x.id, { type: "mentioned", by: e.actor, text: e.text }, e.at + rng.int(2_500, 5_500));
        } else if (human && rng.chance(0.55)) {
          const free = aiAlive.filter((x) => x.id !== e.actor && !busy(x.id));
          if (free.length) say(rng.pick(free).id, { type: "reply", by: e.actor, text: e.text }, e.at + rng.int(3_000, 6_000));
        }
        break;
      }
      case "crew-chat": {
        const human = s.seats.find((x) => x.id === e.actor)?.kind === "human";
        const aiCrew = s.seats.filter((x) => x.alive && isCrew(x.role) && isAi(x.id) && !busy(x.id));
        if (human && aiCrew.length && rng.chance(0.75)) say(rng.pick(aiCrew).id, { type: "crew-plan", target: null }, e.at + rng.int(2_500, 5_000), e.phase, "crew-chat");
        break;
      }
    }
  }
  return { ...m, talks };
}

/** Drops chat that missed its moment (the phase moved on, or the speaker went out). */
function pruneTalks(s: GameState, m: Meta): Meta {
  const talks = m.talks.filter((t) => {
    if (t.kind === "narrate") return true;
    if (t.phase !== s.phase || t.round !== s.round) return false;
    return t.seat === null || s.seats.some((x) => x.id === t.seat && x.alive);
  });
  return talks.length === m.talks.length ? m : { ...m, talks };
}

/**
 * Catches a game up to `now`: AI moves and phase deadlines happen in time order, one phase at a
 * time, and each phase gets its AI plans and talk turns when it begins.
 */
export function catchUp(state: GameState, meta: Meta, log: GameEvent[], now: number): { state: GameState; meta: Meta; events: GameEvent[] } {
  let s = state;
  let m = meta;
  const fresh: GameEvent[] = [];
  const run = (step: { state: GameState; events: GameEvent[] }) => {
    s = step.state;
    fresh.push(...step.events);
    if (step.events.length) m = pruneTalks(s, react(s, m, step.events));
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

/** Moves a running game on to now; null when nothing changed. */
export function tick(room: RoomRow, events: GameEvent[], now: number) {
  if (room.status !== "playing" || !room.state) return null;
  const meta = readMeta(room.meta);
  const caught = catchUp(room.state as GameState, meta, events, now);
  if (!caught.events.length && JSON.stringify(caught.meta) === JSON.stringify(meta)) return null;
  return caught;
}
