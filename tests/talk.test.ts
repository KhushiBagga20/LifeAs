import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { registerAiFakers } from "@/ai/fakes";
import { checkNarration, templateNarration } from "@/ai/narrator";
import { personasFor, textStyles } from "@/ai/personas";
import { checkMessage, templateMessage, type TalkReason } from "@/ai/talk";
import { createDatabase, type Database } from "@/db";
import { migrateDatabase } from "@/db/migrate";
import { rooms } from "@/db/schema";
import { isCrew } from "@/game/roles";
import type { Intent } from "@/game/types";
import type { SeatView } from "@/game/view";
import { createRng, type Rng } from "@/lib/rng";
import { FakeProvider } from "@/llm/fake";
import { LLMError } from "@/llm";
import { readMeta } from "@/rooms/room";
import { actInRoom, createRoom, joinRoom, pollRoom, rawEvents, RoomError, startGame, type Poll } from "@/rooms/service";
import { runTalk, type TalkDeps } from "@/rooms/talk";
import { fakeLLM } from "./helpers";

// AI neighbours' voices and the narrator (DESIGN.md §2): the scheduler, the runner, the checks on
// model output, the template fallbacks, and that no prompt ever holds more than its seat knows.

let db: Database;
beforeAll(async () => {
  db = createDatabase({ url: "", pgliteDir: "memory://" });
  await migrateDatabase(db);
});

function setup(provider = registerAiFakers(new FakeProvider())) {
  const clock = { now: 5_000_000 };
  const deps: TalkDeps = { db, clock: () => clock.now, llm: fakeLLM(provider) };
  return { deps, clock, provider };
}

const persona = personasFor("checks", 1)[0];

describe("checking what the model writes", () => {
  it("keeps good messages and strips a name prefix and quotes", () => {
    expect(checkMessage(`${persona.name}: "ok who was up at 3am?"`, persona, "neighbour", "chat")).toBe("ok who was up at 3am?");
  });
  it("refuses messages that admit to being an AI, are empty or too long", () => {
    expect(checkMessage("As an AI language model I can't say", persona, "neighbour", "chat")).toBeNull();
    expect(checkMessage("   ", persona, "neighbour", "chat")).toBeNull();
    expect(checkMessage("x".repeat(400), persona, "neighbour", "chat")).toBeNull();
  });
  it("stops the crew outing themselves in public, but not in the crew chat", () => {
    for (const slip of ["we're crew, relax", "as the boss I say skip", "my crew would never", "I'm crew lol"]) {
      expect(checkMessage(slip, persona, "crew", "chat")).toBeNull();
      expect(checkMessage(slip, persona, "boss", "chat")).toBeNull();
    }
    expect(checkMessage("my crew would never", persona, "crew", "crew-chat")).toBe("my crew would never");
    // A neighbour talking about the crew is just talking.
    expect(checkMessage("the crew is definitely in 4B", persona, "neighbour", "chat")).toBe("the crew is definitely in 4B");
  });
  it("refuses graphic narration", () => {
    expect(checkNarration("Rain on the courtyard. Someone was stabbed on the stairs.")).toBeNull();
    expect(checkNarration("Rain on the courtyard. Dev from 2B is gone, and the lift won't stop humming.")).toBeTruthy();
  });
});

describe("templates", () => {
  const reasons: TalkReason[] = [
    { type: "day-open" },
    { type: "accused", by: "s1" },
    { type: "mentioned", by: "s1", text: "hey" },
    { type: "reply", by: "s1", text: "hey" },
    { type: "hunch" },
    { type: "vote-call", target: "s2" },
    { type: "vote-call", target: "skip" },
    { type: "crew-plan", target: "s2" },
  ];
  it("always fill every name, in every style, with or without names to use", () => {
    const rng = createRng("templates");
    for (const style of textStyles) {
      for (const reason of reasons) {
        for (const names of [{ s: "Dev", d: "Rosa", by: "Maya", v: "Kofi", t: "Lena" }, {}]) {
          for (let i = 0; i < 20; i++) {
            const claim = i % 5 === 0 ? { target: "s3", result: "crew" as const } : null;
            const text = templateMessage(rng, style, reason, { suspect: null, defend: null, claim }, names);
            expect(text).not.toMatch(/[{}]/);
            expect(text.length).toBeGreaterThan(3);
            expect(text.length).toBeLessThanOrEqual(280);
          }
        }
      }
    }
  });
  it("narrate every moment without leaving a blank", () => {
    const rng = createRng("narration");
    const base = { round: 2, residents: 6, viral: null, winner: null, crew: null, story: [] };
    const cases = [
      { ...base, moment: "intro" as const, out: null },
      { ...base, moment: "dawn" as const, out: { name: "Dev from 2B", role: "Medic", how: "night" as const } },
      { ...base, moment: "dawn" as const, out: null },
      { ...base, moment: "verdict" as const, out: { name: "Dev from 2B", role: "Crew", how: "vote" as const } },
      { ...base, moment: "verdict" as const, out: { name: "Dev from 2B", role: "Influencer", how: "vote" as const }, viral: "Dev from 2B" },
      { ...base, moment: "verdict" as const, out: null },
      { ...base, moment: "end" as const, out: null, winner: { team: "block", reason: "x" }, crew: ["Dev from 2B (Crew)"] },
      { ...base, moment: "end" as const, out: null, winner: { team: "crew", reason: "x" }, crew: ["Dev from 2B (Boss)"] },
    ];
    for (const facts of cases) {
      for (let i = 0; i < 10; i++) {
        const text = templateNarration(rng, facts);
        expect(text).not.toMatch(/[{}]|\bthe \.|  /);
        expect(checkNarration(text)).toBe(text);
      }
    }
  });
});

/** A human who plays along: night jobs, chat that names people, points and votes. */
function humanMove(rng: Rng, view: SeatView, profiles: Poll["profiles"], marker: string): Intent | null {
  const me = view.me;
  if (!me?.alive) return null;
  const others = view.seats.filter((s) => s.alive && s.id !== me.id).map((s) => s.id);
  if (!others.length) return null;
  if (view.phase === "night") {
    if (isCrew(me.role!)) {
      if (!me.night.crewVotes?.[me.id]) {
        const targets = others.filter((id) => !me.crew.includes(id));
        return targets.length ? { type: "crew-vote", target: rng.pick(targets) } : null;
      }
      return rng.chance(0.3) ? { type: "crew-chat", text: `${marker} keep it quiet tomorrow` } : null;
    }
    if (me.role === "medic" && !me.night.protect) return { type: "protect", target: rng.pick([me.id, ...others].filter((id) => id !== me.lastProtected)) };
    if (me.role === "undercover" && !me.night.check) return { type: "check", target: rng.pick(others) };
    return null;
  }
  if (view.phase === "day") {
    const someone = profiles[rng.pick(others)].name;
    return rng.chance(0.6) ? { type: "chat", text: rng.pick([`${someone} where were you last night?`, `i don't trust ${someone}`, "this is getting tense"]) } : { type: "point", target: rng.pick(others) };
  }
  if (view.phase === "vote" && !(me.id in view.votes)) return { type: "vote", target: rng.chance(0.2) ? "skip" : rng.pick(others) };
  return null;
}

/** A game with AI talk: humans poll and act, and the talk runner runs after every request. */
async function playWithTalk(deps: TalkDeps, clock: { now: number }, seed: string, humans: number, seats: number) {
  const rng = createRng(`talk/${seed}`);
  const marker = `CREWSECRET${seed.replace(/\W/g, "")}`;
  const host = await createRoom(deps, { name: "Host", settings: { seats }, seed });
  const players = [{ seatId: host.seatId, token: host.token }];
  for (let i = 1; i < humans; i++) players.push(await joinRoom(deps, host.code, { name: `Friend ${i}` }));
  await startGame(deps, host.code, host.token);
  await runTalk(deps, host.code);
  let last: Poll | null = null;
  for (let turn = 0; turn < 6_000; turn++) {
    clock.now += rng.int(400, 2_500);
    const who = rng.int(0, players.length - 1);
    const poll = await pollRoom(deps, host.code, players[who].token, -1);
    await runTalk(deps, host.code);
    last = poll;
    if (poll.status === "ended") {
      // Let the narrator close the story.
      clock.now += 1_000;
      await runTalk(deps, host.code);
      break;
    }
    const intent = poll.view && humanMove(rng, poll.view, poll.profiles, marker);
    if (intent) {
      try {
        await actInRoom(deps, host.code, players[who].token, intent);
        await runTalk(deps, host.code);
      } catch (error) {
        expect(error).toBeInstanceOf(RoomError);
      }
    }
  }
  return { code: host.code, last: last!, marker };
}

describe("AI talk in a room", () => {
  it("narrates and chats through whole games, offline, at a human pace", async () => {
    const { deps, clock } = setup();
    for (let g = 0; g < 4; g++) {
      const { code, last } = await playWithTalk(deps, clock, `story-${g}`, 1 + (g % 2), 7);
      expect(last.status).toBe("ended");
      const raw = await rawEvents(deps, code);
      const narration = raw.filter((e) => e.kind === "narration");
      const dawns = raw.filter((e) => e.kind === "phase" && e.data.phase === "dawn").length;
      // An opening, one per dawn, one per verdict (give or take a stale one), and an ending.
      expect(narration.length).toBeGreaterThanOrEqual(dawns + 2);
      expect(narration[0].phase).toBe("reveal");
      expect(narration.at(-1)!.phase).toBe("ended");
      expect(narration.at(-1)!.text).toMatch(/crew/i);

      const seats = raw.find((e) => e.kind === "game-start")!.data.seats as { id: string; kind: string }[];
      const ai = new Set(seats.filter((s) => s.kind === "ai").map((s) => s.id));
      const aiChat = raw.filter((e) => e.kind === "chat" && ai.has(e.actor!));
      expect(aiChat.length).toBeGreaterThan(5);
      // Never a flood: AI messages are at least two seconds apart, and each AI waits its turn.
      for (let i = 1; i < aiChat.length; i++) expect(aiChat[i].at - aiChat[i - 1].at).toBeGreaterThanOrEqual(2_000);
      const bySeat = new Map<string, number>();
      for (const e of aiChat) {
        const before = bySeat.get(e.actor!);
        if (before !== undefined) expect(e.at - before).toBeGreaterThanOrEqual(6_000);
        bySeat.set(e.actor!, e.at);
      }
      // Each day stays within its budget.
      const perPhase = new Map<string, number>();
      for (const e of aiChat) perPhase.set(`${e.round}/${e.phase}`, (perPhase.get(`${e.round}/${e.phase}`) ?? 0) + 1);
      for (const count of perPhase.values()) expect(count).toBeLessThanOrEqual(13);
      // The dead stay quiet in public.
      for (const e of aiChat) {
        const out = raw.find((x) => (x.kind === "night-out" || x.kind === "voted-out") && x.target === e.actor);
        if (out) expect(e.seq).toBeLessThan(out.seq);
      }
    }
  }, 120_000);

  it("never gives a prompt more than its seat knows", async () => {
    const { deps, clock, provider } = setup();
    let crewChatsSeen = 0;
    for (let g = 0; g < 6; g++) {
      provider.calls.length = 0;
      const { code, marker } = await playWithTalk(deps, clock, `leak-${g}`, 2, 8);
      const raw = await rawEvents(deps, code);
      const seats = raw.find((e) => e.kind === "game-start")!.data.seats as { id: string; name: string }[];
      const roleOf = new Map(raw.filter((e) => e.kind === "role").map((e) => [e.target!, e.data.role as string]));
      const nameToSeat = new Map(seats.map((s) => [s.name, s.id]));
      crewChatsSeen += raw.filter((e) => e.kind === "crew-chat" && e.text?.includes(marker)).length;
      for (const call of provider.calls) {
        const prompt = call.messages.map((m) => m.content).join("\n");
        if (call.purpose === "narrate") {
          // The narrator only knows what a spectator knows: no crew chat, no hidden roles.
          expect(prompt).not.toContain(marker);
          const facts = JSON.parse(prompt);
          if (facts.moment !== "end") expect(facts.crew).toBeNull();
          continue;
        }
        expect(call.purpose).toBe("ai-chat");
        const context = JSON.parse(prompt);
        const seat = nameToSeat.get(context.you.name)!;
        const crew = isCrew(roleOf.get(seat) as never);
        if (!crew) {
          expect(prompt).not.toContain(marker);
          expect(context.you.crewmates).toBeUndefined();
        }
        if (roleOf.get(seat) !== "undercover") expect(context.you.yourChecks).toBeUndefined();
        expect(context.you.role.toLowerCase()).toBe(roleOf.get(seat));
        // Roles appear only for people who are out (public) and, for the crew, crewmates by name.
        for (const line of context.out as string[]) expect(line).toMatch(/: (Neighbour|Crew|Boss|Undercover|Medic|Influencer)$/);
      }
    }
    // The test only means something if humans really did use the crew chat.
    expect(crewChatsSeen).toBeGreaterThan(0);
  }, 120_000);

  it("falls back to templates when the model fails or says something it shouldn't", async () => {
    const provider = registerAiFakers(new FakeProvider());
    let calls = 0;
    provider.register("ai-chat", () => {
      calls++;
      if (calls % 2) throw new LLMError("provider down", "provider");
      return { message: "As an AI language model, I think Dev is suspicious", pointAt: null, suspects: [], trusts: [] };
    });
    provider.register("narrate", () => ({ text: "There is blood on the stairs and a knife by the bins." }));
    const { deps, clock } = setup(provider);
    const { code } = await playWithTalk(deps, clock, "fallback", 1, 6);
    const raw = await rawEvents(deps, code);
    const texts = raw.filter((e) => e.kind === "chat" || e.kind === "narration").map((e) => e.text!);
    expect(calls).toBeGreaterThan(0);
    expect(texts.length).toBeGreaterThan(3);
    for (const t of texts) expect(t).not.toMatch(/language model|blood|knife/i);
  }, 60_000);

  it("posts each line once, even when two requests run the talk at the same moment", async () => {
    const { deps, clock } = setup();
    const host = await createRoom(deps, { name: "Solo", settings: { seats: 6 }, seed: "twice" });
    await startGame(deps, host.code, host.token);
    // Run two talkers side by side at every step through the first day.
    for (let i = 0; i < 160; i++) {
      clock.now += 1_000;
      await pollRoom(deps, host.code, host.token);
      await Promise.all([runTalk(deps, host.code), runTalk(deps, host.code)]);
    }
    const raw = await rawEvents(deps, host.code);
    const lines = raw.filter((e) => e.kind === "narration" || e.kind === "chat");
    expect(lines.length).toBeGreaterThan(3);
    const ids = raw.filter((e) => e.kind === "narration").map((e) => `${e.round}/${e.phase}/${e.text}`);
    expect(new Set(ids).size).toBe(ids.length);
    const narrationPerPhase = new Map<string, number>();
    for (const e of raw.filter((x) => x.kind === "narration")) narrationPerPhase.set(`${e.round}/${e.phase}`, (narrationPerPhase.get(`${e.round}/${e.phase}`) ?? 0) + 1);
    for (const n of narrationPerPhase.values()) expect(n).toBe(1);
  }, 60_000);

  it("lets the chat sway the AI: what they say feeds what they think", async () => {
    const { deps, clock } = setup();
    const { code } = await playWithTalk(deps, clock, "sway", 1, 7);
    const [row] = await db.select().from(rooms).where(eq(rooms.code, code));
    const meta = readMeta(row.meta);
    const raw = await rawEvents(deps, code);
    const roleOf = new Map(raw.filter((e) => e.kind === "role").map((e) => [e.target!, e.data.role as string]));
    const swayed = Object.keys(meta.opinions);
    expect(swayed.length).toBeGreaterThan(0);
    // Only non-crew AIs keep opinions; the crew knows the truth.
    for (const seat of swayed) expect(isCrew(roleOf.get(seat) as never)).toBe(false);
    for (const scores of Object.values(meta.opinions)) for (const v of Object.values(scores)) expect(Math.abs(v)).toBeLessThanOrEqual(1.5);
  }, 60_000);
});
