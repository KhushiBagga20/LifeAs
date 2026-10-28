import type { Persona } from "@/ai/personas";
import type { Phase, SeatId } from "@/game/types";
import { createRng } from "@/lib/rng";

// The courtyard's plain maths (DESIGN.md §4): where everyone stands, what humans look like, how
// speech bubbles wrap and how each phase is lit. No three.js here, so it can be tested.

export type Look = Persona["look"];
export type Point = { x: number; z: number };

/** The camera sits on this side of the courtyard; the viewer's own seat goes nearest to it. */
export const CAMERA = { x: 15, y: 18, z: 19 } as const;
const FRONT = Math.atan2(CAMERA.x, CAMERA.z);

/** The ring's radius for n people: roomy for five, still on screen for twelve. */
export const ringRadius = (n: number) => 2.4 + n * 0.2;

/**
 * Everyone in a ring around the lamp post, evenly spaced, with seat `front` (the viewer) nearest
 * the camera and the rest going round in seat order. Each faces the middle.
 */
export function ringPositions(n: number, front = 0): (Point & { facing: number })[] {
  const r = ringRadius(n);
  return Array.from({ length: n }, (_, i) => {
    const angle = FRONT + ((i - front) / n) * Math.PI * 2;
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;
    return { x, z, facing: Math.atan2(-x, -z) };
  });
}

const TOPS = ["#e0703a", "#2f9e6e", "#3b6fd8", "#c94f8f", "#d8a23b", "#7a5fd8"];
const SKINS = ["#f1c9a5", "#e0ac84", "#c68a5e", "#a26c45", "#7a4e31", "#5a3825"];
const HAIRS = ["#1b1714", "#3b2618", "#6b4423", "#b78a4a", "#7a7a7a"];

/** Human players don't have personas; give them a steady look from the room and seat. */
export function humanLook(room: string, seat: SeatId): Look {
  const rng = createRng(`${room}/${seat}/look`);
  return { top: rng.pick(TOPS), skin: rng.pick(SKINS), hair: rng.pick(HAIRS), hat: rng.chance(0.25) };
}

/**
 * The camera's half-width and half-height (world units) to frame n people and their name tags
 * and bubbles: wide screens fit by height, narrow ones by width.
 */
export function frameFor(n: number, aspect: number): { halfW: number; halfH: number } {
  const r = ringRadius(n);
  const needW = r + 1.4;
  const needH = r * 0.62 + 2.7;
  const halfH = Math.max(needH, needW / aspect);
  return { halfW: halfH * aspect, halfH };
}

/** Splits a message into at most `maxLines` lines of about `width` characters, with "…" if cut. */
export function wrapLines(text: string, width = 26, maxLines = 3): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const piece = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    if (!line) line = piece;
    else if (line.length + 1 + piece.length <= width) line += ` ${piece}`;
    else {
      lines.push(line);
      line = piece;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.length >= width ? last.slice(0, width - 1) : last}…`;
  return kept;
}

/** How a phase is lit: sky, fog, the two lights, how many windows glow, and the lamp. */
export type PhaseLook = {
  sky: string;
  ground: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunIntensity: number;
  /** Share of windows lit, 0–1. */
  windows: number;
  lamp: number;
};

const NIGHT: PhaseLook = { sky: "#070a14", ground: "#1a2033", hemiSky: "#3a4a80", hemiGround: "#0b0f1a", hemi: 0.9, sun: "#8aa0ff", sunIntensity: 0.45, windows: 0.55, lamp: 26 };
const DAWN: PhaseLook = { sky: "#2b2340", ground: "#3a3344", hemiSky: "#ffb38a", hemiGround: "#2a2238", hemi: 1.6, sun: "#ffa76b", sunIntensity: 1.8, windows: 0.3, lamp: 8 };
const DAY: PhaseLook = { sky: "#9fc3e6", ground: "#8d8a80", hemiSky: "#fff6de", hemiGround: "#6b6a73", hemi: 2.4, sun: "#fff1cc", sunIntensity: 3.2, windows: 0.08, lamp: 0 };
const VOTE: PhaseLook = { ...DAY, sky: "#d9a36b", hemiSky: "#ffd7a8", hemi: 1.9, sun: "#ffb874", sunIntensity: 2.4, windows: 0.2, lamp: 6 };
const VERDICT: PhaseLook = { ...NIGHT, sky: "#1c1426", hemi: 1.1, sunIntensity: 0.6, windows: 0.4, lamp: 14 };

export const PHASE_LOOKS: Record<Phase, PhaseLook> = {
  reveal: NIGHT,
  night: NIGHT,
  dawn: DAWN,
  day: DAY,
  vote: VOTE,
  verdict: VERDICT,
  ended: DAWN,
};

/** Mixes two hex colours: t = 0 gives a, 1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, shift: number) => (p >> shift) & 255;
  const mix = (shift: number) => Math.round(ch(pa, shift) + (ch(pb, shift) - ch(pa, shift)) * t);
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, "0")}`;
}
