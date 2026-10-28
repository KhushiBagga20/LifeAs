import { roles } from "@/game/roles";
import type { GameEvent, SeatId } from "@/game/types";
import type { SeatView } from "@/game/view";
import type { CourtyardState } from "./courtyard";
import { humanLook, type Look } from "./layout";

// From a seat's view of the game to what the courtyard shows. Only what that view already holds
// reaches the scene, so the 3D can't leak anything the screens wouldn't.

export type SceneProfile = { name: string; flat: string | null; look: Look | null };

/** Who the light falls on: last night's victim at dawn, the vote leader, then the voted out. */
export function spotlightFor(view: SeatView, events: GameEvent[]): SeatId | null {
  const thisRound = events.filter((e) => e.round === view.round);
  if (view.phase === "dawn") return thisRound.findLast((e) => e.kind === "night-out")?.target ?? null;
  if (view.phase === "verdict") return thisRound.findLast((e) => e.kind === "voted-out")?.target ?? null;
  if (view.phase === "vote") {
    const tally = new Map<SeatId, number>();
    for (const t of Object.values(view.votes)) if (t !== "skip") tally.set(t, (tally.get(t) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally].filter(([, n]) => n === top);
    return top > 0 && leaders.length === 1 ? leaders[0][0] : null;
  }
  return null;
}

export function sceneFromView(
  view: SeatView,
  events: GameEvent[],
  profiles: Record<SeatId, SceneProfile>,
  room: string,
  pick: { selectable?: SeatId[] | null; selected?: SeatId | null } = {},
): CourtyardState {
  const me = view.me?.id ?? null;
  return {
    phase: view.phase,
    seats: view.seats.map((s) => ({
      id: s.id,
      name: profiles[s.id]?.name ?? s.name,
      flat: profiles[s.id]?.flat ?? null,
      look: profiles[s.id]?.look ?? humanLook(room, s.id),
      alive: s.alive,
      me: s.id === me,
      role: s.role ? roles[s.role].name : null,
      crewmate: s.id !== me && !!view.me?.crew.includes(s.id) && s.alive,
    })),
    pointers: view.pointers,
    votes: view.votes,
    spotlight: spotlightFor(view, events),
    selectable: pick.selectable ?? null,
    selected: pick.selected ?? null,
  };
}
