import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featuredCareers } from "@/lib/featured";
import { CareerProfile, IndexEntry, Meta } from "@/lib/onet/types";
import { contextGroups } from "@/lib/career-labels";

// Checks the committed output of scripts/import-onet.ts.
const DIR = "src/data/onet";
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), "utf8"));
const meta = Meta.parse(read("meta.json"));
const index = IndexEntry.array().parse(read("index.json"));
const files = readdirSync(join(DIR, "profiles"));

describe("generated career data", () => {
  it("has one valid profile per index entry", () => {
    expect(files).toHaveLength(index.length);
    expect(meta.occupations).toBe(index.length);
    for (const file of files) {
      const profile = CareerProfile.parse(read(join("profiles", file)));
      expect(`${profile.code}.json`).toBe(file);
      const total = Object.values(profile.kinds).reduce((a, k) => a + k.share, 0);
      expect(total).toBeCloseTo(1, 2);
    }
  });

  it("comes from O*NET 31.0", () => {
    expect(meta.version).toBe("31.0");
  });

  it("labels every work-context item a career page shows", () => {
    for (const item of contextGroups.flatMap((g) => g.items)) {
      expect(meta.context[item.id], item.id).toBeDefined();
    }
  });

  it.each(featuredCareers)("featured $name exists and is mostly its kind of work", ({ code, kind }) => {
    const profile = CareerProfile.parse(read(join("profiles", `${code}.json`)));
    expect(profile.highPoints[0]).toBe(kind);
  });
});
