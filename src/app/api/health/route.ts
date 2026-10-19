import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";

export async function GET() {
  await connection();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: "up" });
  } catch (error) {
    console.error("health check: database query failed", error);
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
