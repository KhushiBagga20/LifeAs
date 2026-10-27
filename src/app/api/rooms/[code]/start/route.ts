import { roomDeps, respond, talkAfter, tokenOf } from "@/rooms/http";
import { startGame } from "@/rooms/service";

export async function POST(request: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  const { code } = await ctx.params;
  talkAfter(code);
  return respond(async () => startGame(await roomDeps(), code, tokenOf(request)));
}
