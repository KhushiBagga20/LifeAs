import { isCrew } from "@/game/roles";
import type { GameEvent, Intent, SeatId } from "@/game/types";
import type { SeatView } from "@/game/view";
import { createRng } from "@/lib/rng";
import type { Persona } from "./personas";

// The AI neighbours' brain (DESIGN.md §2.1): plain code, free and deterministic. It only ever
// sees what its seat may see (a SeatView and the events visible to it), so it can't cheat.

export type Scores = Record<SeatId, number>;

const TRAIT_GAIN: Record<Persona["trait"], number> = { suspicious: 1.4, dramatic: 1.25, chatty: 1.1, logical: 1, quiet: 0.9, chill: 0.75 };

/** How a revealed role reflects on everyone who pointed at or voted for that seat. */
function revealed(view: SeatView): Map<SeatId, "crew" | "block"> {
  const out = new Map<SeatId, "crew" | "block">();
  for (const s of view.seats) if (!s.alive && s.role) out.set(s.id, isCrew(s.role) ? "crew" : "block");
  return out;
}

/**
 * How likely this seat thinks each other living seat is crew (higher = more suspicious).
 * Evidence: public pointing and voting (judged by roles revealed later), how quiet people are,
 * and for the Undercover their own check results.
 */
export function suspicion(view: SeatView, events: GameEvent[], persona: Persona): Scores {
  const me = view.me!;
  const reveal = revealed(view);
  const scores: Scores = {};
  const rng = createRng(`${me.id}/suspicion`);
  for (const s of view.seats) if (s.alive && s.id !== me.id) scores[s.id] = rng.float(-0.04, 0.04);
  const bump = (id: SeatId | null, amount: number) => {
    if (id && id in scores) scores[id] += amount;
  };

  const chats = new Map<SeatId, number>();
  for (const e of events) {
    if (e.kind === "chat" && e.actor) chats.set(e.actor, (chats.get(e.actor) ?? 0) + 1);
    if (e.kind === "point" && e.actor && e.target) {
      const verdict = reveal.get(e.target);
      bump(e.target, 0.08); // crowds stick
      if (verdict === "crew") bump(e.actor, -0.3);
      if (verdict === "block") bump(e.actor, 0.15);
      if (e.target === me.id) bump(e.actor, 0.12); // people who accuse me look shifty to me
    }
    if (e.kind === "vote" && e.actor && e.target) {
      const verdict = reveal.get(e.target);
      if (verdict === "crew") bump(e.actor, -0.3);
      if (verdict === "block") bump(e.actor, 0.2);
    }
  }
  // Quiet people are a little suspicious once there's been a conversation.
  const counts = [...chats.values()];
  const average = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  if (average >= 2) for (const id of Object.keys(scores)) if ((chats.get(id) ?? 0) < average / 2) bump(id, 0.06);

  const gain = TRAIT_GAIN[persona.trait];
  for (const id of Object.keys(scores)) scores[id] *= gain;
  // Hard knowledge beats hunches.
  for (const c of me.checks) bump(c.target, c.result === "crew" ? 3 : -1);
  if (isCrew(me.role)) for (const id of me.crew) if (id in scores) scores[id] = -10;
  return scores;
}

/** For the crew: how dangerous each non-crew seat is to them (accusing or voting crew). */
export function threat(view: SeatView, events: GameEvent[]): Scores {
  const crew = new Set(view.me!.crew);
  const scores: Scores = {};
  for (const s of view.seats) if (s.alive && !crew.has(s.id)) scores[s.id] = 0;
  for (const e of events) {
    if (!e.actor || !(e.actor in scores) || !e.target || !crew.has(e.target)) continue;
    if (e.kind === "point") scores[e.actor] += 1;
    if (e.kind === "vote") scores[e.actor] += 1.5;
  }
  return scores;
}

function best(scores: Scores, candidates: SeatId[], noise: () => number): SeatId | null {
  let top: SeatId | null = null;
  let value = -Infinity;
  for (const id of candidates) {
    const v = (scores[id] ?? 0) + noise();
    if (v > value) {
      value = v;
      top = id;
    }
  }
  return top;
}

/** What this AI does at night, or null if its role has nothing to do. */
export function nightIntent(view: SeatView, events: GameEvent[], persona: Persona, salt: string): Intent | null {
  const me = view.me;
  if (!me?.alive || view.phase !== "night") return null;
  const rng = createRng(`${me.id}/${view.round}/night/${salt}`);
  const noise = () => rng.float(0, 0.3);
  const others = view.seats.filter((s) => s.alive && s.id !== me.id).map((s) => s.id);

  if (isCrew(me.role)) {
    const targets = others.filter((id) => !me.crew.includes(id));
    if (!targets.length) return null;
    // Follow a teammate's pick most of the time, so the crew agrees.
    const teammatePick = Object.entries(me.night.crewVotes ?? {}).find(([voter, t]) => voter !== me.id && targets.includes(t))?.[1];
    if (teammatePick && rng.chance(0.8)) return { type: "crew-vote", target: teammatePick };
    return { type: "crew-vote", target: best(threat(view, events), targets, noise)! };
  }
  if (me.role === "medic") {
    const candidates = [me.id, ...others].filter((id) => id !== me.lastProtected);
    const accusedMe = events.filter((e) => e.kind === "point" && e.target === me.id && e.round === view.round - 1).length;
    if (candidates.includes(me.id) && accusedMe >= 2 && rng.chance(0.6)) return { type: "protect", target: me.id };
    // Otherwise guard whoever they trust most.
    const trust = Object.fromEntries(Object.entries(suspicion(view, events, persona)).map(([id, v]) => [id, -v]));
    return { type: "protect", target: best(trust, candidates, noise) ?? me.id };
  }
  if (me.role === "undercover") {
    const checked = new Set(me.checks.map((c) => c.target));
    const unchecked = others.filter((id) => !checked.has(id));
    const target = best(suspicion(view, events, persona), unchecked.length ? unchecked : others, noise);
    return target ? { type: "check", target } : null;
  }
  return null;
}

/** Who this AI votes for (or skip). */
export function voteIntent(view: SeatView, events: GameEvent[], persona: Persona, salt: string): Intent | null {
  const me = view.me;
  if (!me?.alive || view.phase !== "vote") return null;
  const rng = createRng(`${me.id}/${view.round}/vote/${salt}`);
  const others = view.seats.filter((s) => s.alive && s.id !== me.id).map((s) => s.id);
  if (!others.length) return { type: "vote", target: "skip" };

  // Who the block is piling on, from public pointing and votes so far.
  const heat: Scores = Object.fromEntries(others.map((id) => [id, 0]));
  for (const t of [...Object.values(view.votes)]) if (t !== "skip" && t in heat) heat[t] += 1;
  for (const e of events) if (e.kind === "point" && e.round === view.round && e.target && e.target in heat) heat[e.target] += 0.5;

  if (isCrew(me.role)) {
    // Vote out someone from the block, riding whichever wave is already going.
    const targets = others.filter((id) => !me.crew.includes(id));
    const pick = best(heat, targets, () => rng.float(0, 0.6));
    return pick && rng.chance(0.9) ? { type: "vote", target: pick } : { type: "vote", target: "skip" };
  }
  const scores = suspicion(view, events, persona);
  for (const id of others) scores[id] = (scores[id] ?? 0) + heat[id] * 0.15;
  const pick = best(scores, others, () => rng.float(0, 0.1))!;
  const threshold = persona.trait === "chill" ? 0.35 : persona.trait === "suspicious" ? 0.12 : 0.22;
  return scores[pick] >= threshold || rng.chance(0.35) ? { type: "vote", target: pick } : { type: "vote", target: "skip" };
}

/** Who this AI points at during the day, if anyone. */
export function pointIntent(view: SeatView, events: GameEvent[], persona: Persona, salt: string): Intent | null {
  const me = view.me;
  if (!me?.alive || view.phase !== "day") return null;
  const rng = createRng(`${me.id}/${view.round}/point/${salt}`);
  const others = view.seats.filter((s) => s.alive && s.id !== me.id && !(isCrew(me.role) && me.crew.includes(s.id))).map((s) => s.id);
  if (!others.length) return null;
  const scores = isCrew(me.role) ? threat(view, events) : suspicion(view, events, persona);
  const pick = best(scores, others, () => rng.float(0, 0.25));
  return pick ? { type: "point", target: pick } : null;
}
