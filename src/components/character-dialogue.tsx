"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CornerDownLeft, MessageCircle, Send, X } from "lucide-react";
import { characters, type AgentId } from "@/world/simulation";
import { conversationPrompts, dialoguePages } from "@/world/dialogue";

type Props = {
  agent: AgentId;
  line: string;
  busy: boolean;
  mode: "connecting" | "ai" | "local";
  onSend(text: string): void;
  onClose(): void;
  onSpeaking(agent: AgentId, speaking: boolean): void;
  direction?: string;
  mood?: string;
  clock?: string;
  choices?: { id: string; label: string; detail: string }[];
  onChoose?(id: string): void;
};
export function CharacterDialogue({ agent, line, busy, mode, onSend, onClose, onSpeaking, direction, mood, clock, choices, onChoose }: Props) {
  const [beat, setBeat] = useState({ line: "", page: 0 });
  const pages = dialoguePages(line);
  const page = beat.line === line ? Math.min(beat.page, pages.length - 1) : 0;
  const pageText = pages[page];
  const lineKey = `${line}::${page}`;
  const lastPage = page === pages.length - 1;
  const [reveal, setReveal] = useState({ line: "", count: 0 });
  const progress = useRef({ line: "", count: 0 });
  const [draft, setDraft] = useState("");
  const [lastReply, setLastReply] = useState("");
  const count = reveal.line === lineKey ? reveal.count : 0;
  const speaking = count < pageText.length && !busy;
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    progress.current = { line: lineKey, count: 0 };
    const timer = setInterval(() => {
      progress.current.count = reduced ? pageText.length : Math.min(pageText.length, progress.current.count + 1);
      setReveal({ ...progress.current });
      if (progress.current.count === pageText.length) clearInterval(timer);
    }, reduced ? 1 : 22);
    return () => clearInterval(timer);
  }, [lineKey, pageText]);
  useEffect(() => {
    onSpeaking(agent, speaking);
    return () => onSpeaking(agent, false);
  }, [agent, speaking, onSpeaking]);
  function send(text: string) {
    if (busy || !text.trim()) return;
    setLastReply(text.trim()); setDraft(""); onSend(text.trim());
  }
  return <section className="character-scene" aria-label={`Conversation with ${characters[agent].name}`}>
    <div className="character-scene-shade" aria-hidden="true" />
    <header className="character-scene-top"><span>FIELDWORK <span>/</span> {clock ?? "DAY ONE"}</span><button onClick={onClose} aria-label="Leave conversation"><X size={18} /><span>Back to studio</span></button></header>
    <div className="character-scene-caption" aria-hidden="true"><span className="character-scene-rule" />{characters[agent].role}{mood && <small>{mood}</small>}</div>
    <div className="character-dialogue-box">
      <div className="character-nameplate"><span className="character-speaking-dot" data-speaking={speaking} style={{ background: characters[agent].color }} /><h2>{characters[agent].name}</h2><span>{busy ? "Thinking…" : speaking ? "Speaking" : "Listening"}</span></div>
      {direction && <p className="character-stage-direction">{direction}</p>}
      <div className="character-line">
        <p className="character-line-full" aria-live="polite" aria-atomic="true">{pageText}</p>
        <p className="character-line-visible" aria-hidden="true">{pageText.slice(0, count)}{speaking && <span className="character-caret" />}</p>
        {speaking && <button className="character-reveal" onClick={() => { progress.current = { line: lineKey, count: pageText.length }; setReveal(progress.current); }}>Show full line <CornerDownLeft size={12} /></button>}
      </div>
      {!lastPage ? <div className="character-beat-navigation"><span>{page + 1} / {pages.length}</span><button disabled={speaking} onClick={() => setBeat({ line, page: page + 1 })}>Continue <ArrowUpRight size={15} /></button></div> : <div className="character-replies">
        {lastReply && <p className="character-your-line"><span>You</span>“{lastReply}”</p>}
        <p className="character-reply-label"><MessageCircle size={12} />{busy ? `${characters[agent].name} is considering your reply…` : "YOUR REPLY"}</p>
        {choices && choices.length > 0 && <div className="character-story-choices">{choices.map(choice => <button key={choice.id} disabled={busy} onClick={() => { setLastReply(choice.label); onChoose?.(choice.id); }}><span>{choice.label}</span><small>{choice.detail}</small><ArrowUpRight size={14} /></button>)}</div>}
        <div className="character-prompt-list">{(!choices?.length ? conversationPrompts[agent] : []).map((prompt, i) => <button key={prompt} disabled={busy} onClick={() => send(prompt)}><span>0{i + 1}</span>{prompt}<ArrowUpRight size={14} /></button>)}</div>
        <form className="character-reply-form" onSubmit={e => { e.preventDefault(); send(draft); }}>
          <label htmlFor="character-reply" className="character-sr-only">Your reply to {characters[agent].name}</label>
          <input id="character-reply" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Or say it in your own words…" maxLength={500} disabled={busy} />
          <button disabled={busy || !draft.trim()} aria-label="Send reply"><Send size={16} /></button>
        </form>
      </div>}
      <footer className="character-dialogue-footer"><span>{mode === "ai" ? "AI character · remembers this conversation" : "Local character dialogue"}</span><span><kbd>esc</kbd> leave</span></footer>
    </div>
  </section>;
}
