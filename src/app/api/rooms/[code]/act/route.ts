import { roomDeps, respond, talkAfter, tokenOf } from "@/rooms/http";
import { actInRoom, IntentBody } from "@/rooms/service";

export async function POST(request: Request, ctx: RouteContext<"/api/rooms/[code]/act">) {
  const { code } = await ctx.params;
  talkAfter(code);
  return respond(async () => actInRoom(await roomDeps(), code, tokenOf(request), IntentBody.parse(await request.json())));
}
