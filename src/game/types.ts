import type { RoleId } from "./roles";

// The game's state and event log (DESIGN.md §1, §3). The engine is pure: it takes a state and a
// time and returns the next state and the new events. The room service stores both.

export type SeatId = string;

export const phases = ["reveal", "night", "dawn", "day", "vote", "verdict", "ended"] as const;
export type Phase = (typeof phases)[number];

export type Settings = {
  /** Total seats, humans plus AI, 5–12. */
  seats: number;
  boss: boolean;
  influencer: boolean;
  pace: "quick" | "normal";
};

export type Seat = {
  id: SeatId;
  name: string;
  kind: "human" | "ai";
  role: RoleId;
  alive: boolean;
  /** Round and cause when they went out. */
  out: { round: number; cause: "night" | "vote" } | null;
};

export type Winner = { team: "block" | "crew"; reason: string };

export type GameState = {
  seed: string;
  settings: Settings;
  seats: Seat[];
  phase: Phase;
  /** 1 on the first night; goes up at each nightfall. */
  round: number;
  /** When the current phase ends, in ms since the epoch. */
  endsAt: number;
  night: {
    /** Each crew member's choice of target, or null for "nobody yet". */
    crewVotes: Record<SeatId, SeatId>;
    protect: SeatId | null;
    check: SeatId | null;
  };
  /** Who the Medic protected last night: they can't protect them again tonight. */
  lastProtected: SeatId | null;
  /** Day: who each living seat is pointing at. */
  pointers: Record<SeatId, SeatId>;
  /** Vote: each living seat's vote. */
  votes: Record<SeatId, SeatId | "skip">;
  winner: Winner | null;
  /** Seats whose Influencer got voted out (they win personally). */
  viral: SeatId[];
  /** Next event sequence number. */
  seq: number;
};

/** Who may see an event. Dead seats and finished games see everything. */
export type Visibility = { to: "all" } | { to: "crew" } | { to: "seat"; seat: SeatId } | { to: "dead" };

export const eventKinds = [
  "game-start",
  "role",
  "crew-roster",
  "phase",
  "crew-vote",
  "crew-chat",
  "protect",
  "protect-held",
  "check-result",
  "night-out",
  "quiet-night",
  "narration",
  "chat",
  "point",
  "vote",
  "voted-out",
  "no-verdict",
  "viral",
  "ghost-chat",
  "game-end",
] as const;
export type EventKind = (typeof eventKinds)[number];

export type GameEvent = {
  seq: number;
  round: number;
  phase: Phase;
  at: number;
  kind: EventKind;
  actor: SeatId | null;
  target: SeatId | null;
  text: string | null;
  data: Record<string, unknown>;
  visibility: Visibility;
};

/** What a seat asks to do. The engine decides whether it may. */
export type Intent =
  | { type: "crew-vote"; target: SeatId }
  | { type: "crew-chat"; text: string }
  | { type: "protect"; target: SeatId }
  | { type: "check"; target: SeatId }
  | { type: "chat"; text: string }
  | { type: "point"; target: SeatId | null }
  | { type: "vote"; target: SeatId | "skip" }
  | { type: "ghost-chat"; text: string };

export class RuleError extends Error {
  constructor(
    readonly code: "not-now" | "not-allowed" | "bad-target" | "bad-text" | "unknown-seat" | "game-over",
    message: string,
  ) {
    super(message);
    this.name = "RuleError";
  }
}
