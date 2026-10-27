import { isCrew, type RoleId } from "./roles";
import type { GameEvent, GameState, Phase, SeatId, Winner } from "./types";

// What one seat may know (DESIGN.md §1.3). Every client response and every AI prompt is built
// from these two functions, so information can only leak if they're wrong, and they're tested.

/** Whether `seat` may see `event`. Out seats, and everyone once the game is over, see everything. */
export function canSee(event: GameEvent, seatId: SeatId | null, state: GameState): boolean {
  if (state.phase === "ended") return true;
  const v = event.visibility;
  if (v.to === "all") return true;
  const seat = seatId ? state.seats.find((x) => x.id === seatId) : undefined;
  if (!seat) return false;
  if (!seat.alive) return true;
  if (v.to === "seat") return v.seat === seat.id;
  if (v.to === "crew") return isCrew(seat.role);
  return false; // "dead": only out seats
}

export type SeatSummary = {
  id: SeatId;
  name: string;
  kind: "human" | "ai";
  alive: boolean;
  /** Known to this viewer: their own, the crew's to the crew, anyone out, or everyone at the end. */
  role: RoleId | null;
  out: { round: number; cause: "night" | "vote" } | null;
};

export type SeatView = {
  phase: Phase;
  round: number;
  endsAt: number;
  winner: Winner | null;
  viral: SeatId[];
  seats: SeatSummary[];
  /** Day: who is pointing at whom (public). */
  pointers: Record<SeatId, SeatId>;
  /** Vote: the votes so far (public). */
  votes: Record<SeatId, SeatId | "skip">;
  me: {
    id: SeatId;
    role: RoleId;
    alive: boolean;
    /** The crew's ids, for crew members. */
    crew: SeatId[];
    /** Tonight's choices this seat can see: the crew's votes (crew), its protect or check. */
    night: { crewVotes: Record<SeatId, SeatId> | null; protect: SeatId | null; check: SeatId | null };
    /** Medic: who they can't protect tonight. */
    lastProtected: SeatId | null;
    /** Undercover: every result so far. */
    checks: { round: number; target: SeatId; result: "crew" | "clear" }[];
  } | null;
};

export function viewFor(state: GameState, events: GameEvent[], seatId: SeatId | null): { view: SeatView; events: GameEvent[] } {
  const me = seatId ? state.seats.find((x) => x.id === seatId) ?? null : null;
  const seesAll = state.phase === "ended" || (me !== null && !me.alive);
  const meCrew = me !== null && isCrew(me.role);
  const visible = events.filter((e) => canSee(e, seatId, state));

  const seats: SeatSummary[] = state.seats.map((x) => ({
    id: x.id,
    name: x.name,
    kind: x.kind,
    alive: x.alive,
    role: seesAll || !x.alive || x.id === seatId || (meCrew && isCrew(x.role)) ? x.role : null,
    out: x.out,
  }));

  const view: SeatView = {
    phase: state.phase,
    round: state.round,
    endsAt: state.endsAt,
    winner: state.winner,
    viral: state.viral,
    seats,
    pointers: state.phase === "day" ? state.pointers : {},
    votes: state.phase === "vote" ? state.votes : {},
    me: me
      ? {
          id: me.id,
          role: me.role,
          alive: me.alive,
          crew: meCrew || seesAll ? state.seats.filter((x) => isCrew(x.role)).map((x) => x.id) : [],
          night: {
            crewVotes: meCrew || seesAll ? state.night.crewVotes : null,
            protect: me.role === "medic" || seesAll ? state.night.protect : null,
            check: me.role === "undercover" || seesAll ? state.night.check : null,
          },
          lastProtected: me.role === "medic" || seesAll ? state.lastProtected : null,
          checks: visible
            .filter((e) => e.kind === "check-result" && e.actor === me.id)
            .map((e) => ({ round: e.round, target: e.target!, result: e.data.result as "crew" | "clear" })),
        }
      : null,
  };
  return { view, events: visible };
}
