import { roomDeps, respond, tokenOf } from "@/rooms/http";
import { SettingsPatch, updateSettings } from "@/rooms/service";

export async function POST(request: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  const { code } = await ctx.params;
  return respond(async () => updateSettings(await roomDeps(), code, tokenOf(request), SettingsPatch.parse(await request.json())));
}
