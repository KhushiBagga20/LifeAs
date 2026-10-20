import type { NextRequest } from "next/server";
import { findCareers } from "@/lib/careers";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!query) return Response.json({ query, results: [] });
  return Response.json({ query, results: await findCareers(query, 10) });
}
