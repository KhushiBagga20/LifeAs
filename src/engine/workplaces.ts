import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { workplaces } from "@/db/schema";
import { readCareerProfile, readOnetMeta } from "@/lib/onet/data";
import type { LLM } from "@/llm";
import { compileWorkplace, workplaceId } from "./compiler";
import { Workplace, type WorkplaceOptions } from "./types";

// Getting a workplace: from the database, from the committed featured workplaces
// (src/data/workplaces, written by scripts/compile-featured.ts with a real model), or by
// compiling one now.

export const FEATURED_DIR = join(process.cwd(), "src/data/workplaces");
export const FEATURED_SEED = "featured";
export const DEFAULT_OPTIONS: WorkplaceOptions = { level: "junior", workplace: "", location: "", length: "full" };

export { workplaceId };

async function readFeatured(id: string): Promise<Workplace | null> {
  try {
    return Workplace.parse(JSON.parse(await readFile(join(FEATURED_DIR, `${id}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class UnknownCareerError extends Error {
  constructor(code: string) {
    super(`No career ${code} in the O*NET data`);
    this.name = "UnknownCareerError";
  }
}

export async function getWorkplace(
  { code, options, seed }: { code: string; options: WorkplaceOptions; seed: string },
  { db, llm }: { db: Database; llm: LLM },
): Promise<Workplace> {
  // The id covers the career, options, seed, O*NET release and compiler version, so a change to
  // any of them compiles a new workplace instead of reusing a stale one.
  const meta = await readOnetMeta();
  const id = workplaceId(code, options, seed, meta.version);
  const [row] = await db.select().from(workplaces).where(eq(workplaces.id, id)).limit(1);
  if (row) return Workplace.parse(row.data);

  const featured = await readFeatured(id);
  if (featured) return featured;

  const profile = await readCareerProfile(code);
  if (!profile) throw new UnknownCareerError(code);
  const { workplace } = await compileWorkplace({ profile, meta, options, seed }, llm);
  await db
    .insert(workplaces)
    .values({ id, careerCode: code, options, seed, data: workplace, source: llm.provider.name === "fake" ? "fake" : "ai" })
    .onConflictDoNothing();
  return workplace;
}
