import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const LOCAL_PGLITE_DIR = ".data/blockc";

type Options = {
  /** Postgres connection string. Defaults to DATABASE_URL. */
  url?: string;
  /** PGlite data directory when no URL is given; "memory://" for tests. */
  pgliteDir?: string;
};

// With a connection string (production, or a local Postgres) we use node-postgres.
// Without one we fall back to an embedded PGlite database, so the app runs with no setup.
export function createDatabase({
  url = process.env.DATABASE_URL,
  pgliteDir = LOCAL_PGLITE_DIR,
}: Options = {}): Database {
  if (url) {
    return drizzlePg({ client: new Pool({ connectionString: url }), schema });
  }
  if (!pgliteDir.includes("://")) {
    // PGlite creates its own folder but not the parents.
    mkdirSync(dirname(pgliteDir), { recursive: true });
  }
  return drizzlePglite({ client: new PGlite(pgliteDir), schema });
}

// One instance per server process, kept across hot reloads in development.
const globalForDb = globalThis as unknown as { lifeasDb?: Database };

export function getDb(): Database {
  globalForDb.lifeasDb ??= createDatabase();
  return globalForDb.lifeasDb;
}
