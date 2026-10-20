import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { getDb, type Database } from ".";

const migrationsFolder = join(process.cwd(), "src/db/migrations");

/** Applies any migrations in src/db/migrations that haven't run yet. Safe to call repeatedly. */
export async function migrateDatabase(db: Database): Promise<void> {
  const client = (db as unknown as { $client: unknown }).$client;
  if (client instanceof PGlite) {
    await migratePglite(db as unknown as PgliteDatabase, { migrationsFolder });
  } else {
    await migratePg(db as unknown as NodePgDatabase, { migrationsFolder });
  }
}

let ready: Promise<Database> | undefined;

/** The shared database, migrated once per process. */
export function getReadyDb(): Promise<Database> {
  ready ??= (async () => {
    const db = getDb();
    await migrateDatabase(db);
    return db;
  })();
  return ready;
}
