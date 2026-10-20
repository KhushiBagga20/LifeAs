import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/onet/types";
import { prepareIndex, searchCareers, stem, tokenize, withinEdits } from "@/lib/search";

describe("tokenize", () => {
  it("lowercases, drops filler words and stems plurals", () => {
    expect(tokenize("Accountants and Auditors")).toEqual(["accountant", "auditor"]);
    expect(tokenize("Registered Nurses")).toEqual(["registered", "nurse"]);
    expect(stem("nursery")).toBe("nursery");
    expect(stem("technologies")).toBe("technology");
  });

  it("maps everyday words to the ones titles use", () => {
    expect(tokenize("doctor")).toEqual(["physician"]);
  });

  it("ignores words that happen to be object properties", () => {
    expect(tokenize("constructor")).toEqual(["constructor"]);
  });
});

describe("withinEdits", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(withinEdits("practioner", "practitioner", 2)).toBe(true);
    expect(withinEdits("lawyer", "sawyer", 1)).toBe(true);
    expect(withinEdits("lawyer", "layer", 0)).toBe(false);
  });
});

describe("searchCareers on the real O*NET index", () => {
  const index = JSON.parse(readFileSync("src/data/onet/index.json", "utf8")) as IndexEntry[];
  const prepared = prepareIndex(index);
  const top = (q: string) => searchCareers(prepared, q, 5).map((r) => r.entry.title);

  it.each([
    ["nurse", "Registered Nurses"],
    ["ux designer", "Web and Digital Interface Designers"],
    ["electrician", "Electricians"],
    ["Electricians", "Electricians"],
    ["electri", "Electricians"],
    ["lawyer", "Lawyers"],
    ["accountant", "Accountants and Auditors"],
    ["software engineer", "Software Developers"],
    ["chef", "Chefs and Head Cooks"],
  ])("“%s” finds %s first", (query, title) => {
    expect(top(query)[0]).toBe(title);
  });

  it("doesn't match inside other words", () => {
    const matched = searchCareers(prepared, "nurse", 20).map((r) => r.matchedTitle ?? "");
    expect(matched.filter((t) => /nursery|nursemaid/i.test(t))).toEqual([]);
  });

  it("only uses typo matching when nothing matches as typed", () => {
    expect(top("lawyer")).toEqual(["Lawyers"]);
    expect(top("nurse practioner")[0]).toBe("Nurse Practitioners");
    expect(top("acountant")[0]).toBe("Accountants and Auditors");
  });

  it("says which title matched when it isn't the occupation title", () => {
    const [first] = searchCareers(prepared, "ux designer", 1);
    expect(first.matchedTitle).toMatch(/UX Designer/);
  });

  it("returns nothing for empty or unknown queries", () => {
    expect(top("   ")).toEqual([]);
    expect(top("youtuber")).toEqual([]);
  });
});
