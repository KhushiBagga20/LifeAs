import { expect, test } from "@playwright/test";

// The room API over real HTTP: create, join, start, act, poll, with the seat token header.

test("a room goes from lobby to a running game over the API", async ({ request }) => {
  const created = await request.post("/api/rooms", { data: { name: "Maya", settings: { seats: 6 } } });
  expect(created.ok()).toBe(true);
  const host = await created.json();
  expect(host.code).toMatch(/^[A-Z]{4}$/);
  expect(host.token).toBeTruthy();

  const joined = await request.post(`/api/rooms/${host.code}/join`, { data: { name: "Dev" } });
  const guest = await joined.json();
  expect(guest.seatId).toBe("s2");

  // Only the host can start, and the token travels in a header.
  const refused = await request.post(`/api/rooms/${host.code}/start`, { headers: { "x-seat-token": guest.token } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe("Only the host can start the game");
  const started = await request.post(`/api/rooms/${host.code}/start`, { headers: { "x-seat-token": host.token } });
  expect(started.ok()).toBe(true);

  const poll = await (await request.get(`/api/rooms/${host.code}?since=-1`, { headers: { "x-seat-token": guest.token } })).json();
  expect(poll.status).toBe("playing");
  expect(poll.me).toEqual({ seatId: "s2", host: false });
  expect(Object.keys(poll.profiles)).toHaveLength(6);
  expect(poll.view.me.role).toBeTruthy();
  // The guest sees their own role and nobody else's (unless they're both crew).
  const roles = poll.events.filter((e: { kind: string }) => e.kind === "role");
  expect(roles).toHaveLength(1);
  expect(roles[0].target).toBe("s2");

  // Voting now is against the rules, and the error says so.
  const early = await request.post(`/api/rooms/${host.code}/act`, { headers: { "x-seat-token": guest.token }, data: { type: "vote", target: "skip" } });
  expect(early.status()).toBe(422);
  const nonsense = await request.post(`/api/rooms/${host.code}/act`, { headers: { "x-seat-token": guest.token }, data: { type: "dance" } });
  expect(nonsense.status()).toBe(400);

  // A spectator without a token sees only public events.
  const outside = await (await request.get(`/api/rooms/${host.code}`)).json();
  expect(outside.me).toBeNull();
  expect(outside.events.every((e: { visibility: { to: string } }) => e.visibility.to === "all")).toBe(true);

  expect((await request.get("/api/rooms/QQQQ")).status()).toBe(404);
});
