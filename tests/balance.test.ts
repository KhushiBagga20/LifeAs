import { expect, it } from "vitest";
import { registerAiFakers } from "@/ai/fakes";
import { createDatabase } from "@/db";
import { migrateDatabase } from "@/db/migrate";
import { isCrew } from "@/game/roles";
import type { Intent } from "@/game/types";
import { createRng } from "@/lib/rng";
import { FakeProvider } from "@/llm/fake";
import { actInRoom, createRoom, pollRoom, rawEvents, startGame } from "@/rooms/service";
import { runTalk } from "@/rooms/talk";
import { fakeLLM } from "./helpers";

// Balance (DESIGN.md §1): one human who plays plainly against AI neighbours, at every table size.
// Neither side should run away with it. When this was written, 120 games went 65 block / 55 crew.

it("keeps the game fair: both sides win a good share at every size", async () => {
  const db = createDatabase({ url: "", pgliteDir: "memory://" });
  await migrateDatabase(db);
  const clock = { now: 1_000_000 };
  const deps = { db, clock: () => clock.now, llm: fakeLLM(registerAiFakers(new FakeProvider())) };
  const wins = { block: 0, crew: 0 };
  const rounds: number[] = [];
  for (let g = 0; g < 40; g++) {
    const seats = 5 + (g % 8);
    const rng = createRng(`balance-${g}`);
    const host = await createRoom(deps, { name: "Human", settings: { seats, pace: "quick" }, seed: `balance-${g}` });
    await startGame(deps, host.code, host.token);
    for (let i = 0; i < 4_000; i++) {
      clock.now += 1_500;
      const poll = await pollRoom(deps, host.code, host.token);
      await runTalk(deps, host.code);
      if (poll.status === "ended") break;
      const view = poll.view!;
      const me = view.me!;
      if (!me.alive) continue;
      const others = view.seats.filter((s) => s.alive && s.id !== me.id).map((s) => s.id);
      const outsiders = others.filter((id) => !me.crew.includes(id));
      let intent: Intent | null = null;
      if (view.phase === "night" && isCrew(me.role!) && !me.night.crewVotes?.[me.id]) intent = { type: "crew-vote", target: rng.pick(outsiders) };
      if (view.phase === "night" && me.role === "medic" && !me.night.protect) intent = { type: "protect", target: rng.pick([me.id, ...others].filter((x) => x !== me.lastProtected)) };
      if (view.phase === "night" && me.role === "undercover" && !me.night.check) intent = { type: "check", target: rng.pick(others) };
      if (view.phase === "day" && rng.chance(0.12)) {
        const t = rng.pick(outsiders);
        intent = rng.chance(0.5) ? { type: "chat", text: `${poll.profiles[t].name} is acting off` } : { type: "point", target: t };
      }
      if (view.phase === "vote" && !(me.id in view.votes) && rng.chance(0.3)) intent = { type: "vote", target: rng.pick(others) };
      if (intent) await actInRoom(deps, host.code, host.token, intent).catch(() => {});
    }
    const end = (await rawEvents(deps, host.code)).find((e) => e.kind === "game-end");
    expect(end, `game ${g} finished`).toBeTruthy();
    wins[(end!.data.winner as { team: "block" | "crew" }).team]++;
    rounds.push(end!.round);
  }
  expect(wins.block).toBeGreaterThanOrEqual(12);
  expect(wins.crew).toBeGreaterThanOrEqual(12);
  // Games last long enough to be a story: usually two to four rounds.
  expect(rounds.reduce((a, b) => a + b, 0) / rounds.length).toBeGreaterThanOrEqual(2);
}, 180_000);
