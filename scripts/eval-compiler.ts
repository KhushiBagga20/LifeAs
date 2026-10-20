// Compiles a set of careers with the configured AI (FakeLLM without a key) and reports, per
// career: validity, repairs, fallback fixes, coverage and the data notes. Exits non-zero if any
// career fails to compile.
//   npm run eval:compiler            featured six + a diverse sample, full week
//   npm run eval:compiler -- --all   every career, both lengths (FakeLLM only: costly with a real model)
import { compileWorkplace, CompileError, validateWorkplace } from "../src/engine/compiler";
import type { WorkplaceOptions } from "../src/engine/types";
import { featuredCareers } from "../src/lib/featured";
import { readCareerProfile, readOnetMeta } from "../src/lib/onet/data";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ONET_DIR } from "../src/lib/onet/data";
import { getLLM } from "../src/llm";

const SAMPLE = [
  "53-3054.00", // Taxi Drivers (no task ratings or working conditions)
  "29-2042.00", // Emergency Medical Technicians (no task ratings or working conditions)
  "11-1031.00", // Legislators (no task ratings or working conditions)
  "49-9092.00", // Commercial Divers
  "19-2011.00", // Astronomers
  "33-2011.00", // Firefighters
  "25-2011.00", // Preschool Teachers
  "39-4031.00", // Morticians, Undertakers, and Funeral Arrangers
  "45-2091.00", // Agricultural Equipment Operators
  "53-2011.00", // Airline Pilots
];

async function main() {
  const all = process.argv.includes("--all");
  const llm = getLLM();
  if (all && llm.provider.name !== "fake") {
    console.error("--all compiles ~1,800 workplaces; run it with FakeLLM (unset ANTHROPIC_API_KEY or LLM_PROVIDER=fake).");
    process.exit(1);
  }
  const meta = await readOnetMeta();
  const codes = all
    ? readdirSync(join(ONET_DIR, "profiles")).map((f) => f.replace(/\.json$/, ""))
    : [...featuredCareers.map((c) => c.code), ...SAMPLE];
  const lengths: WorkplaceOptions["length"][] = all ? ["quick", "full"] : ["full"];
  let failed = 0;
  let repaired = 0;
  let fixed = 0;
  const limited: string[] = [];
  for (const code of codes) {
    const profile = (await readCareerProfile(code))!;
    for (const length of lengths) {
      const options: WorkplaceOptions = { level: "junior", workplace: "", location: "", length };
      try {
        const { workplace, report } = await compileWorkplace({ profile, meta, options, seed: "eval" }, llm);
        const problems = validateWorkplace(workplace, profile);
        if (problems.length) throw new CompileError("invalid", problems);
        if (report.repairIssues.length) repaired++;
        if (report.fallbackFixes.length) fixed++;
        const gaps = report.dataNotes.filter((n) => !n.startsWith("The data describes work in the United States"));
        if (gaps.length && length === lengths[0]) limited.push(`${code} ${profile.title}: ${gaps.join(" ")}`);
        if (!all) {
          const rooms = workplace.locations.filter((l) => l.area === "workplace").map((l) => l.kind).join(", ");
          console.log(
            `ok   ${code} ${profile.title.slice(0, 44).padEnd(44)} ${workplace.cast.length} people · rooms: ${rooms}` +
              `${report.repairIssues.length ? ` · repaired ${report.repairIssues.length}` : ""}${report.fallbackFixes.length ? ` · fixes ${report.fallbackFixes.length}` : ""}`,
          );
        }
      } catch (error) {
        failed++;
        const why = error instanceof CompileError ? `${error.reason}: ${error.issues.slice(0, 3).join("; ")}` : String(error);
        console.log(`FAIL ${code} ${profile.title} (${length}) ${why}`);
      }
    }
  }
  const total = codes.length * lengths.length;
  console.log(`\n${total - failed}/${total} compiled and validated · ${repaired} needed repair · ${fixed} needed fallback fixes · provider: ${llm.provider.name}`);
  console.log(`${limited.length} careers with data gaps${all ? "" : " in this set"}:`);
  for (const l of limited.slice(0, all ? 30 : limited.length)) console.log(`  ${l}`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
