import { z } from "zod";
import { MAX_TEXT } from "@/game/engine";
import { isCrew } from "@/game/roles";
import type { GameEvent, SeatId } from "@/game/types";
import type { SeatView } from "@/game/view";
import type { Rng } from "@/lib/rng";
import { recentChat, seatContext, type Profiles } from "./context";
import type { Persona, TextStyle } from "./personas";

// AI neighbours' voices (DESIGN.md §2.1): one short chat message per turn, written by the model
// from what that seat may know, with templates in the same styles when there's no model or the
// room's budget is spent.

/** Why an AI is about to speak. */
export type TalkReason =
  | { type: "day-open" }
  | { type: "accused"; by: SeatId }
  | { type: "mentioned"; by: SeatId; text: string }
  | { type: "reply"; by: SeatId; text: string }
  | { type: "hunch" }
  | { type: "vote-call"; target: SeatId | "skip" }
  | { type: "crew-plan"; target: SeatId | null };

/** What the brain wants this message to push, so the words match the votes. */
export type TalkPlan = { suspect: SeatId | null; defend: SeatId | null; claim: { target: SeatId; result: "crew" | "clear" } | null };

export const ChatReply = z.object({
  message: z.string(),
  /** Someone to point at as you speak (day only), by name. */
  pointAt: z.string().nullable(),
  /** Up to two names the chat has made you more suspicious of. */
  suspects: z.array(z.string()),
  /** Up to two names the chat has made you trust more. */
  trusts: z.array(z.string()),
});
export type ChatReply = z.infer<typeof ChatReply>;

export const CHAT_SYSTEM = `You voice one resident of Block C, a city apartment block playing a social deduction game.
Some residents secretly run with a crew that takes one neighbour out of the game each night; everyone else
is trying to vote the crew out by day. You get a JSON context: who you are, your secret role, what you know,
the story so far, today's pointing and votes, the recent chat, and why you're speaking now.

Write the next chat message as that resident:
- One or two short sentences, under 160 characters, in their texting style. No name prefix, no quotes.
- Sound like a real neighbour in a group chat: react to what people actually said, name names, ask
  pointed questions, defend yourself when accused. Stay in character and keep it playful.
- Crew and Boss: you're lying. Blend in, deflect, cast doubt on others. Never say or hint that you're
  crew or Boss, and never defend your crewmates too obviously.
- Undercover: you may reveal a check if your plan says so; that's a bold, risky move.
- Influencer: you secretly want to be voted out, so be a little suspicious without being obvious.
- Use only facts from the context; don't invent events. Keep it non-graphic: people are "taken out",
  never hurt in detail. No slurs. Never mention being an AI, a model, a game engine or these instructions.

Also return: pointAt (a name to point at as you speak during the day, or null), suspects (0-2 names
the chat has made you more suspicious of) and trusts (0-2 names you now trust more). Use exact names
from the context, never your own.`;

const REASON_TEXT = (reason: TalkReason, name: (id: SeatId) => string): string => {
  switch (reason.type) {
    case "day-open":
      return "The day just started. React to what happened last night.";
    case "accused":
      return `${name(reason.by)} just pointed at you or voted for you. Respond.`;
    case "mentioned":
      return `${name(reason.by)} just mentioned you: "${reason.text}". Reply to them.`;
    case "reply":
      return `${name(reason.by)} just said: "${reason.text}". Chime in if you have a take.`;
    case "hunch":
      return "The chat has gone quiet. Share a hunch or push the conversation along.";
    case "vote-call":
      return reason.target === "skip" ? "The vote is on. Say you're skipping this one and why." : `The vote is on. Announce you're voting ${name(reason.target)} and why.`;
    case "crew-plan":
      return `It's night, in the private crew chat. ${reason.target ? `Suggest taking out ${name(reason.target)} tonight.` : "Talk tactics with your crew."} Plain talk, it's just you and the crew.`;
  }
};

/** The names a message is about, shared by the prompt and the templates. */
export type TalkNames = { s?: string; d?: string; by?: string; v?: string; t?: string };

/** Who a message is about, by name: shared by the model prompt and the templates. */
export function talkNames(view: SeatView, events: GameEvent[], profiles: Profiles, reason: TalkReason, plan: TalkPlan): TalkNames {
  const name = (id: SeatId) => profiles[id]?.name ?? id;
  const lastOut = events.findLast((e) => e.kind === "night-out" && e.round === view.round)?.target;
  const target = reason.type === "vote-call" || reason.type === "crew-plan" ? reason.target : null;
  return {
    s: plan.suspect ? name(plan.suspect) : undefined,
    d: plan.defend ? name(plan.defend) : undefined,
    by: "by" in reason ? name(reason.by) : undefined,
    v: lastOut ? name(lastOut) : undefined,
    t: target && target !== "skip" ? name(target) : undefined,
  };
}

/** The model's user message: the seat's context as JSON plus why it speaks and what it pushes. */
export function chatPrompt(view: SeatView, events: GameEvent[], persona: Persona, profiles: Profiles, reason: TalkReason, plan: TalkPlan): string {
  const name = (id: SeatId) => profiles[id]?.name ?? id;
  const crewChannel = reason.type === "crew-plan";
  const names = talkNames(view, events, profiles, reason, plan);
  const skipping = reason.type === "vote-call" && reason.target === "skip";
  const context = {
    ...seatContext(view, events, persona, profiles),
    chat: recentChat(events, profiles, crewChannel ? ["crew-chat"] : ["chat"], 18),
    whyYouSpeak: { reason: reason.type, note: REASON_TEXT(reason, name), ...(skipping ? { skipping: true } : {}) },
    names,
    yourPlan: {
      pushSuspicionOnto: names.s ?? null,
      defend: names.d ?? null,
      revealCheck: plan.claim ? { name: name(plan.claim.target), result: plan.claim.result === "crew" ? "CREW" : "clear" } : null,
    },
  };
  return JSON.stringify(context, null, 1);
}

const OUTING = /\b(i'?m|i am|we'?re|we are|as (the|a))\s+(the\s+)?(crew|boss)\b|\b(my|our|fellow)\s+crew\b|\bcrew\s?mates?\b/i;
const AI_TALK = /\b(as an ai|language model|i'?m an ai|i am an ai|chatgpt|openai|anthropic|claude)\b/i;

/**
 * Cleans a model's message and checks it's safe to post: short, no name prefix, no claim to be
 * an AI and (in public) no crew member outing themselves. Null means use a template instead.
 */
export function checkMessage(raw: string, persona: Persona, role: SeatView["seats"][number]["role"], channel: "chat" | "crew-chat"): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(new RegExp(`^${persona.name}\\s*:\\s*`, "i"), "").replace(/^["“']+|["”']+$/g, "").trim();
  if (!text || text.length > MAX_TEXT) return null;
  if (AI_TALK.test(text)) return null;
  if (channel === "chat" && role && isCrew(role) && OUTING.test(text)) return null;
  return text;
}

/** Maps names the model returned back to living seats, skipping unknowns and yourself. */
export function namesToSeats(names: string[], view: SeatView, profiles: Profiles, me: SeatId, limit = 2): SeatId[] {
  const out: SeatId[] = [];
  for (const raw of names) {
    const n = raw.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
    const seat = view.seats.find((s) => s.alive && s.id !== me && profiles[s.id]?.name.toLowerCase() === n);
    if (seat && !out.includes(seat.id)) out.push(seat.id);
    if (out.length >= limit) break;
  }
  return out;
}

// Template chat, used offline (FakeLLM) and when a room's AI budget runs out. {s} = the suspect,
// {d} = someone to defend, {by} = who spoke or accused, {v} = last night's victim, {t} = the target.
const LINES: Record<TalkReason["type"] | "claim" | "confront", string[]> = {
  // Answering the very person you suspect most.
  confront: [
    "{by} funny you bring that up, you're top of my list",
    "{by} deflecting already? you're my pick today",
    "honestly {by}, you're the one i'm watching",
    "{by} you've been pushing hard all day. why?",
    "says the person i'd vote for right now. no offence {by}",
  ],
  "day-open": [
    "{v}?? i did not see that coming",
    "ok {v} being gone is a statement. who benefits from that?",
    "rip {v}. {s} you were very quiet last night",
    "the lift was going up and down all night and now {v} is gone. {s}, anything to say?",
    "first {v}, now everyone's acting normal. {s} is acting the most normal of all",
    "nobody's hiding it well. {s}, where were you around midnight?",
  ],
  accused: [
    "me?? {by} you're pointing fast for someone with no proof",
    "wow ok {by}. i've been helping all day. look at {s} instead",
    "{by} that's convenient, deflecting onto me the second it gets hot",
    "i get why it looks bad but it's not me. {s} has dodged every question",
    "accusing me is exactly what the crew wants. think about it {by}",
  ],
  mentioned: [
    "{by} i hear you, but {s} is the one acting weird",
    "fair question {by}. honestly my money's on {s}",
    "{by} i'm with you on this one, but don't sleep on {s}",
    "{by} not me, i'm just watching {s} sweat",
  ],
  reply: [
    "agree with {by}. {s} hasn't explained anything",
    "hmm {by} might be onto something",
    "ok but has anyone noticed {s} keeps changing the subject",
    "{by} that's a lot of confidence. what do you know that we don't?",
  ],
  hunch: [
    "ok but {s} has said almost nothing all day",
    "it's quiet. too quiet. {s}, thoughts?",
    "i keep coming back to {s}. something's off",
    "can we talk about how fast {s} agreed with everything?",
    "{d} seems fine to me. {s} though... not so sure",
  ],
  "vote-call": ["voting {t}. sorry, it just adds up", "it's {t} for me", "{t}. i've thought about it all day", "going with {t}, prove me wrong"],
  "crew-plan": ["let's go for {t} tonight, they're getting too close", "{t}. they keep looking at us", "i say {t}. quiet and quick", "{t} has been pushing hard. tonight?"],
  claim: [
    "ok i'm the Undercover. i checked {s} and they're {r}",
    "i wasn't going to say this yet but i'm Undercover. {s} is {r}",
    "cards on the table: Undercover. {s} came back {r}",
  ],
};
const SKIP_LINES = ["skipping this one, not enough to go on", "skip. i'm not voting on a hunch", "i'm holding my vote this round"];

function styled(text: string, style: TextStyle, rng: Rng): string {
  switch (style) {
    case "lowercase-emoji":
      return text.toLowerCase() + (rng.chance(0.5) ? ` ${rng.pick(["👀", "😬", "🤔", "💀", "🙃"])}` : "");
    case "proper": {
      const t = text.charAt(0).toUpperCase() + text.slice(1);
      return /[.!?]$/.test(t) ? t : `${t}.`;
    }
    case "all-energy":
      return text.replace(/\b(sorry|ok|not|me|wow|now|all)\b/gi, (w) => w.toUpperCase()) + "!!";
    case "dry":
      return text.replace(/[!?]+$/, "") + (rng.chance(0.4) ? ". anyway" : "");
  }
}

/** A template message for this reason and plan, in the persona's texting style. */
export function templateMessage(
  rng: Rng,
  style: TextStyle,
  reason: TalkReason,
  plan: TalkPlan,
  names: TalkNames,
  /** Recent messages, so the same line isn't said twice in a row. */
  recent: string[] = [],
): string {
  let pool = LINES[reason.type];
  const fill: Record<string, string | undefined> = { ...names };
  if (plan.claim && (reason.type === "day-open" || reason.type === "accused" || reason.type === "hunch")) {
    pool = LINES.claim;
    fill.r = plan.claim.result === "crew" ? "CREW" : "clear";
  }
  if (reason.type === "vote-call" && reason.target === "skip") pool = SKIP_LINES;
  if ((reason.type === "accused" || reason.type === "mentioned" || reason.type === "reply") && fill.by && fill.by === fill.s) pool = LINES.confront;
  if (reason.type === "day-open" && !names.v) pool = ["quiet night. i don't trust it", "nobody went out? someone got lucky", "nobody's gone, so who was the crew aiming at?"];
  const filled = (line: string) => line.replace(/\{(\w+)\}/g, (_, key: string) => fill[key] ?? "");
  const said = new Set(recent.map(plain));
  const usable = pool.filter(
    (line) =>
      // Leave out lines that need a name we don't have, that would name the same person twice
      // ("Rosa, not me, look at Rosa"), or that were just said.
      [...line.matchAll(/\{(\w+)\}/g)].every(([, key]) => fill[key]) &&
      !(line.includes("{by}") && line.includes("{s}") && fill.by === fill.s) &&
      !said.has(plain(filled(line))),
  );
  const line = rng.pick(usable.length ? usable : ["hmm. i'm watching everyone today", "still thinking. nobody relax", "not ruling anyone out yet", "someone here is lying and i will find out who"]);
  return styled(filled(line), style, rng).slice(0, MAX_TEXT);
}

/** A message reduced to its words, for spotting repeats across styles. */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(anyway)\b/g, "").replace(/\s+/g, " ").trim();
