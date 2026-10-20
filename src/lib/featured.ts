import type { KindCode } from "./onet/types";

// One featured career per kind of work, each the kind's clearest everyday example in O*NET®
// (its first interest high point). See PROGRESS.md decisions for why these six.
export const featuredCareers: { code: string; name: string; kind: KindCode }[] = [
  { code: "47-2111.00", name: "Electrician", kind: "R" },
  { code: "15-2051.00", name: "Data scientist", kind: "I" },
  { code: "27-1024.00", name: "Graphic designer", kind: "A" },
  { code: "29-1141.00", name: "Registered nurse", kind: "S" },
  { code: "23-1011.00", name: "Lawyer", kind: "E" },
  { code: "13-2011.00", name: "Accountant", kind: "C" },
];
