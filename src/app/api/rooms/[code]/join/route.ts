import { z } from "zod";
import { roomDeps, respond } from "@/rooms/http";
import { joinRoom } from "@/rooms/service";

const Body = z.object({ name: z.string().max(60) });

export async function POST(request: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  const { code } = await ctx.params;
  return respond(async () => joinRoom(await roomDeps(), code, Body.parse(await request.json())));
}
