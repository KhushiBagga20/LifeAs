import { z } from "zod";
import { getReadyDb } from "@/db/migrate";
import { RoomError, type RoomDeps } from "./service";

// Shared bits for the room API routes: the deps, the seat token header and error responses.

export const TOKEN_HEADER = "x-seat-token";

export async function roomDeps(): Promise<RoomDeps> {
  return { db: await getReadyDb(), clock: Date.now };
}

export const tokenOf = (request: Request) => request.headers.get(TOKEN_HEADER);

const STATUS: Record<RoomError["code"], number> = {
  "not-found": 404,
  forbidden: 403,
  full: 409,
  started: 409,
  "bad-request": 400,
  "slow-down": 429,
  rule: 422,
};

/** Runs a route body, turning bad input and room errors into JSON errors the screens can show. */
export async function respond(body: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await body(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RoomError) return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "That request didn't make sense", code: "bad-request" }, { status: 400 });
    }
    console.error("room route failed", error);
    return Response.json({ error: "Something went wrong on our side", code: "server" }, { status: 500 });
  }
}
