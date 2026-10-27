import { beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@/db";
import { migrateDatabase } from "@/db/migrate";
import { isCrew } from "@/game/roles";
import type { GameEvent, Intent } from "@/game/types";
import type { SeatView } from "@/game/view";
import { createRng, type Rng } from "@/lib/rng";
import { actInRoom, createRoom, joinRoom, pollRoom, rawEvents, RoomError, startGame, updateSettings, type Poll, type RoomDeps } from "@/rooms/service";

// The room service end to end (DESIGN.md §3): rooms, seats, tokens, tick-on-read timers and AI
// seats, on an in-memory database with a clock the tests move by hand.

let db: Database;
beforeAll(async () => {
  db = createDatabase({ url: "", pgliteDir: "memory://" });
  await migrateDatabase(db);
});

function deps(start = 1_000_000) {
  const clock = { now: start };
  const d: RoomDeps = { db, clock: () => clock.now };
  return { d, clock };
}

const PRIVATE_KINDS = new Set(["crew-chat", "crew-vote", "crew-roster", "check-result", "protect-held", "role", "ghost-chat"]);

/** What a living, non-finished seat may receive, given what it knows about itself. */
function expectNoLeaks(poll: Poll, seen: GameEvent[]) {
  const me = poll.view?.me;
  if (!me || !me.alive || poll.status === "ended") return;
  for (const e of poll.events) {
    if (!PRIVATE_KINDS.has(e.kind)) continue;
    if (e.kind === "role") expect(e.target).toBe(me.id);
    else if (e.kind === "check-result" || e.kind === "protect-held") expect(e.actor).toBe(me.id);
    else if (e.kind === "ghost-chat") throw new Error("a living seat got the ghost chat");
    else expect(isCrew(me.role!)).toBe(true);
  }
  for (const s of poll.view!.seats) {
    if (s.role && s.alive && s.id !== me.id) expect(isCrew(me.role!) && isCrew(s.role)).toBe(true);
  }
  seen.push(...poll.events);
}

/** A human who plays sensibly: does their night job, points, votes. */
function humanMove(rng: Rng, view: SeatView): Intent | null {
  const me = view.me;
  if (!me?.alive) return rng.chance(0.1) ? { type: "ghost-chat", text: "it was 3B all along" } : null;
  const others = view.seats.filter((s) => s.alive && s.id !== me.id).map((s) => s.id);
  if (!others.length) return null;
  if (view.phase === "night") {
    if (isCrew(me.role!) && !me.night.crewVotes?.[me.id]) {
      const targets = others.filter((id) => !me.crew.includes(id));
      return targets.length ? { type: "crew-vote", target: rng.pick(targets) } : null;
    }
    if (me.role === "medic" && !me.night.protect) return { type: "protect", target: rng.pick([me.id, ...others].filter((id) => id !== me.lastProtected)) };
    if (me.role === "undercover" && !me.night.check) return { type: "check", target: rng.pick(others) };
    return null;
  }
  if (view.phase === "day") return rng.chance(0.5) ? { type: "chat", text: "who was out on the stairs last night?" } : { type: "point", target: rng.pick(others) };
  if (view.phase === "vote" && !(me.id in view.votes)) return { type: "vote", target: rng.chance(0.2) ? "skip" : rng.pick(others) };
  return null;
}

/** Plays a whole game through the service: humans poll every few seconds and act when they can. */
async function playGame(seed: string, humans: number, seats = 7) {
  const { d, clock } = deps();
  const rng = createRng(`play/${seed}`);
  const host = await createRoom(d, { name: "Host", settings: { seats, pace: "normal" }, seed });
  const players = [{ seatId: host.seatId, token: host.token }];
  for (let i = 1; i < humans; i++) players.push(await joinRoom(d, host.code, { name: `Friend ${i}` }));
  await startGame(d, host.code, host.token);

  const since = players.map(() => -1);
  const seen = players.map(() => [] as GameEvent[]);
  let last: Poll | null = null;
  for (let turn = 0; turn < 5_000; turn++) {
    clock.now += rng.int(500, 9_000);
    const who = rng.int(0, players.length - 1);
    const poll = await pollRoom(d, host.code, players[who].token, since[who]);
    expectNoLeaks(poll, seen[who]);
    // A seat that just died (or a finished game) re-reads the whole log, now that it may see it all.
    since[who] = poll.lastSeq;
    last = poll;
    if (poll.status === "ended") break;
    const intent = poll.view && humanMove(rng, poll.view);
    if (intent) {
      try {
        await actInRoom(d, host.code, players[who].token, intent);
      } catch (error) {
        // Only the rate limit and the odd rule (a phase that ended while thinking) may refuse.
        expect(error).toBeInstanceOf(RoomError);
        expect(["slow-down", "rule"]).toContain((error as RoomError).code);
      }
    }
  }
  return { d, clock, host, players, last: last!, seen };
}

describe("rooms", () => {
  it("creates a room, takes joins with distinct names and refuses when full", async () => {
    const { d } = deps();
    const host = await createRoom(d, { name: "  Maya  ", settings: { seats: 5 } });
    expect(host.code).toMatch(/^[A-Z]{4}$/);
    expect(host.seatId).toBe("s1");
    const a = await joinRoom(d, host.code.toLowerCase(), { name: "maya" });
    expect(a.name).toBe("maya 2");
    await joinRoom(d, host.code, { name: "Dev" });
    await joinRoom(d, host.code, { name: "Rosa" });
    await joinRoom(d, host.code, { name: "Kofi" });
    await expect(joinRoom(d, host.code, { name: "Lena" })).rejects.toMatchObject({ code: "full" });
    await expect(joinRoom(d, "ZZZZ", { name: "Lena" })).rejects.toMatchObject({ code: "not-found" });
    await expect(createRoom(d, { name: "   " })).rejects.toMatchObject({ code: "bad-request" });

    const lobby = await pollRoom(d, host.code, host.token);
    expect(lobby.status).toBe("lobby");
    expect(lobby.me).toEqual({ seatId: "s1", host: true });
    expect(Object.values(lobby.profiles).map((p) => p.name)).toEqual(["Maya", "maya 2", "Dev", "Rosa", "Kofi"]);
    expect(lobby.view).toBeNull();
  });

  it("lets only the host change settings or start, and only in the lobby", async () => {
    const { d } = deps();
    const host = await createRoom(d, { name: "Host" });
    const guest = await joinRoom(d, host.code, { name: "Guest" });
    await expect(updateSettings(d, host.code, guest.token, { seats: 9 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateSettings(d, host.code, "not-a-token", { seats: 9 })).rejects.toMatchObject({ code: "forbidden" });
    expect(await updateSettings(d, host.code, host.token, { seats: 9, pace: "quick" })).toMatchObject({ seats: 9, pace: "quick" });
    await expect(updateSettings(d, host.code, host.token, { seats: 3 })).rejects.toThrow();
    await expect(startGame(d, host.code, guest.token)).rejects.toMatchObject({ code: "forbidden" });
    await startGame(d, host.code, host.token);
    await expect(startGame(d, host.code, host.token)).rejects.toMatchObject({ code: "started" });
    await expect(joinRoom(d, host.code, { name: "Late" })).rejects.toMatchObject({ code: "started" });
    await expect(updateSettings(d, host.code, host.token, { seats: 10 })).rejects.toMatchObject({ code: "started" });
  });

  it("fills empty seats with AI neighbours who have a flat, a job and a look", async () => {
    const { d } = deps();
    const host = await createRoom(d, { name: "Maya", settings: { seats: 8 }, seed: "fill" });
    await startGame(d, host.code, host.token);
    const poll = await pollRoom(d, host.code, host.token);
    expect(poll.status).toBe("playing");
    const profiles = Object.values(poll.profiles);
    expect(profiles).toHaveLength(8);
    expect(profiles.filter((p) => p.kind === "ai")).toHaveLength(7);
    for (const p of profiles.filter((x) => x.kind === "ai")) {
      expect(p.flat).toMatch(/^[1-5][ABC]$/);
      expect(p.job).toBeTruthy();
      expect(p.look?.top).toMatch(/^#/);
    }
    // Nobody shares the human's name.
    expect(new Set(profiles.map((p) => p.name.toLowerCase())).size).toBe(8);
    expect(poll.view!.phase).toBe("reveal");
    expect(poll.view!.me!.role).toBeTruthy();
  });

  it("keeps the AI from acting all at once: the night takes a while", async () => {
    const { d, clock } = deps();
    const host = await createRoom(d, { name: "Solo", settings: { seats: 7 }, seed: "pace" });
    await startGame(d, host.code, host.token);
    clock.now += 8_000; // reveal is over
    let poll = await pollRoom(d, host.code, host.token);
    expect(poll.view!.phase).toBe("night");
    const nightStart = poll.view!.endsAt - 30_000;
    clock.now = nightStart + 1_000;
    poll = await pollRoom(d, host.code, host.token);
    expect(poll.view!.phase).toBe("night");
    // By the deadline the AI has done its night jobs.
    clock.now = nightStart + 30_000;
    await pollRoom(d, host.code, host.token);
    const raw = await rawEvents(d, host.code);
    const crewVotes = raw.filter((e) => e.kind === "crew-vote" && e.round === 1);
    const view = (await pollRoom(d, host.code, host.token)).view!;
    const humanIsCrew = isCrew(view.me!.role!);
    if (!humanIsCrew) expect(crewVotes.length).toBeGreaterThan(0);
    for (const e of crewVotes) {
      expect(e.at).toBeGreaterThanOrEqual(nightStart + 2_000);
      expect(e.at).toBeLessThanOrEqual(nightStart + 30_000);
    }
  });

  it("catches up after a long silence, with the AI still taking its turns each night", async () => {
    const { d, clock } = deps();
    const host = await createRoom(d, { name: "Away", settings: { seats: 9 }, seed: "away" });
    await startGame(d, host.code, host.token);
    clock.now += 20 * 60_000; // nobody polls for twenty minutes
    const poll = await pollRoom(d, host.code, host.token);
    const raw = await rawEvents(d, host.code);
    const rounds = new Set(raw.filter((e) => e.kind === "phase" && e.data.phase === "night").map((e) => e.round));
    expect(rounds.size).toBeGreaterThan(1);
    // Every night the crew made a pick (unless the only crew left is the silent human).
    const picks = new Set(raw.filter((e) => e.kind === "crew-vote").map((e) => e.round));
    expect(picks.size).toBeGreaterThan(0);
    // Each phase starts where the last one ended: no time is lost or doubled.
    const phases = raw.filter((e) => e.kind === "phase");
    for (let i = 1; i < phases.length; i++) expect(phases[i].at).toBeGreaterThanOrEqual(phases[i - 1].at);
    expect(raw.map((e) => e.seq)).toEqual(raw.map((_, i) => i));
    expect(poll.lastSeq).toBe(raw.length - 1);
  });

  it("rate-limits chat and turns rule breaks into clear errors", async () => {
    const { d, clock } = deps();
    const host = await createRoom(d, { name: "Chatty", settings: { seats: 5 }, seed: "chat" });
    await startGame(d, host.code, host.token);
    await expect(actInRoom(d, host.code, host.token, { type: "vote", target: "skip" })).rejects.toMatchObject({ code: "rule" });
    await expect(actInRoom(d, host.code, null, { type: "chat", text: "hi" })).rejects.toMatchObject({ code: "forbidden" });
    // Jump to the first day.
    clock.now += 8_000 + 30_000 + 10_000;
    const poll = await pollRoom(d, host.code, host.token);
    if (poll.status === "ended" || !poll.view!.me!.alive) return; // the human went out the first night
    expect(poll.view!.phase).toBe("day");
    await actInRoom(d, host.code, host.token, { type: "chat", text: "morning all" });
    await expect(actInRoom(d, host.code, host.token, { type: "chat", text: "hello??" })).rejects.toMatchObject({ code: "slow-down" });
    clock.now += 1_500;
    await actInRoom(d, host.code, host.token, { type: "chat", text: "ok now" });
    const chats = (await pollRoom(d, host.code, host.token)).events.filter((e) => e.kind === "chat");
    expect(chats.map((e) => e.text)).toEqual(["morning all", "ok now"]);
  });

  it("plays full games, solo and with friends, and never leaks a secret to a living player", async () => {
    let ended = 0;
    const winners = new Set<string>();
    for (let g = 0; g < 12; g++) {
      const { d, host, last, seen } = await playGame(`game-${g}`, 1 + (g % 3), 6 + (g % 5));
      if (last.status !== "ended") continue;
      ended++;
      winners.add(last.view!.winner!.team);
      // The log is whole and in order, and every event a seat got is a real one.
      const raw = await rawEvents(d, host.code);
      expect(raw.map((e) => e.seq)).toEqual(raw.map((_, i) => i));
      const bySeq = new Map(raw.map((e) => [e.seq, e]));
      for (const list of seen) for (const e of list) expect(bySeq.get(e.seq)).toEqual(e);
      // The finished game shows everyone's role.
      const final = await pollRoom(d, host.code, null);
      expect(final.view!.seats.every((s) => s.role)).toBe(true);
    }
    expect(ended).toBe(12);
    expect(winners.size).toBeGreaterThan(0);
  }, 120_000);
});
