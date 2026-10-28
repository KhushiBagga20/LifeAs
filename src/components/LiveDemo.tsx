"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Phase } from "@/game/types";
import type { CourtyardState } from "@/world/courtyard";
import type { DemoGame } from "@/world/demo";
import { sceneFromView } from "@/world/scene-state";
import { Building } from "./Building";
import { CourtyardCanvas, type Bubble } from "./CourtyardCanvas";

// The landing page's live game: eight AI neighbours playing in the browser, sped up a little,
// starting over a few seconds after each game ends.

const SPEED = 1.6;
const RESTART_AFTER_MS = 14_000;
export const PHASE_NAMES: Record<Phase, string> = {
  reveal: "Lights out",
  night: "Night",
  dawn: "Dawn",
  day: "Day",
  vote: "Vote",
  verdict: "Verdict",
  ended: "Game over",
};

type Line = { seq: number; name: string; text: string };

export function LiveDemo() {
  const [scene, setScene] = useState<CourtyardState | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [story, setStory] = useState<string | null>(null);
  const [status, setStatus] = useState<{ phase: Phase; round: number; left: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let gone = false;
    import("@/world/demo").then(({ createDemoGame, demoView }) => {
      if (gone) return;
      let game: DemoGame;
      let gameTime = 0;
      let last = performance.now();
      let endedAt: number | null = null;
      let games = 0;
      const begin = () => {
        game = createDemoGame(`landing-${Date.now()}-${games++}`, 0);
        gameTime = 0;
        endedAt = null;
        setLines([]);
        setBubbles([]);
        setStory(null);
      };
      const tick = () => {
        const now = performance.now();
        const elapsed = now - last;
        last = now;
        if (pausedRef.current) return;
        gameTime += elapsed * SPEED;
        const fresh = game.step(gameTime);
        const { view, events } = demoView(game);
        const said = fresh.filter((e) => e.kind === "chat" && e.actor && e.text);
        if (said.length) {
          setBubbles((b) => [...b.slice(-20), ...said.map((e) => ({ key: `${game.state.seed}/${e.seq}`, seat: e.actor!, text: e.text! }))]);
          setLines((l) => [...l, ...said.map((e) => ({ seq: e.seq, name: game.profiles[e.actor!].name, text: e.text! }))].slice(-3));
        }
        const told = fresh.findLast((e) => e.kind === "narration");
        if (told?.text) setStory(told.text);
        setScene(sceneFromView(view, events, game.profiles, "DEMO"));
        setStatus({ phase: view.phase, round: view.round, left: Math.max(0, Math.ceil((view.endsAt - gameTime) / 1000 / SPEED)) });
        if (view.phase === "ended") {
          endedAt ??= now;
          if (now - endedAt > RESTART_AFTER_MS) begin();
        }
      };
      begin();
      tick();
      timer = setInterval(tick, 250);
    });
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, []);

  const phaseLabel = status ? `${PHASE_NAMES[status.phase]}${status.phase === "ended" || status.phase === "reveal" ? "" : ` ${status.round}`}` : "Starting";

  return (
    <figure className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <CourtyardCanvas
        state={scene}
        bubbles={bubbles}
        paused={paused}
        className="h-[340px] w-full sm:h-[440px]"
        fallback={
          <div className="flex h-full items-center justify-center p-6">
            <Building />
          </div>
        }
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
        <span className="flex items-center gap-2 rounded-full bg-bg/80 px-3 py-1 font-mono text-xs uppercase tracking-wider">
          <span className="h-2 w-2 rounded-full bg-crew" aria-hidden />
          <span>Live next door</span>
          <span className="text-soft">· {phaseLabel}</span>
          {status && status.phase !== "ended" ? <span className="tabular-nums text-soft">{status.left}s</span> : null}
        </span>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg/80 text-text hover:text-amber focus-visible:outline-2 focus-visible:outline-amber"
          aria-label={paused ? "Play the live game" : "Pause the live game"}
        >
          {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
        </button>
      </div>
      <figcaption className="border-t border-line p-4 text-sm sm:p-5">
        <span className="sr-only">A live game between eight AI neighbours, played in your browser. </span>
        <p className="min-h-[2.75rem] font-display text-base leading-snug text-text italic sm:text-lg">{story ?? "The lights go out in Block C…"}</p>
        <ul className="mt-3 space-y-1 text-soft" aria-label="Latest messages">
          {lines.map((l) => (
            <li key={l.seq} className="truncate">
              <span className="font-semibold text-text">{l.name}:</span> {l.text}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
