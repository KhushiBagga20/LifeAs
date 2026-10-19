import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Quality bar (DESIGN.md §7.6): text tokens keep a contrast of at least 4.5:1 in both themes.
const css = readFileSync("src/app/globals.css", "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`missing block ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]),
  );
}

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
  ["ink", "paper"],
  ["ink", "paper-3"],
  ["ink-soft", "paper"],
  ["ink-soft", "paper-2"],
  ["accent-ink", "paper"],
  ["on-accent", "accent"],
  ["energised", "paper"],
  ["pressure", "paper"],
  ["info", "paper"],
];

const themes = {
  light: block(":root"),
  dark: block(':root[data-theme="dark"]'),
};

describe("design tokens", () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const [text, background] of textPairs) {
      it(`${theme}: ${text} on ${background} is at least 4.5:1`, () => {
        expect(contrast(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("the system dark theme matches the forced dark theme", () => {
    expect(block(':root:not([data-theme="light"])')).toEqual(themes.dark);
  });
});
