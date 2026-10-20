// Builds src/data/onet/ from an unpacked O*NET® database release (JSON format).
//
//   curl -L -o .data/onet/db_31_0_json.zip https://www.onetcenter.org/dl_files/database/db_31_0_json.zip
//   unzip -o .data/onet/db_31_0_json.zip -d .data/onet
//   npm run onet:import -- .data/onet/db_31_0_json 31.0 "August 2026"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildCareerData, type Tables } from "../src/lib/onet/build";
import { CareerProfile, IndexEntry, Meta } from "../src/lib/onet/types";

const [source = ".data/onet/db_31_0_json", version = "31.0", release = "August 2026"] =
  process.argv.slice(2);
const OUT = "src/data/onet";

const tableNames: (keyof Tables)[] = [
  "occupation_data",
  "job_titles",
  "sample_of_reported_titles",
  "task_statements",
  "task_ratings",
  "task_categories",
  "work_activities",
  "work_context",
  "work_context_categories",
  "career_interest_types",
  "job_zones",
  "job_zone_reference",
  "related_occupations",
];

const tables = Object.fromEntries(
  tableNames.map((name) => {
    const file = JSON.parse(readFileSync(join(source, `${name}.json`), "utf8")) as { row: unknown[] };
    return [name, file.row];
  }),
) as Tables;

const { meta, index, profiles, skipped } = buildCareerData(tables, version, release);

// Validate everything before writing anything.
Meta.parse(meta);
z.array(IndexEntry).parse(index);
z.array(CareerProfile).parse(profiles);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "profiles"), { recursive: true });
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
writeFileSync(join(OUT, "index.json"), JSON.stringify(index) + "\n");
for (const profile of profiles) {
  writeFileSync(join(OUT, "profiles", `${profile.code}.json`), JSON.stringify(profile) + "\n");
}

console.log(`O*NET ${version}: wrote ${profiles.length} careers to ${OUT}`);
console.log(`Skipped ${skipped.length} occupations without enough data, e.g.`);
for (const s of skipped.slice(0, 5)) console.log(`  ${s.code} ${s.title}`);
