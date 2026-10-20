// Prints the top search results for each query: npm run search -- "nurse" "ux designer"
import { readFileSync } from "node:fs";
import type { IndexEntry } from "../src/lib/onet/types";
import { prepareIndex, searchCareers } from "../src/lib/search";

const index = JSON.parse(readFileSync("src/data/onet/index.json", "utf8")) as IndexEntry[];
const prepared = prepareIndex(index);

for (const query of process.argv.slice(2)) {
  const started = performance.now();
  const results = searchCareers(prepared, query, 5);
  const ms = (performance.now() - started).toFixed(1);
  console.log(`\n"${query}" (${ms} ms)`);
  for (const r of results) {
    const via = r.matchedTitle ? `  ← ${r.matchedTitle}` : "";
    console.log(`  ${r.score.toFixed(2)}  ${r.entry.title}${via}`);
  }
}
