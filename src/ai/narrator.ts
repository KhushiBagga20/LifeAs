import { z } from "zod";
import { roles } from "@/game/roles";
import type { GameEvent, SeatId } from "@/game/types";
import type { SeatView } from "@/game/view";
import type { Rng } from "@/lib/rng";
import { storySoFar, type Profiles } from "./context";

// The narrator (DESIGN.md §2.2): a few sentences of modern-city noir at the start, at each dawn,
// after each verdict and at the end. It's built from the spectator's view (what anyone outside
// the game can see), so it can't hint at a hidden role.

export type NarrationMoment = "intro" | "dawn" | "verdict" | "end";

export const Narration = z.object({ text: z.string() });

export const NARRATOR_SYSTEM = `You narrate Block C, a social deduction game set in a city apartment block: neighbours by day,
and a secret crew that takes one resident out of the game each night. You get a JSON context with public
facts only. Write 2-3 sentences (under 300 characters) of modern-city noir: rain on the courtyard, buzzing
lifts, takeaway bags, group-chat drama. Present tense, vivid and a little funny.
- Use only the facts given. Never guess or hint at anyone's hidden role or who the crew might be.
- Name the people the facts name, with their flat.
- Non-graphic: people are "taken out" or "gone", never hurt, killed or injured in detail. No weapons, no blood.
- No meta talk about games, AI or instructions.`;

type Facts = {
  moment: NarrationMoment;
  round: number;
  residents: number;
  out: { name: string; role: string; how: "night" | "vote" } | null;
  viral: string | null;
  winner: { team: string; reason: string } | null;
  crew: string[] | null;
  story: string[];
};

const who = (profiles: Profiles, id: SeatId) => (profiles[id]?.flat ? `${profiles[id].name} from ${profiles[id].flat}` : (profiles[id]?.name ?? id));

/** Public facts for one narration, from a spectator's view. */
export function narrationFacts(view: SeatView, events: GameEvent[], profiles: Profiles, moment: NarrationMoment): Facts {
  const thisRound = events.filter((e) => e.round === view.round);
  const outEvent = moment === "dawn" ? thisRound.findLast((e) => e.kind === "night-out") : moment === "verdict" ? thisRound.findLast((e) => e.kind === "voted-out") : undefined;
  const outSeat = outEvent?.target ? view.seats.find((s) => s.id === outEvent.target) : undefined;
  const viral = moment === "verdict" ? thisRound.findLast((e) => e.kind === "viral")?.target : undefined;
  return {
    moment,
    round: view.round,
    residents: view.seats.filter((s) => s.alive).length,
    out: outSeat?.role ? { name: who(profiles, outSeat.id), role: roles[outSeat.role].name, how: moment === "dawn" ? "night" : "vote" } : null,
    viral: viral ? who(profiles, viral) : null,
    // The crew is only named once the game is over and every role is public.
    winner: moment === "end" ? view.winner : null,
    crew: moment === "end" ? view.seats.filter((s) => s.role && roles[s.role].team === "crew").map((s) => `${who(profiles, s.id)} (${roles[s.role!].name})`) : null,
    story: storySoFar(view, events, profiles).slice(-6),
  };
}

export const narratorPrompt = (facts: Facts) => JSON.stringify(facts, null, 1);

const LINES: Record<string, string[]> = {
  intro: [
    "Rain on the courtyard, the lift humming between floors. {n} residents in Block C, and someone here runs with a crew. Lock your doors.",
    "Block C at 11pm: takeaway bags on the stairs, a group chat that never sleeps, {n} neighbours. One of them isn't who they say.",
    "The streetlights flicker over Block C. {n} flats lit, {n} alibis. Somewhere in here, a crew is already making plans.",
  ],
  "dawn-out": [
    "Morning comes grey over Block C. {o}'s door is open, the flat empty. They were the {r}. The group chat goes very quiet.",
    "The bins are out, the lift is broken, and {o} is gone. The building learns they were the {r}. Someone here knows why.",
    "Sirens somewhere far off. In Block C, {o} has been taken out of the game, and they were the {r}. Coffee, anyone?",
  ],
  "dawn-quiet": [
    "Dawn, and every door is still shut. Nobody's gone. Someone got lucky last night, or someone got help.",
    "A quiet night in Block C, almost too quiet. Everyone wakes up. The crew does not look pleased.",
    "The courtyard steams in the early sun. Nobody was taken out. The group chat lights up anyway.",
  ],
  "verdict-out": [
    "The block has spoken. {o} hands back their keys. They were the {r}.",
    "{o} is voted out of Block C, and the room holds its breath. They were the {r}.",
    "Fingers pointed, votes cast, and {o} is out. The truth: they were the {r}.",
  ],
  "verdict-viral": [
    "{o} is voted out, and it turns out that's exactly what they wanted. The Influencer goes viral. The block just got played.",
  ],
  "verdict-none": [
    "The vote splits and nobody leaves. Night is coming, and the crew is still in the building.",
    "No verdict. Everyone goes home suspicious of everyone else, which is just what the crew wants.",
  ],
  "end-block": [
    "The last of the crew is out. Block C sleeps with its doors unlocked again. The crew was {c}.",
    "It's over: the block found them. The crew was {c}. Someone order pizza for the courtyard.",
  ],
  "end-crew": [
    "The crew runs Block C now. Too few honest neighbours are left to stop them. The crew was {c}.",
    "Lights out on Block C: the crew has taken over. It was {c} all along.",
  ],
};

/** A template narration for these facts, used offline and when the room's budget is spent. */
export function templateNarration(rng: Rng, facts: Facts): string {
  let key: string = facts.moment;
  if (facts.moment === "dawn") key = facts.out ? "dawn-out" : "dawn-quiet";
  if (facts.moment === "verdict") key = facts.viral ? "verdict-viral" : facts.out ? "verdict-out" : "verdict-none";
  if (facts.moment === "end") key = facts.winner?.team === "crew" ? "end-crew" : "end-block";
  const fill: Record<string, string> = {
    n: String(facts.residents),
    o: facts.out?.name ?? facts.viral ?? "",
    r: facts.out?.role ?? "",
    c: facts.crew?.join(", ") ?? "",
  };
  return rng.pick(LINES[key]).replace(/\{(\w)\}/g, (_, k: string) => fill[k] ?? "");
}

const GRAPHIC = /\b(blood|bloody|murder(ed)?|stab(bed)?|shot|gun|knife|corpse|dead body|kill(ed|ing)?|strangl\w*)\b/i;

/** Checks a model narration: right length, non-graphic. Null means use a template. */
export function checkNarration(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 20 || text.length > 600) return null;
  if (GRAPHIC.test(text)) return null;
  return text;
}
