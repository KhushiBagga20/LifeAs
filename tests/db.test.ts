import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "@/db";

describe("createDatabase", () => {
  it("falls back to an in-memory PGlite database without a connection string", async () => {
    const db = createDatabase({ url: "", pgliteDir: "memory://" });
    // The shared Database type doesn't know the driver's result shape; both drivers return rows.
    const result = (await db.execute(sql`select 41 + 1 as answer`)) as { rows: { answer: number }[] };
    expect(result.rows[0]?.answer).toBe(42);
  });
});
