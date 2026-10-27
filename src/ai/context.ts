import { roles } from "@/game/roles";
import type { GameEvent, SeatId } from "@/game/types";
import type { SeatView } from "@/game/view";
import type { Persona } from "./personas";

// What an AI voice (or the narrator) is told about the game. Everything here is built from a
// SeatView and the events that seat may see, so a prompt can never hold more than its seat knows.

export type Profiles = Record<SeatId, { name: string; flat: string | null }>;

const label = (profiles: Profiles, id: SeatId | null | undefined) => {
  if (!id) return "nobody";
  const p = profiles[id];
  return p ? (p.flat ? `${p.name} (${p.flat})` : p.name) : id;
};

/** Public facts so far, as short lines: who went out and how, the votes, the narrator. */
export function storySoFar(view: SeatView, events: GameEvent[], profiles: Profiles): string[] {
  const roleOf = (id: SeatId | null) => view.seats.find((s) => s.id === id)?.role;
  const lines: string[] = [];
  for (const e of events) {
    if (e.kind === "night-out") lines.push(`Night ${e.round}: ${label(profiles, e.target)} was taken out. They were ${roles[roleOf(e.target) ?? "neighbour"].name}.`);
    if (e.kind === "quiet-night") lines.push(`Night ${e.round}: nobody was taken out.`);
    if (e.kind === "voted-out") lines.push(`Day ${e.round}: the block voted out ${label(profiles, e.target)}. They were ${roles[roleOf(e.target) ?? "neighbour"].name}.`);
    if (e.kind === "no-verdict") lines.push(`Day ${e.round}: the vote didn't settle on anyone.`);
    if (e.kind === "viral") lines.push(`${label(profiles, e.target)} was the Influencer and just went viral for being voted out.`);
  }
  return lines;
}

/** The last public (or crew) chat lines, oldest first. */
export function recentChat(events: GameEvent[], profiles: Profiles, kinds: GameEvent["kind"][], limit: number): string[] {
  return events
    .filter((e) => kinds.includes(e.kind) && e.text)
    .slice(-limit)
    .map((e) => `${profiles[e.actor ?? ""]?.name ?? "?"}: ${e.text}`);
}

/** Who is pointing at whom today, and the votes so far (both public). */
export function todaysPressure(view: SeatView, profiles: Profiles) {
  const name = (id: SeatId) => profiles[id]?.name ?? id;
  return {
    pointing: Object.entries(view.pointers).map(([from, to]) => `${name(from)} → ${name(to)}`),
    votes: Object.entries(view.votes).map(([from, to]) => `${name(from)} → ${to === "skip" ? "skip" : name(to)}`),
  };
}

/** Everything one AI neighbour may know, as the JSON its voice is given. */
export function seatContext(view: SeatView, events: GameEvent[], persona: Persona, profiles: Profiles) {
  const me = view.me!;
  const role = roles[me.role];
  const name = (id: SeatId) => profiles[id]?.name ?? id;
  return {
    you: {
      name: persona.name,
      age: persona.age,
      flat: persona.flat,
      job: persona.job,
      role: role.name,
      goal: role.goal,
      team: role.team,
      texting: STYLE_NOTES[persona.style],
      personality: persona.trait,
      quirk: persona.quirk,
      ...(me.crew.length > 1 ? { crewmates: me.crew.filter((id) => id !== me.id).map(name) } : {}),
      ...(me.checks.length ? { yourChecks: me.checks.map((c) => `Night ${c.round}: ${name(c.target)} is ${c.result === "crew" ? "CREW" : "clear"}`) } : {}),
    },
    phase: view.phase,
    round: view.round,
    stillIn: view.seats.filter((s) => s.alive && s.id !== me.id).map((s) => label(profiles, s.id)),
    out: view.seats.filter((s) => !s.alive).map((s) => `${label(profiles, s.id)}: ${roles[s.role!].name}`),
    story: storySoFar(view, events, profiles),
    today: todaysPressure(view, profiles),
  };
}

export const STYLE_NOTES: Record<Persona["style"], string> = {
  "lowercase-emoji": "all lowercase, casual, the odd emoji",
  proper: "full sentences with proper punctuation",
  "all-energy": "excitable, CAPS for emphasis, lots of !!",
  dry: "dry and deadpan, few words",
};
