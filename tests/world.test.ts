import { describe, expect, it } from "vitest";
import { canWalk, distance, findPath, initialLayout, obstacles, reviewLayout, stations } from "@/world/simulation";

describe("physical workplace navigation", () => {
  it("routes the player to every workstation without crossing furniture", () => {
    for (const target of Object.values(stations)) {
      const path = findPath({ x: -0.5, z: 1.7 }, target);
      expect(path.length).toBeGreaterThan(0);
      expect(distance(path.at(-1)!, target)).toBeLessThan(0.7);
      for (const point of path) expect(canWalk(point)).toBe(true);
    }
  });
  it("routes between each pair of stations", () => {
    for (const from of Object.values(stations)) for (const to of Object.values(stations)) {
      if (from === to) continue;
      const path = findPath(from, to);
      expect(path.length).toBeGreaterThan(0);
      expect(distance(path.at(-1)!, to)).toBeLessThan(0.7);
    }
  });
  it("rejects walking inside desks or outside the studio", () => {
    expect(canWalk({ x: 8, z: 0 })).toBe(false);
    for (const obstacle of obstacles) expect(canWalk(obstacle)).toBe(false);
  });
});
describe("reviewing the player's artifact", () => {
  it("responds to actual type size and placement", () => {
    expect(reviewLayout(initialLayout).join()).toContain("booking line");
    const fixed = initialLayout.map(i => i.id === "booking" ? { ...i, size: 16 } : i);
    expect(reviewLayout(fixed)).toEqual(["The hierarchy is clear and the booking line reads well. Let’s see it on paper."]);
    expect(reviewLayout(fixed.map(i => ({ ...i, y: 20 }))).join()).toContain("overlap");
  });
});
