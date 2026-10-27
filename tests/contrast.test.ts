import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Quality bar (DESIGN.md §4.3): text tokens keep a contrast of at least 4.5:1.
const css = readFileSync("src/app/globals.css", "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const textPairs: [text: string, background: string][] = [
  ["text", "bg"],
  ["text", "surface-2"],
  ["text-soft", "bg"],
  ["text-soft", "surface"],
  ["text-soft", "surface-2"],
  ["amber", "bg"],
  ["amber", "surface"],
  ["on-amber", "amber"],
  ["crew", "bg"],
  ["crew", "surface"],
  ["block", "bg"],
  ["block", "surface"],
  ["danger", "surface"],
  ["success", "surface"],
];

describe("design tokens", () => {
  for (const [text, background] of textPairs) {
    it(`${text} on ${background} is at least 4.5:1`, () => {
      expect(tokens[text], text).toBeDefined();
      expect(contrast(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
