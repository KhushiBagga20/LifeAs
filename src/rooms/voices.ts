import { talkPlan } from "@/ai/brain";
import type { Profiles } from "@/ai/context";
import { narrationFacts, narratorPrompt, templateNarration } from "@/ai/narrator";
import type { Persona } from "@/ai/personas";
import { chatPrompt, namesToSeats, talkNames, templateMessage, type TalkPlan, type TalkReason } from "@/ai/talk";
import { act, narrate } from "@/game/engine";
import { isCrew, type RoleId } from "@/game/roles";
import { RuleError, type GameEvent, type GameState, type Intent, type SeatId } from "@/game/types";
import { viewFor } from "@/game/view";
import { createRng } from "@/lib/rng";
import type { Meta, TalkJob } from "./meta";
import { aiIntent, catchUp, opinionsFor, react, talkBudget } from "./timeline";

// Choosing who speaks and applying what they said (DESIGN.md §2): pure, so the server's talk
// runner and the browser's demo game share it. The words come from elsewhere (the model, or
// the templates written here as the fallback).

const CLAIM_MS = 25_000;
const AI_GAP_MS = 2_000;
const COOLDOWN_MS = 6_000;
const STALE_NARRATION_MS = 30_000;
/** How much each personality believes an Undercover who reveals a check. */
const BELIEF: Record<Persona["trait"], number> = { logical: 1, chill: 0.9, chatty: 0.8, quiet: 0.8, dramatic: 0.7, suspicious: 0.5 };

type ChatJob = TalkJob & { kind: "chat" | "crew-chat" };
type NarrateJob = TalkJob & { kind: "narrate" };
export type Work =
  | { job: NarrateJob; prompt: string; fallback: string }
  | { job: ChatJob; seat: SeatId; persona: Persona; role: RoleId; reason: TalkReason; plan: TalkPlan; prompt: string; fallback: string };
export type Written = { message: string; pointAt: string | null; suspects: string[]; trusts: string[] };

const isReactive = (r: TalkReason) => r.type !== "hunch" && r.type !== "reply";

/** Whose turn it is to talk: the AI who has spoken least recently and isn't mid-message. */
function nextSpeaker(state: GameState, meta: Meta, now: number, busy: Set<SeatId>, salt: string): SeatId | null {
  const rng = createRng(salt);
  const ready = state.seats.filter((x) => x.alive && meta.personas[x.id] && !busy.has(x.id) && now - (meta.spokeAt[x.id] ?? 0) >= COOLDOWN_MS);
  if (!ready.length) return null;
  const quietest = Math.min(...ready.map((x) => meta.spokeAt[x.id] ?? 0));
  return rng.pick(ready.filter((x) => (meta.spokeAt[x.id] ?? 0) === quietest)).id;
}

/** Picks the due narration and at most one AI line, claims them, and writes their prompts. */
export function pickWork(state: GameState, meta: Meta, log: GameEvent[], profiles: Profiles, now: number): { meta: Meta; work: Work[] } {
  const work: Work[] = [];
  const free = (t: TalkJob) => t.dueAt <= now && (t.claimedAt === null || now - t.claimedAt > CLAIM_MS);
  let talks = [...meta.talks];
  const update = (id: string, patch: Partial<TalkJob>) => (talks = talks.map((t) => (t.id === id ? ({ ...t, ...patch } as TalkJob) : t)));
  const drop = (id: string) => (talks = talks.filter((t) => t.id !== id));

  for (const t of meta.talks.filter((x): x is NarrateJob => x.kind === "narrate" && free(x))) {
    if (now - t.dueAt > STALE_NARRATION_MS) {
      drop(t.id);
      continue;
    }
    // The narrator sees what a spectator sees: nothing hidden.
    const spectator = viewFor(state, log, null);
    const facts = narrationFacts(spectator.view, spectator.events, profiles, t.moment);
    work.push({ job: t, prompt: narratorPrompt(facts), fallback: templateNarration(createRng(`${state.seed}/${t.id}/narrate`), facts) });
    update(t.id, { claimedAt: now });
  }

  const inFlight = meta.talks.filter((t) => t.kind !== "narrate" && t.claimedAt !== null && now - t.claimedAt <= CLAIM_MS);
  const lastAi = Math.max(0, ...Object.values(meta.spokeAt));
  if (now - lastAi >= AI_GAP_MS && inFlight.length < 2) {
    const busy = new Set(inFlight.map((t) => t.seat!));
    const due = meta.talks.filter((x): x is ChatJob => x.kind !== "narrate" && free(x)).sort((a, b) => a.dueAt - b.dueAt);
    const key = `${state.round}/${state.phase}`;
    const aiAlive = state.seats.filter((x) => x.alive && meta.personas[x.id]).length;
    for (const t of due) {
      if (t.phase !== state.phase || t.round !== state.round) {
        drop(t.id);
        continue;
      }
      if ((meta.talked[key] ?? 0) >= talkBudget(state.phase, aiAlive) + (isReactive(t.reason) ? 3 : 0)) {
        drop(t.id);
        continue;
      }
      const seat = t.seat ?? nextSpeaker(state, meta, now, busy, `${state.seed}/${t.id}/speaker`);
      if (!seat) {
        update(t.id, { dueAt: now + 3_000 });
        continue;
      }
      if (busy.has(seat)) continue;
      const since = now - (meta.spokeAt[seat] ?? 0);
      if (since < COOLDOWN_MS) {
        update(t.id, { dueAt: now + COOLDOWN_MS - since });
        continue;
      }
      const persona = meta.personas[seat];
      const me = state.seats.find((x) => x.id === seat && x.alive);
      if (!persona || !me) {
        drop(t.id);
        continue;
      }
      // Words match deeds: a vote call names the vote this AI casts, a crew plan its target.
      let reason = t.reason;
      if (reason.type === "vote-call") {
        const cast = state.votes[seat] ?? (aiIntent({ seat, kind: "vote" }, state, log, meta) as Extract<Intent, { type: "vote" }> | null)?.target;
        if (!cast) {
          drop(t.id);
          continue;
        }
        reason = { type: "vote-call", target: cast };
      }
      if (reason.type === "crew-plan") {
        const pick = state.night.crewVotes[seat] ?? (aiIntent({ seat, kind: "night" }, state, log, meta) as Extract<Intent, { type: "crew-vote" }> | null)?.target ?? null;
        reason = { type: "crew-plan", target: pick };
      }
      const { view, events } = viewFor(state, log, seat);
      const plan = talkPlan(view, events, persona, t.id, opinionsFor(state, meta, seat), { canClaim: !meta.claimed[seat] });
      const rng = createRng(`${state.seed}/${t.id}/template`);
      work.push({
        job: t,
        seat,
        persona,
        role: me.role,
        reason,
        plan,
        prompt: chatPrompt(view, events, persona, profiles, reason, plan),
        fallback: templateMessage(
          rng,
          persona.style,
          reason,
          plan,
          talkNames(view, events, profiles, reason, plan),
          events.filter((e) => e.kind === "chat" || e.kind === "crew-chat").slice(-12).map((e) => e.text ?? ""),
        ),
      });
      update(t.id, { claimedAt: now, seat });
      break;
    }
  }
  return { meta: { ...meta, talks }, work };
}

const clamp = (v: number) => Math.max(-1.5, Math.min(1.5, v));

export function profilesFor(seats: { id: SeatId; name: string }[], meta: Meta): Profiles {
  return Object.fromEntries(seats.map((s) => [s.id, { name: s.name, flat: meta.personas[s.id]?.flat ?? null }]));
}

/**
 * Posts what was written, if its moment hasn't passed, and lets the chat sway the AI: a vote
 * call casts that vote, a crew plan that pick, a point goes with the words, and an Undercover
 * who reveals a check sways the block. Then the game catches up (a vote can end the phase).
 */
export function applyWritten(state: GameState, meta: Meta, log: GameEvent[], profiles: Profiles, work: Work[], written: Written[], now: number) {
  let s = state;
  let m = meta;
  const fresh: GameEvent[] = [];
  const apply = (step: { state: GameState; events: GameEvent[] }) => {
    s = step.state;
    fresh.push(...step.events);
    m = react(s, m, step.events);
  };
  let posted = 0;

  work.forEach((w, i) => {
    const job = m.talks.find((t) => t.id === w.job.id);
    m = { ...m, talks: m.talks.filter((t) => t.id !== w.job.id) };
    if (!job) return; // dropped meanwhile: the phase moved on
    const out = written[i];
    if (w.job.kind === "narrate") {
      apply(narrate(s, out.message, now));
      posted++;
      return;
    }
    if (!("seat" in w) || s.phase !== job.phase || s.round !== job.round) return;
    const me = s.seats.find((x) => x.id === w.seat);
    if (!me?.alive) return;
    const persona = m.personas[w.seat];
    try {
      // Cast the vote or the crew pick the message announces, if it isn't in yet.
      if (w.reason.type === "vote-call" && !(w.seat in s.votes)) {
        apply(act(s, w.seat, { type: "vote", target: w.reason.target }, now));
        m = { ...m, plans: m.plans.filter((p) => !(p.seat === w.seat && p.kind === "vote")) };
      }
      if (w.reason.type === "crew-plan" && w.reason.target && !s.night.crewVotes[w.seat]) {
        apply(act(s, w.seat, { type: "crew-vote", target: w.reason.target }, now));
        m = { ...m, plans: m.plans.filter((p) => !(p.seat === w.seat && p.kind === "night")) };
      }
      apply(act(s, w.seat, { type: w.job.kind, text: out.message }, now));
    } catch (error) {
      if (error instanceof RuleError) return;
      throw error;
    }
    posted++;
    const key = `${s.round}/${s.phase}`;
    m = { ...m, spokeAt: { ...m.spokeAt, [w.seat]: now }, talked: { ...m.talked, [key]: (m.talked[key] ?? 0) + 1 } };

    const { view } = viewFor(s, [], w.seat);
    const crew = isCrew(me.role);
    // Point as you speak, if the model chose someone (never a crewmate).
    const pointAt = out.pointAt ? namesToSeats([out.pointAt], view, profiles, w.seat, 1)[0] : undefined;
    if (s.phase === "day" && pointAt && !(crew && view.me!.crew.includes(pointAt))) {
      try {
        apply(act(s, w.seat, { type: "point", target: pointAt }, now));
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
      }
    }
    // What the chat persuaded this neighbour of (the crew already knows the truth).
    if (!crew) {
      const mine = { ...(m.opinions[w.seat] ?? {}) };
      for (const id of namesToSeats(out.suspects, view, profiles, w.seat)) mine[id] = clamp((mine[id] ?? 0) + 0.25);
      for (const id of namesToSeats(out.trusts, view, profiles, w.seat)) mine[id] = clamp((mine[id] ?? 0) - 0.2);
      m = { ...m, opinions: { ...m.opinions, [w.seat]: mine } };
    }
    // An Undercover who goes public sways the block, and paints a target on their own back.
    if (w.plan.claim && /undercover/i.test(out.message) && persona) {
      const { target, result } = w.plan.claim;
      const opinions = { ...m.opinions };
      for (const x of s.seats) {
        const p = m.personas[x.id];
        if (!x.alive || x.id === w.seat || !p || isCrew(x.role)) continue;
        const theirs = { ...(opinions[x.id] ?? {}) };
        theirs[target] = clamp((theirs[target] ?? 0) + (result === "crew" ? 0.8 : -0.5) * BELIEF[p.trait]);
        theirs[w.seat] = clamp((theirs[w.seat] ?? 0) - 0.3);
        opinions[x.id] = theirs;
      }
      m = { ...m, opinions, claimed: { ...m.claimed, [w.seat]: target } };
    }
  });

  // A vote cast with a message can finish the vote early.
  const after = catchUp(s, m, [...log, ...fresh], now);
  return { state: after.state, meta: after.meta, events: [...fresh, ...after.events], posted };
}
