import type { NextRequest } from "next/server";
import { roomDeps, respond, talkAfter, tokenOf } from "@/rooms/http";
import { pollRoom } from "@/rooms/service";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/rooms/[code]">) {
  const { code } = await ctx.params;
  talkAfter(code);
  const since = Number(request.nextUrl.searchParams.get("since") ?? -1);
  return respond(async () => pollRoom(await roomDeps(), code, tokenOf(request), Number.isFinite(since) ? since : -1));
}
