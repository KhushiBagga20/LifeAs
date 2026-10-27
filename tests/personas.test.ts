import { describe, expect, it } from "vitest";
import { personasFor } from "@/ai/personas";

describe("AI personas", () => {
  it("are the same for the same seed, and different for another", () => {
    expect(personasFor("seed-a", 6)).toEqual(personasFor("seed-a", 6));
    expect(personasFor("seed-a", 6)).not.toEqual(personasFor("seed-b", 6));
  });
  it("give every neighbour their own name, flat and quirk", () => {
    for (let i = 0; i < 50; i++) {
      const people = personasFor(`table-${i}`, 11, ["Maya", "dev"]);
      for (const key of ["name", "flat", "quirk"] as const) expect(new Set(people.map((p) => p[key])).size).toBe(11);
      // Never a human's name, whatever its case.
      expect(people.map((p) => p.name.toLowerCase())).not.toContain("maya");
      expect(people.map((p) => p.name.toLowerCase())).not.toContain("dev");
      for (const p of people) expect(p.flat).toMatch(/^[1-5][ABC]$/);
    }
  });
});
