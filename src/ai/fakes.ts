import type { FakeProvider } from "@/llm/fake";
import { narrationFacts, templateNarration } from "./narrator";
import type { TextStyle } from "./personas";
import { STYLE_NOTES } from "./context";
import { templateMessage, type ChatReply, type TalkNames, type TalkReason } from "./talk";

// FakeLLM for the game (DESIGN.md §2.3): template chat and narration built from the same JSON
// context the real model gets, so the game plays offline, free and deterministically.

const styleOf = (note: string) => (Object.entries(STYLE_NOTES).find(([, v]) => v === note)?.[0] ?? "proper") as TextStyle;

export function registerAiFakers(provider: FakeProvider): FakeProvider {
  return provider
    .register("ai-chat", (request, rng): ChatReply => {
      const context = JSON.parse(request.messages.at(-1)!.content) as {
        phase: string;
        chat: string[];
        you: { texting: string };
        whyYouSpeak: { reason: TalkReason["type"]; skipping?: boolean };
        names: TalkNames;
        yourPlan: { revealCheck: { name: string; result: "CREW" | "clear" } | null };
      };
      const { reason: type, skipping } = context.whyYouSpeak;
      const reason = (type === "vote-call" ? { type, target: skipping ? "skip" : "t" } : { type }) as TalkReason;
      const check = context.yourPlan.revealCheck;
      const plan = { suspect: null, defend: null, claim: check ? { target: "x", result: check.result === "CREW" ? ("crew" as const) : ("clear" as const) } : null };
      const names = context.names;
      return {
        message: templateMessage(rng, styleOf(context.you.texting), reason, plan, names, context.chat.map((line) => line.replace(/^[^:]*:\s*/, ""))),
        pointAt: context.phase === "day" && names.s && rng.chance(0.5) ? names.s : null,
        suspects: names.s ? [names.s] : [],
        trusts: names.d ? [names.d] : [],
      };
    })
    .register("narrate", (request, rng) => {
      const facts = JSON.parse(request.messages.at(-1)!.content) as ReturnType<typeof narrationFacts>;
      return { text: templateNarration(rng, facts) };
    });
}
