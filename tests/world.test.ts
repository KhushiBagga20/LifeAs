import { describe, expect, it } from "vitest";
import { createGame } from "@/game/engine";
import { phases } from "@/game/types";
import { viewFor } from "@/game/view";
import { createDemoGame, demoView } from "@/world/demo";
import { CAMERA, humanLook, mixHex, PHASE_LOOKS, ringPositions, ringRadius, wrapLines } from "@/world/layout";
import { sceneFromView, spotlightFor } from "@/world/scene-state";

// The courtyard's plain parts (DESIGN.md §4): the ring, bubbles, lighting, what the scene is
// told, and the landing page's demo game. The WebGL itself is checked in the browser (e2e).

describe("the ring", () => {
  it.each([5, 6, 7, 8, 9, 10, 11, 12])("spaces %i people evenly, the viewer nearest the camera", (n) => {
    for (let front = 0; front < n; front++) {
      const spots = ringPositions(n, front);
      expect(spots).toHaveLength(n);
      const toCamera = (p: { x: number; z: number }) => Math.hypot(p.x - CAMERA.x, p.z - CAMERA.z);
      const nearest = spots.reduce((best, p, i) => (toCamera(p) < toCamera(spots[best]) ? i : best), 0);
      expect(nearest).toBe(front);
      for (const p of spots) expect(Math.hypot(p.x, p.z)).toBeCloseTo(ringRadius(n));
      // Room to stand: neighbours are at least a body and a half apart.
      for (let i = 0; i < n; i++) {
        const a = spots[i];
        const b = spots[(i + 1) % n];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.2);
      }
      // Everyone faces the lamp in the middle.
      for (const p of spots) {
        const ahead = { x: p.x + Math.sin(p.facing), z: p.z + Math.cos(p.facing) };
        expect(Math.hypot(ahead.x, ahead.z)).toBeLessThan(Math.hypot(p.x, p.z));
      }
    }
  });
});

describe("speech bubbles", () => {
  it("wrap to the width and cut long messages with an ellipsis", () => {
    expect(wrapLines("who was out on the stairs at 3am", 13, 3)).toEqual(["who was out", "on the stairs", "at 3am"]);
    const long = wrapLines("ok but has anyone noticed that 4B keeps changing the subject every single time we ask", 20, 3);
    expect(long).toHaveLength(3);
    expect(long[2].endsWith("…")).toBe(true);
    for (const line of long) expect(line.length).toBeLessThanOrEqual(20);
    expect(wrapLines("supercalifragilisticexpialidocious", 10, 2)).toEqual(["supercali…"]);
  });
});

describe("lighting", () => {
  it("has a look for every phase: windows lit at night, dark by day", () => {
    for (const phase of phases) expect(PHASE_LOOKS[phase]).toBeTruthy();
    expect(PHASE_LOOKS.night.windows).toBeGreaterThan(PHASE_LOOKS.day.windows);
    expect(PHASE_LOOKS.night.lamp).toBeGreaterThan(PHASE_LOOKS.day.lamp);
  });
  it("mixes colours", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ff8000", 0.5)).toBe("#804000");
  });
  it("gives humans a steady look", () => {
    expect(humanLook("ABCD", "s1")).toEqual(humanLook("ABCD", "s1"));
    expect(humanLook("ABCD", "s1").top).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("what the scene is told", () => {
  const players = ["Maya", "Dev", "Rosa", "Kofi", "Lena", "Arjun", "Zoe", "Tariq"].map((name, i) => ({ id: `s${i + 1}`, name, kind: "human" as const }));
  const { state, events } = createGame({ players, settings: { seats: 8, boss: true, influencer: true, pace: "normal" }, seed: "scene", now: 0 });

  it("shows a spectator no living person's role", () => {
    const { view, events: seen } = viewFor(state, events, null);
    const scene = sceneFromView(view, seen, {}, "ROOM");
    expect(scene.seats.every((s) => s.role === null && !s.me && !s.crewmate)).toBe(true);
  });
  it("marks a crew viewer's crewmates, and only theirs", () => {
    const crew = state.seats.filter((s) => s.role === "crew" || s.role === "boss");
    const { view, events: seen } = viewFor(state, events, crew[0].id);
    const scene = sceneFromView(view, seen, {}, "ROOM");
    expect(scene.seats.filter((s) => s.crewmate).map((s) => s.id)).toEqual(crew.slice(1).map((s) => s.id));
    expect(scene.seats.find((s) => s.me)!.role).toMatch(/Crew|Boss/);
    const outsider = state.seats.find((s) => s.role === "neighbour")!;
    const theirs = sceneFromView(viewFor(state, events, outsider.id).view, events, {}, "ROOM");
    expect(theirs.seats.some((s) => s.crewmate)).toBe(false);
    expect(theirs.seats.filter((s) => s.role).map((s) => s.id)).toEqual([outsider.id]);
  });
  it("puts the spotlight on the one clear vote leader", () => {
    const { view } = viewFor(state, events, null);
    expect(spotlightFor({ ...view, phase: "vote", votes: { s1: "s3", s2: "s3", s4: "s5" } }, [])).toBe("s3");
    expect(spotlightFor({ ...view, phase: "vote", votes: { s1: "s3", s4: "s5" } }, [])).toBeNull();
    expect(spotlightFor({ ...view, phase: "vote", votes: { s1: "skip" } }, [])).toBeNull();
  });
});

describe("the landing page's demo game", () => {
  it("plays a whole game in the browser's way, with talk and narration, showing only public events", () => {
    let now = 0;
    const game = createDemoGame("landing-1", now);
    const seen: string[] = [];
    while (game.state.phase !== "ended" && now < 30 * 60_000) {
      now += 500;
      for (const e of game.step(now)) seen.push(e.kind);
    }
    expect(game.state.phase).toBe("ended");
    expect(seen.filter((k) => k === "chat").length).toBeGreaterThan(5);
    expect(seen).toContain("narration");
    const { events } = demoView(game);
    // Mid-game a spectator gets nothing private; at the end everything is public anyway.
    const mid = viewFor({ ...game.state, phase: "day" }, game.events, null).events;
    expect(mid.every((e) => e.visibility.to === "all")).toBe(true);
    expect(events.length).toBe(game.events.length);
  });
});
