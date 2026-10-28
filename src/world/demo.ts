import { personasFor } from "@/ai/personas";
import { createGame } from "@/game/engine";
import type { GameEvent, GameState, SeatId } from "@/game/types";
import { viewFor } from "@/game/view";
import { createRng } from "@/lib/rng";
import { newMeta, type Meta } from "@/rooms/meta";
import { catchUp, react } from "@/rooms/timeline";
import { applyWritten, pickWork, profilesFor, type Written } from "@/rooms/voices";
import type { SceneProfile } from "./scene-state";

// A game between AI neighbours that runs entirely in the browser, for the landing page: the
// same engine, brains, talk scheduler and template voices as a real room, without a server.

export type DemoGame = {
  readonly state: GameState;
  readonly events: GameEvent[];
  readonly profiles: Record<SeatId, SceneProfile>;
  /** Moves the game to `now` (game time, ms) and returns what happened. */
  step(now: number): GameEvent[];
};

export function createDemoGame(seed: string, now: number, seats = 8): DemoGame {
  const personas = personasFor(seed, seats);
  const players = personas.map((p, i) => ({ id: `s${i + 1}`, name: p.name, kind: "ai" as const }));
  const start = createGame({ players, settings: { seats, boss: true, influencer: true, pace: "quick" }, seed, now });
  let state = start.state;
  let meta: Meta = react(state, newMeta(Object.fromEntries(players.map((p, i) => [p.id, personas[i]]))), start.events);
  const log: GameEvent[] = [...start.events];
  const names = profilesFor(players, meta);
  const profiles: Record<SeatId, SceneProfile> = Object.fromEntries(players.map((p, i) => [p.id, { name: p.name, flat: personas[i].flat, look: personas[i].look }]));
  const rng = createRng(`${seed}/demo`);

  return {
    get state() {
      return state;
    },
    events: log,
    profiles,
    step(now: number) {
      const fresh: GameEvent[] = [];
      const caught = catchUp(state, meta, log, now);
      state = caught.state;
      meta = caught.meta;
      log.push(...caught.events);
      fresh.push(...caught.events);
      // The template voices stand in for the model, as they do offline.
      const picked = pickWork(state, meta, log, names, now);
      if (picked.work.length) {
        const written: Written[] = picked.work.map((w) => {
          const suspect = "plan" in w && w.plan.suspect ? names[w.plan.suspect].name : null;
          return { message: w.fallback, pointAt: state.phase === "day" && suspect && rng.chance(0.5) ? suspect : null, suspects: suspect ? [suspect] : [], trusts: [] };
        });
        const done = applyWritten(state, picked.meta, log, names, picked.work, written, now);
        state = done.state;
        meta = done.meta;
        log.push(...done.events);
        fresh.push(...done.events);
      } else {
        meta = picked.meta;
      }
      return fresh;
    },
  };
}

/** What a spectator sees of the demo: public events only, like anyone outside the game. */
export const demoView = (game: DemoGame) => viewFor(game.state, game.events, null);
