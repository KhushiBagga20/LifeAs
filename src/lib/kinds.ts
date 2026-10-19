// The six kinds of work are O*NET's interest areas (RIASEC) in plain words. DESIGN.md §1.4.
export const kindsOfWork = [
  {
    code: "R",
    name: "Hands-on",
    body: "Building, fixing, operating, working with tools and your body.",
  },
  {
    code: "I",
    name: "Thinking",
    body: "Analysing, researching, solving problems with ideas and data.",
  },
  {
    code: "A",
    name: "Creating",
    body: "Designing, writing, making things that didn’t exist before.",
  },
  { code: "S", name: "Helping", body: "Caring for, teaching and supporting people." },
  { code: "E", name: "Leading", body: "Persuading, deciding, selling, taking charge of outcomes." },
  {
    code: "C",
    name: "Organising",
    body: "Keeping records, following procedures, making systems run.",
  },
] as const;

export type KindCode = (typeof kindsOfWork)[number]["code"];
