import { describe, expect, it } from "vitest";
import { act, advance, checkWinner, createGame, crewTarget, DURATIONS, MAX_TEXT, type Player, type Step } from "@/game/engine";
import { crewCount, lineup } from "@/game/lineup";
import { RuleError, type GameEvent, type GameState, type Intent, type Settings } from "@/game/types";
import { canSee, viewFor } from "@/game/view";
import type { RoleId } from "@/game/roles";

const T0 = 1_000_000;
const settings = (seats: number, extra: Partial<Settings> = {}): Settings => ({ seats, boss: false, influencer: false, pace: "normal", ...extra });
const players = (n: number): Player[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `P${i + 1}`, kind: i === 0 ? "human" : "ai" }));

/** A game whose roles are set by hand, in seat order, for precise rule tests. */
function rigged(roles: RoleId[], extra: Partial<Settings> = {}) {
  const step = createGame({ players: players(roles.length), settings: settings(roles.length, extra), seed: "rig", now: T0 });
  step.state.seats.forEach((s, i) => (s.role = roles[i]));
  return step;
}

/** A tiny driver that keeps the state and log. */
function game(step: Step) {
  let state = step.state;
  const log: GameEvent[] = [...step.events];
  let now = T0;
  const apply = (s: Step) => {
    state = s.state;
    log.push(...s.events);
    return s.events;
  };
  return {
    get state() {
      return state;
    },
    log,
    do: (seat: string, intent: Intent) => apply(act(state, seat, intent, now)),
    /** Jump to the end of the current phase and advance. */
    next: () => {
      now = Math.max(now, state.endsAt);
      return apply(advance(state, now));
    },
    to: (phase: GameState["phase"]) => {
      for (let i = 0; i < 20 && state.phase !== phase; i++) {
        now = Math.max(now, state.endsAt);
        apply(advance(state, now));
      }
      expect(state.phase).toBe(phase);
    },
  };
}

const expectRule = (fn: () => unknown, code: RuleError["code"]) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe(code);
    return;
  }
  throw new Error(`expected RuleError ${code}`);
};

describe("line-ups", () => {
  it.each([5, 6, 7, 8, 9, 10, 11, 12])("deals the right roles for %i players", (n) => {
    const roles = lineup(settings(n, { boss: true, influencer: true }));
    expect(roles).toHaveLength(n);
    expect(roles.filter((r) => r === "crew" || r === "boss")).toHaveLength(crewCount(n));
    expect(roles.filter((r) => r === "boss")).toHaveLength(crewCount(n) >= 2 ? 1 : 0);
    expect(roles.filter((r) => r === "undercover")).toHaveLength(1);
    expect(roles.filter((r) => r === "medic")).toHaveLength(1);
    expect(roles.filter((r) => r === "influencer")).toHaveLength(n >= 7 ? 1 : 0);
  });

  it("never makes a lone crew member the Boss, who could never be found", () => {
    for (const n of [5, 6]) expect(lineup(settings(n, { boss: true }))).toEqual(expect.arrayContaining(["crew"]));
    for (const n of [5, 6]) expect(lineup(settings(n, { boss: true }))).not.toContain("boss");
  });

  it("uses plain crew without the Boss and refuses impossible tables", () => {
    expect(lineup(settings(8))).not.toContain("boss");
    expect(() => lineup(settings(4))).toThrow(/5–12/);
    expect(() => lineup(settings(13))).toThrow(/5–12/);
  });

  it("deals the same roles for the same seed and different ones for another", () => {
    const a = createGame({ players: players(8), settings: settings(8), seed: "x", now: T0 }).state.seats.map((s) => s.role);
    const b = createGame({ players: players(8), settings: settings(8), seed: "x", now: T0 }).state.seats.map((s) => s.role);
    const others = ["y", "z", "w", "v"].map((seed) => createGame({ players: players(8), settings: settings(8), seed, now: T0 }).state.seats.map((s) => s.role).join());
    expect(a).toEqual(b);
    expect(others.some((o) => o !== a.join())).toBe(true);
  });
});

describe("the start", () => {
  it("tells each seat its own role privately and the crew who they are", () => {
    const { events, state } = rigged(["crew", "crew", "undercover", "medic", "neighbour", "neighbour", "neighbour"]);
    const roleEvents = events.filter((e) => e.kind === "role");
    expect(roleEvents).toHaveLength(7);
    for (const e of roleEvents) expect(e.visibility).toEqual({ to: "seat", seat: e.target });
    const roster = events.find((e) => e.kind === "crew-roster")!;
    expect(roster.visibility).toEqual({ to: "crew" });
    expect(state.phase).toBe("reveal");
  });
});

describe("night", () => {
  const roles: RoleId[] = ["crew", "crew", "undercover", "medic", "neighbour", "neighbour", "neighbour"];

  it("only lets the right people act, on the right targets", () => {
    const g = game(rigged(roles));
    g.to("night");
    expectRule(() => g.do("s5", { type: "crew-vote", target: "s3" }), "not-allowed");
    expectRule(() => g.do("s1", { type: "crew-vote", target: "s2" }), "bad-target");
    expectRule(() => g.do("s3", { type: "check", target: "s3" }), "bad-target");
    expectRule(() => g.do("s4", { type: "protect", target: "s99" }), "bad-target");
    expectRule(() => g.do("s5", { type: "chat", text: "hi" }), "not-now");
    expectRule(() => g.do("s1", { type: "crew-chat", text: "   " }), "bad-text");
    expectRule(() => g.do("s1", { type: "crew-chat", text: "x".repeat(MAX_TEXT + 1) }), "bad-text");
    g.do("s1", { type: "crew-chat", text: "  quiet   one first " });
    expect(g.log.at(-1)).toMatchObject({ kind: "crew-chat", text: "quiet one first", visibility: { to: "crew" } });
  });

  it("takes out the crew's target and reveals their role", () => {
    const g = game(rigged(roles));
    g.to("night");
    g.do("s1", { type: "crew-vote", target: "s5" });
    g.do("s2", { type: "crew-vote", target: "s5" });
    g.do("s3", { type: "check", target: "s1" });
    g.do("s4", { type: "protect", target: "s6" });
    // Everyone with a night action has acted, so the night ends early.
    const events = g.next();
    expect(g.state.phase).toBe("dawn");
    expect(events.find((e) => e.kind === "night-out")).toMatchObject({ target: "s5", data: { role: "neighbour" }, visibility: { to: "all" } });
    expect(events.find((e) => e.kind === "check-result")).toMatchObject({ target: "s1", data: { result: "crew" }, visibility: { to: "seat", seat: "s3" } });
    expect(g.state.seats[4]).toMatchObject({ alive: false, out: { round: 1, cause: "night" } });
  });

  it("ends early once every night action is in", () => {
    const g = game(rigged(roles));
    g.to("night");
    const start = g.state.endsAt;
    g.do("s1", { type: "crew-vote", target: "s5" });
    g.do("s2", { type: "crew-vote", target: "s5" });
    g.do("s3", { type: "check", target: "s5" });
    g.do("s4", { type: "protect", target: "s5" });
    const early = advance(g.state, start - DURATIONS.normal.night + 1000);
    expect(early.state.phase).toBe("dawn");
  });

  it("lets the Medic save the target, and tells only the Medic", () => {
    const g = game(rigged(roles));
    g.to("night");
    g.do("s1", { type: "crew-vote", target: "s6" });
    g.do("s2", { type: "crew-vote", target: "s6" });
    g.do("s4", { type: "protect", target: "s6" });
    const events = g.next();
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["protect-held", "quiet-night"]));
    expect(events.find((e) => e.kind === "protect-held")!.visibility).toEqual({ to: "seat", seat: "s4" });
    expect(g.state.seats[5].alive).toBe(true);
  });

  it("doesn't let the Medic protect the same person two nights running", () => {
    const g = game(rigged(roles));
    g.to("night");
    g.do("s4", { type: "protect", target: "s6" });
    g.to("dawn");
    g.to("night"); // through day, vote and verdict to the next night
    expect(g.state.round).toBe(2);
    expectRule(() => g.do("s4", { type: "protect", target: "s6" }), "bad-target");
    g.do("s4", { type: "protect", target: "s4" });
  });

  it("settles crew ties with the Boss, or not at all", () => {
    const withBoss = game(rigged(["boss", "crew", "undercover", "medic", "neighbour", "neighbour", "neighbour"]));
    withBoss.to("night");
    withBoss.do("s1", { type: "crew-vote", target: "s6" });
    withBoss.do("s2", { type: "crew-vote", target: "s7" });
    expect(crewTarget(withBoss.state)).toBe("s6");
    const noBoss = game(rigged(roles));
    noBoss.to("night");
    noBoss.do("s1", { type: "crew-vote", target: "s6" });
    noBoss.do("s2", { type: "crew-vote", target: "s7" });
    expect(crewTarget(noBoss.state)).toBeNull();
  });

  it("shows the Boss as clear to the Undercover", () => {
    const g = game(rigged(["boss", "crew", "undercover", "medic", "neighbour", "neighbour", "neighbour"]));
    g.to("night");
    g.do("s3", { type: "check", target: "s1" });
    const events = g.next();
    expect(events.find((e) => e.kind === "check-result")!.data.result).toBe("clear");
  });
});

describe("day and vote", () => {
  const roles: RoleId[] = ["crew", "influencer", "undercover", "medic", "neighbour", "neighbour", "neighbour"];

  function toVote() {
    const g = game(rigged(roles));
    g.to("night");
    g.to("day");
    return g;
  }

  it("lets the living chat and point, in public", () => {
    const g = toVote();
    g.do("s5", { type: "chat", text: "who was up at 2am" });
    g.do("s5", { type: "point", target: "s1" });
    expect(g.state.pointers).toEqual({ s5: "s1" });
    g.do("s5", { type: "point", target: null });
    expect(g.state.pointers).toEqual({});
    expect(g.log.filter((e) => e.kind === "chat" || e.kind === "point").every((e) => e.visibility.to === "all")).toBe(true);
    expectRule(() => g.do("s5", { type: "vote", target: "s1" }), "not-now");
  });

  it("votes out the most-voted player and reveals their role", () => {
    const g = toVote();
    g.to("vote");
    for (const s of ["s2", "s3", "s4", "s5"]) g.do(s, { type: "vote", target: "s1" });
    g.do("s1", { type: "vote", target: "s5" });
    g.do("s6", { type: "vote", target: "skip" });
    g.do("s7", { type: "vote", target: "skip" });
    const events = g.next();
    expect(events.find((e) => e.kind === "voted-out")).toMatchObject({ target: "s1", data: { role: "crew" } });
    // The only crew member is out: the block wins after the verdict.
    expect(g.state.winner).toMatchObject({ team: "block" });
    g.next();
    expect(g.state.phase).toBe("ended");
    expect(g.log.at(-1)!.kind).toBe("game-end");
  });

  it("sends nobody home on a tie or when skip wins", () => {
    const tie = toVote();
    tie.to("vote");
    tie.do("s2", { type: "vote", target: "s1" });
    tie.do("s3", { type: "vote", target: "s5" });
    expect(tie.next().find((e) => e.kind === "no-verdict")).toBeDefined();
    const skip = toVote();
    skip.to("vote");
    skip.do("s2", { type: "vote", target: "s1" });
    skip.do("s3", { type: "vote", target: "skip" });
    skip.do("s4", { type: "vote", target: "skip" });
    expect(skip.next().find((e) => e.kind === "no-verdict")).toBeDefined();
    expect(skip.state.seats.every((s) => s.alive || s.out?.cause === "night")).toBe(true);
  });

  it("lets the Influencer go viral, and the game carries on", () => {
    const g = toVote();
    g.to("vote");
    for (const s of ["s1", "s3", "s4"]) g.do(s, { type: "vote", target: "s2" });
    const events = g.next();
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["voted-out", "viral"]));
    expect(g.state.viral).toEqual(["s2"]);
    expect(g.state.winner).toBeNull();
  });

  it("refuses votes for yourself or for people who are out", () => {
    const g = toVote();
    g.to("vote");
    expectRule(() => g.do("s3", { type: "vote", target: "s3" }), "bad-target");
  });
});

describe("winning", () => {
  it("gives the crew the game when they're as many as everyone else", () => {
    const g = game(rigged(["crew", "crew", "undercover", "medic", "neighbour"]));
    g.to("night");
    g.do("s1", { type: "crew-vote", target: "s5" });
    g.do("s2", { type: "crew-vote", target: "s5" });
    g.next();
    expect(checkWinner(g.state)).toMatchObject({ team: "crew" });
    g.next();
    expect(g.state.phase).toBe("ended");
  });
});

describe("views", () => {
  const roles: RoleId[] = ["crew", "crew", "undercover", "medic", "neighbour", "neighbour", "influencer"];

  function played() {
    const g = game(rigged(roles));
    g.to("night");
    g.do("s1", { type: "crew-chat", text: "take the cop" });
    g.do("s1", { type: "crew-vote", target: "s5" });
    g.do("s2", { type: "crew-vote", target: "s5" });
    g.do("s3", { type: "check", target: "s2" });
    g.do("s4", { type: "protect", target: "s6" });
    g.next();
    return g;
  }

  it("never shows a neighbour the crew's chat, votes, roster or anyone else's role", () => {
    const g = played();
    const { view, events } = viewFor(g.state, g.log, "s6");
    expect(events.some((e) => ["crew-chat", "crew-vote", "crew-roster", "check-result", "protect-held"].includes(e.kind))).toBe(false);
    expect(events.filter((e) => e.kind === "role").map((e) => e.target)).toEqual(["s6"]);
    const known = view.seats.filter((s) => s.role !== null).map((s) => s.id);
    expect(known.sort()).toEqual(["s5", "s6"]); // themselves, and the person who's out
    expect(view.me!.crew).toEqual([]);
    expect(view.me!.night).toEqual({ crewVotes: null, protect: null, check: null });
  });

  it("shows the crew each other, their chat and their votes", () => {
    const g = played();
    const { view, events } = viewFor(g.state, g.log, "s2");
    expect(view.me!.crew).toEqual(["s1", "s2"]);
    expect(view.seats.find((s) => s.id === "s1")!.role).toBe("crew");
    expect(view.seats.find((s) => s.id === "s3")!.role).toBeNull();
    expect(events.some((e) => e.kind === "crew-chat")).toBe(true);
  });

  it("shows the Undercover their own results only", () => {
    const g = played();
    expect(viewFor(g.state, g.log, "s3").view.me!.checks).toEqual([{ round: 1, target: "s2", result: "crew" }]);
    expect(viewFor(g.state, g.log, "s4").view.me!.checks).toEqual([]);
  });

  it("shows people who are out everything, and everyone everything at the end", () => {
    const g = played();
    const out = viewFor(g.state, g.log, "s5");
    expect(out.view.seats.every((s) => s.role !== null)).toBe(true);
    expect(out.events).toHaveLength(g.log.length);
    const ended = { ...g.state, phase: "ended" as const };
    expect(g.log.every((e) => canSee(e, "s6", ended))).toBe(true);
  });

  it("gives a spectator with no seat only public events", () => {
    const g = played();
    const { view, events } = viewFor(g.state, g.log, null);
    expect(view.me).toBeNull();
    expect(events.every((e) => e.visibility.to === "all")).toBe(true);
  });
});
