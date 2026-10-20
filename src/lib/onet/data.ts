import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CareerProfile, Meta } from "./types";

// Plain readers for the committed O*NET® data in src/data/onet, usable anywhere (engine,
// scripts, tests). Pages go through src/lib/careers.ts, which adds Next.js caching.

export const ONET_DIR = join(process.cwd(), "src/data/onet");
export const CAREER_CODE = /^\d{2}-\d{4}\.\d{2}$/;

export async function readCareerProfile(code: string): Promise<CareerProfile | null> {
  if (!CAREER_CODE.test(code)) return null;
  try {
    return CareerProfile.parse(JSON.parse(await readFile(join(ONET_DIR, "profiles", `${code}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readOnetMeta(): Promise<Meta> {
  return Meta.parse(JSON.parse(await readFile(join(ONET_DIR, "meta.json"), "utf8")));
}
