import type { Rng } from "@/lib/rng";
import type { RoleId } from "./roles";
import type { Settings } from "./types";

// Line-ups (DESIGN.md §1.1): crew 1 for 5–6 players, 2 for 7–9, 3 for 10–12; the Boss replaces
// one crew member when on; always one Undercover and one Medic; Influencer from 7 players.

export const MIN_SEATS = 5;
export const MAX_SEATS = 12;

export function crewCount(seats: number): number {
  return seats <= 6 ? 1 : seats <= 9 ? 2 : 3;
}

export function lineup(settings: Settings): RoleId[] {
  const n = settings.seats;
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) throw new Error(`Block C needs ${MIN_SEATS}–${MAX_SEATS} seats, not ${n}`);
  const crew = crewCount(n);
  const roles: RoleId[] = [];
  for (let i = 0; i < crew; i++) roles.push(settings.boss && i === 0 ? "boss" : "crew");
  roles.push("undercover", "medic");
  if (settings.influencer && n >= 7) roles.push("influencer");
  while (roles.length < n) roles.push("neighbour");
  return roles;
}

/** The line-up shuffled into seat order. */
export function dealRoles(settings: Settings, rng: Rng): RoleId[] {
  return rng.shuffle(lineup(settings));
}
