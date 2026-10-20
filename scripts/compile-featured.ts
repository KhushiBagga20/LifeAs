// Compiles the six featured careers with the real model and commits them to src/data/workplaces,
// so visitors get them instantly and for free. Needs ANTHROPIC_API_KEY. Prints the cost.
//   npm run compile:featured
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileWorkplace, coverageGaps } from "../src/engine/compiler";
import { DEFAULT_OPTIONS, FEATURED_DIR, FEATURED_SEED, workplaceId } from "../src/engine/workplaces";
import { featuredCareers } from "../src/lib/featured";
import { readCareerProfile, readOnetMeta } from "../src/lib/onet/data";
import { getLLM } from "../src/llm";

async function main() {
  const llm = getLLM();
  if (llm.provider.name === "fake") {
    console.error("Featured workplaces must be written by a real model: set ANTHROPIC_API_KEY in .env.local.");
    process.exit(1);
  }
  const meta = await readOnetMeta();
  mkdirSync(FEATURED_DIR, { recursive: true });
  for (const career of featuredCareers) {
    const profile = (await readCareerProfile(career.code))!;
    const started = Date.now();
    const { workplace, report } = await compileWorkplace({ profile, meta, options: DEFAULT_OPTIONS, seed: FEATURED_SEED }, llm);
    const id = workplaceId(career.code, DEFAULT_OPTIONS, FEATURED_SEED, meta.version);
    writeFileSync(join(FEATURED_DIR, `${id}.json`), JSON.stringify(workplace, null, 1) + "\n");
    const gaps = coverageGaps(workplace.week, profile);
    console.log(
      `${career.name}: ${workplace.setting.organisation}, ${workplace.cast.length} people, ${workplace.week.length} moments` +
        `${report.repairIssues.length ? `, repaired ${report.repairIssues.length}` : ""}${report.fallbackFixes.length ? `, fallback fixes ${report.fallbackFixes.length}` : ""}` +
        `${gaps.length ? `, COVERAGE GAPS ${JSON.stringify(gaps)}` : ""} · ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
