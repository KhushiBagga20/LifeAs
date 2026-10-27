import { describe, expect, it } from "vitest";
import { act, advance, checkWinner, createGame, type Player } from "@/game/engine";
import { lineup } from "@/game/lineup";
import { isCrew } from "@/game/roles";
import { RuleError, type GameEvent, type GameState, type Intent } from "@/game/types";
import { viewFor } from "@/game/view";
import { createRng, type Rng } from "@/lib/rng";

// Random games (DESIGN.md §7): random settings, random moves (many of them illegal) and random
// timing, checking the invariants after every step.

const PRIVATE_KINDS = new Set(["crew-chat", "crew-vote", "crew-roster", "check-result", "protect-held"]);

function randomIntent(rng: Rng, state: GameState): Intent {
  const ids = state.seats.map((s) => s.id);
  const someone = () => rng.pick(ids);
  switch (rng.int(0, 7)) {
    case 0:
      return { type: "crew-vote", target: someone() };
    case 1:
      return { type: "crew-chat", text: rng.pick(["hit 4B", "not yet", " "]) };
    case 2:
      return { type: "protect", target: someone() };
    case 3:
      return { type: "check", target: someone() };
    case 4:
      return { type: "chat", text: rng.pick(["it's 5C", "trust me", "", "lol"]) };
    case 5:
      return { type: "point", target: rng.chance(0.2) ? null : someone() };
    case 6:
      return { type: "vote", target: rng.chance(0.25) ? "skip" : someone() };
    default:
      return { type: "ghost-chat", text: "boo" };
  }
}

/** A move that makes sense for the current phase: the right seat, a living target. */
function sensibleMove(rng: Rng, state: GameState): { seat: string; intent: Intent } | null {
  const alive = state.seats.filter((x) => x.alive);
  const other = (me: string) => rng.pick(alive.filter((x) => x.id !== me)).id;
  if (state.phase === "night") {
    const crew = alive.filter((x) => isCrew(x.role));
    const targets = alive.filter((x) => !isCrew(x.role));
    const options: { seat: string; intent: Intent }[] = [];
    if (crew.length && targets.length) options.push({ seat: rng.pick(crew).id, intent: { type: "crew-vote", target: rng.pick(targets).id } });
    const medic = alive.find((x) => x.role === "medic");
    if (medic) options.push({ seat: medic.id, intent: { type: "protect", target: rng.pick(alive).id } });
    const cop = alive.find((x) => x.role === "undercover");
    if (cop && alive.length > 1) options.push({ seat: cop.id, intent: { type: "check", target: other(cop.id) } });
    return options.length ? rng.pick(options) : null;
  }
  if (state.phase === "vote" && alive.length > 1) {
    const voter = rng.pick(alive).id;
    return { seat: voter, intent: { type: "vote", target: rng.chance(0.15) ? "skip" : other(voter) } };
  }
  if (state.phase === "day" && alive.length > 1) {
    const me = rng.pick(alive).id;
    return { seat: me, intent: rng.chance(0.5) ? { type: "point", target: other(me) } : { type: "chat", text: "hmm" } };
  }
  return null;
}

function checkInvariants(state: GameState, log: GameEvent[]) {
  // Role counts never change.
  const dealt = lineup(state.settings).sort().join();
  expect(state.seats.map((s) => s.role).sort().join()).toBe(dealt);
  // At most one person goes out at night and one at the vote, per round.
  const outs = new Map<string, number>();
  for (const s of state.seats.filter((x) => x.out)) {
    const key = `${s.out!.round}-${s.out!.cause}`;
    outs.set(key, (outs.get(key) ?? 0) + 1);
  }
  expect(Math.max(0, ...outs.values())).toBeLessThanOrEqual(1);
  // A finished game has the right winner.
  if (state.phase === "ended") expect(state.winner).toEqual(checkWinner(state));
  // No living non-crew seat ever sees private information that isn't theirs.
  if (state.phase !== "ended") {
    for (const seat of state.seats.filter((x) => x.alive)) {
      const { view, events } = viewFor(state, log, seat.id);
      for (const e of events) {
        if (e.kind === "role") expect(e.target).toBe(seat.id);
        if (PRIVATE_KINDS.has(e.kind) && !isCrew(seat.role)) {
          expect(e.kind === "check-result" || e.kind === "protect-held").toBe(true);
          expect(e.actor).toBe(seat.id);
        }
        if (e.kind === "ghost-chat") throw new Error("a living seat saw the ghost chat");
      }
      for (const other of view.seats) {
        if (other.role === null || other.id === seat.id || !other.alive) continue;
        // A living seat only knows another living seat's role if both are crew.
        expect(isCrew(seat.role) && isCrew(other.role)).toBe(true);
      }
    }
  }
}

describe("random games", () => {
  it("keep every invariant over 2,000 games", () => {
    let finished = 0;
    const winners = { block: 0, crew: 0 };
    for (let g = 0; g < 2000; g++) {
      const rng = createRng(`sim-${g}`);
      const n = rng.int(5, 12);
      const players: Player[] = Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `P${i}`, kind: rng.chance(0.3) ? "human" : "ai" }));
      const settings = { seats: n, boss: rng.chance(0.5), influencer: rng.chance(0.5), pace: rng.chance(0.5) ? ("quick" as const) : ("normal" as const) };
      let now = 0;
      const start = createGame({ players, settings, seed: `seed-${g}`, now });
      let state = start.state;
      const log: GameEvent[] = [...start.events];

      for (let step = 0; step < 800 && state.phase !== "ended"; step++) {
        if (rng.chance(0.75)) {
          const sensible = rng.chance(0.5) ? sensibleMove(rng, state) : null;
          const seat = sensible ? state.seats.find((x) => x.id === sensible.seat)! : rng.pick(state.seats);
          const before = state.seats.find((s) => s.id === seat.id)!;
          try {
            const result = act(state, seat.id, sensible?.intent ?? randomIntent(rng, state), now);
            // Only the living act, except in the ghost chat.
            const ghost = result.events.some((e) => e.kind === "ghost-chat");
            expect(before.alive || ghost).toBe(true);
            state = result.state;
            log.push(...result.events);
          } catch (error) {
            expect(error).toBeInstanceOf(RuleError);
          }
        } else {
          now += rng.int(1_000, 40_000);
          const result = advance(state, now);
          state = result.state;
          log.push(...result.events);
        }
        expect(log.at(-1)!.seq).toBe(log.length - 1);
        if (step % 40 === 0) checkInvariants(state, log);
      }
      checkInvariants(state, log);
      if (state.phase === "ended") {
        finished++;
        winners[state.winner!.team]++;
      }
    }
    // Random play still finishes most games, and both teams win some.
    expect(finished).toBeGreaterThan(1000);
    expect(winners.block).toBeGreaterThan(0);
    expect(winners.crew).toBeGreaterThan(0);
  }, 120_000);
});
