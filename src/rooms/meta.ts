import type { NarrationMoment } from "@/ai/narrator";
import type { Persona } from "@/ai/personas";
import type { TalkReason } from "@/ai/talk";
import type { Phase, SeatId } from "@/game/types";

// The room's bookkeeping beside the game state: AI plans, talk jobs and what the AI believes.
// Plain data and pure helpers, so the browser can run a game too (the landing page's live demo).

/** A move an AI seat will make at a set time; the intent is worked out when it happens. */
export type Plan = { seat: SeatId; kind: "night" | "vote" | "point"; dueAt: number; phase: Phase; round: number };

/** Something an AI (or the narrator) will say; the words are written when it's due. */
export type TalkJob = {
  id: string;
  /** null: whoever's turn it is, chosen when the job runs. */
  seat: SeatId | null;
  dueAt: number;
  phase: Phase;
  round: number;
  /** When a worker took the job, so two requests never do the same work. */
  claimedAt: number | null;
} & ({ kind: "chat" | "crew-chat"; reason: TalkReason } | { kind: "narrate"; moment: NarrationMoment });

export type Meta = {
  personas: Record<SeatId, Persona>;
  plans: Plan[];
  /** Which phase the plans are for ("round/phase"), so each phase is planned exactly once. */
  planned: string;
  /** Last chat time per human seat, for the rate limit. */
  chatAt: Record<SeatId, number>;
  talks: TalkJob[];
  /** AI messages posted per "round/phase", for the talk budget. */
  talked: Record<string, number>;
  /** When each AI last spoke. */
  spokeAt: Record<SeatId, number>;
  /** What the chat has persuaded each AI of (seat → target → score). */
  opinions: Record<SeatId, Record<SeatId, number>>;
  /** Undercover AIs who revealed themselves, and who they named. */
  claimed: Record<SeatId, SeatId>;
};

export const newMeta = (personas: Meta["personas"] = {}): Meta => ({
  personas,
  plans: [],
  planned: "",
  chatAt: {},
  talks: [],
  talked: {},
  spokeAt: {},
  opinions: {},
  claimed: {},
});

/** Meta as stored, with defaults for fields added after the room was made. */
export const readMeta = (raw: unknown): Meta => ({ ...newMeta(), ...(raw as Partial<Meta>) });

export const seatNumber = (id: SeatId) => Number(id.slice(1));
