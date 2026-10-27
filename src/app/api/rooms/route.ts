import { z } from "zod";
import { roomDeps, respond } from "@/rooms/http";
import { createRoom, SettingsPatch } from "@/rooms/service";

const Body = z.object({ name: z.string().max(60), settings: SettingsPatch.optional() });

export async function POST(request: Request) {
  return respond(async () => createRoom(await roomDeps(), Body.parse(await request.json())));
}
