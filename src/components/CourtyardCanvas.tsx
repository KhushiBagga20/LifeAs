"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SeatId } from "@/game/types";
import type { Courtyard, CourtyardState } from "@/world/courtyard";

export type Bubble = { key: string | number; seat: SeatId; text: string; tone?: "chat" | "crew" | "ghost" };

/**
 * The 3D courtyard as a React component. three.js loads only when this mounts, and anything
 * that can't draw WebGL gets `fallback` instead. The screens keep all the controls in HTML;
 * clicking someone in the scene is a shortcut.
 */
export function CourtyardCanvas({
  state,
  bubbles = [],
  onSelect,
  paused = false,
  fallback,
  className = "",
}: {
  state: CourtyardState | null;
  bubbles?: Bubble[];
  onSelect?: (seat: SeatId) => void;
  paused?: boolean;
  fallback: ReactNode;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const yard = useRef<Courtyard | null>(null);
  const latest = useRef(state);
  const select = useRef(onSelect);
  const said = useRef(new Set<string | number>());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    select.current = onSelect;
    latest.current = state;
  });

  useEffect(() => {
    let gone = false;
    import("@/world/courtyard").then(
      ({ createCourtyard }) => {
        if (gone || !host.current) return;
        try {
          const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          yard.current = createCourtyard(host.current, { onSelect: (seat) => select.current?.(seat), reducedMotion });
          if (latest.current) yard.current.update(latest.current);
          setReady(true);
        } catch (error) {
          console.warn("The 3D courtyard couldn't start:", error);
          setFailed(true);
        }
      },
      () => setFailed(true),
    );
    return () => {
      gone = true;
      yard.current?.dispose();
      yard.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && state) yard.current?.update(state);
  }, [ready, state]);

  useEffect(() => {
    if (!ready) return;
    for (const b of bubbles) {
      if (said.current.has(b.key)) continue;
      said.current.add(b.key);
      yard.current?.say(b.seat, b.text, b.tone);
    }
  }, [ready, bubbles]);

  useEffect(() => {
    if (ready) yard.current?.pause(paused);
  }, [ready, paused]);

  if (failed) return <div className={className}>{fallback}</div>;
  return <div ref={host} className={className} data-ready={ready ? "true" : "false"} />;
}
