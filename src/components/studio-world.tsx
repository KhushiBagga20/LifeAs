"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Coffee, Hand, MessageCircle, MoveUpRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { CharacterDialogue } from "@/components/character-dialogue";
import { advanceStory, clockTime, freshStory, handoffOutcome, moodFor, roomCrisis, sceneDirection, storyChoices, storyGreeting, storyResponses, venueForStory, type StoryAction } from "@/world/story";
import { greetingFor } from "@/world/dialogue";
import { agentIds, characters, distance, initialLayout, layoutIssues, phaseGoals, reviewLayout, stations, type AgentId, type LayoutItem, type Phase, type Point, type StationId } from "@/world/simulation";
import type { StudioScene } from "@/world/studio-scene";
import "./studio-world.css";

type Panel = StationId | AgentId | "done" | null;
type Entry = { id: number; who: string; text: string };
const palettes = ["#e9b66c", "#c8d7a9", "#d9b9aa", "#b8cccf"];
export function StudioWorld() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StudioScene | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [story, setStory] = useState(freshStory);
  const [phase, setPhase] = useState<Phase>("arrive");
  const [panel, setPanel] = useState<Panel>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState<Point>({ x: -0.5, z: 1.7 });
  const [layout, setLayout] = useState<LayoutItem[]>(initialLayout);
  const [palette, setPalette] = useState(palettes[0]);
  const [selected, setSelected] = useState<LayoutItem["id"]>("title");
  const [inventory, setInventory] = useState<"brief" | "design" | "proof" | null>(null);
  const [events, setEvents] = useState<Entry[]>([{ id: 0, who: "Fieldwork", text: "You arrived for your first day. The brief is on the project table." }]);
  const [mode, setMode] = useState<"connecting" | "ai" | "local">("connecting");
  const [notice, setNotice] = useState("");
  const [thinking, setThinking] = useState<AgentId | null>(null);
  const [chat, setChat] = useState<Partial<Record<AgentId, string>>>({});
  const [printing, setPrinting] = useState(false);
  const [printReady, setPrintReady] = useState(false);
  const [printedArtifact, setPrintedArtifact] = useState<{ layout: LayoutItem[]; palette: string; venue: string } | null>(null);
  const busy = useRef(false);
  const nextAgent = useRef(0);
  const printTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: LayoutItem["id"]; startX: number; startY: number; x: number; y: number; w: number; h: number } | null>(null);
  const poster = useRef<HTMLDivElement>(null);
  const latest = useRef({ phase, layout, events, panel, paused, story, palette, inventory, printedArtifact, printing });
  useEffect(() => { latest.current = { phase, layout, events, panel, paused, story, palette, inventory, printedArtifact, printing }; }, [phase, layout, events, panel, paused, story, palette, inventory, printedArtifact, printing]);
  const addEvent = useCallback((who: string, text: string) => {
    setEvents(previous => [...previous.slice(-29), { id: Date.now() + Math.random(), who, text }]);
  }, []);
  const interact = useCallback((id: StationId | AgentId) => { setPanel(id); }, []);
  const setSpeaker = useCallback((agent: AgentId, speaking: boolean) => { scene.current?.setSpeaking(agent, speaking); }, []);
  useEffect(() => {
    let disposed = false;
    import("@/world/studio-scene").then(({ createStudio }) => {
      if (disposed || !host.current) return;
      try {
        const runtime = createStudio(host.current, { position: setPosition, interact, ready: () => {} });
        scene.current = runtime;
        // Restore framing and artifact state if hot reload recreates the renderer mid-scene.
        const current = latest.current;
        runtime.setPaused(current.paused);
        runtime.lockInput(current.panel !== null);
        runtime.conversation(current.panel && agentIds.includes(current.panel as AgentId) ? current.panel as AgentId : null);
        runtime.setObjective(phaseGoals[current.phase].station);
        runtime.setCarry(current.inventory);
        runtime.updatePoster(current.layout, current.palette, current.phase, current.panel === "desk" ? venueForStory(current.story) : current.story.draftVenue ?? "LIBRARY FOYER", current.printedArtifact);
        for (const agent of agentIds) runtime.setMood(agent, moodFor(agent, current.story));
        runtime.setPrinterState(current.story.jam, current.printing || current.phase === "deliver" || current.phase === "complete");
        setReady(true);
      } catch {
        setError("This browser could not start the 3D renderer. Enable hardware acceleration or try a browser with WebGL support.");
      }
    }).catch(() => setError("The 3D scene could not load. Reload to try again."));
    return () => { disposed = true; scene.current?.dispose(); scene.current = null; if (printTimer.current) clearTimeout(printTimer.current); };
  }, [interact]);
  useEffect(() => {
    scene.current?.setPaused(paused);
    scene.current?.lockInput(panel !== null);
    scene.current?.conversation(panel && agentIds.includes(panel as AgentId) ? panel as AgentId : null);
    if (panel && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!panel && dialog.current?.open) dialog.current.close();
  }, [paused, panel, ready]);
  useEffect(() => {
    scene.current?.setObjective(phaseGoals[phase].station);
    scene.current?.setCarry(inventory);
    scene.current?.updatePoster(layout, palette, phase, panel === "desk" ? venueForStory(story) : story.draftVenue ?? "LIBRARY FOYER", printedArtifact);
    for (const agent of agentIds) scene.current?.setMood(agent, moodFor(agent, story));
    scene.current?.setPrinterState(story.jam, printing || phase === "deliver" || phase === "complete");
    scene.current?.setPressure(Math.max(0, 1 - (story.deadline - story.minutes) / 40));
  }, [phase, inventory, layout, palette, ready, story, printing, printedArtifact, panel]);
  const decide = useCallback(async (agent: AgentId, message?: string) => {
    if (busy.current) return;
    busy.current = true; setThinking(agent);
    try {
      const current = latest.current;
      const response = await fetch("/api/world/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, message, snapshot: { phase: current.phase, layout: current.layout, story: current.story, activity: current.events.slice(-8).map(e => `${e.who}: ${e.text}`.slice(0, 180)) } }),
      });
      const data = await response.json();
      if (!response.ok) { setNotice(data.error ?? "Character is unavailable. Try again."); return; }
      setMode(data.mode); if (data.notice) setNotice(data.notice);
      if (latest.current.story !== current.story || latest.current.phase !== current.phase) return;
      scene.current?.moveAgent(agent, data.destination);
      scene.current?.speak(agent, data.line);
      setChat(previous => ({ ...previous, [agent]: data.line }));
      addEvent(characters[agent].name, data.line);
    } catch { setNotice("Character service is offline. You can continue using the studio."); }
    finally { busy.current = false; setThinking(null); }
  }, [addEvent]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    fetch("/api/world/agents", { signal: controller.signal }).then(r => r.json()).then(data => setMode(data.mode)).catch(() => { if (!controller.signal.aborted) setMode("local"); });
    // Each character has its own independent decision turn; physical walking stays client-side.
    const timer = setInterval(() => {
      if (document.hidden || latest.current.paused) return;
      const id = agentIds[nextAgent.current++ % agentIds.length];
      if (latest.current.panel !== id) void decide(id);
    }, 18_000);
    const first = setTimeout(() => {
      scene.current?.moveAgent("maya", "desk"); scene.current?.moveAgent("alex", "printer"); scene.current?.moveAgent("sam", "brief");
      scene.current?.speak("sam", "Morning! The library brief is on that table.");
    }, 2500);
    return () => { controller.abort(); clearInterval(timer); clearTimeout(first); };
  }, [ready, decide]);
  const objective = phase === "design" && ["confirmed", "online"].includes(story.request) && story.draftVenue !== venueForStory(story) ? { title: "Update the room", detail: `The brief changed. Update the venue to ${venueForStory(story)} at your workstation.`, station: "desk" as StationId } : phase === "complete" && !handoffOutcome(story).accepted ? { title: story.printIssues?.length ? "The proof needs a correction" : "The room is still wrong", detail: "Talk to Sam, correct the poster and make a new proof.", station: "delivery" as StationId } : phaseGoals[phase];
  const nearby = Object.entries(stations).sort((a, b) => distance(position, a[1]) - distance(position, b[1])).find(([, p]) => distance(position, p) < 1.6);
  function closePanel() { setPanel(null); setTimeout(() => host.current?.querySelector("canvas")?.focus(), 0); }
  function changePhase(next: Phase, text: string) { setPhase(next); addEvent("You", text); }
  function pinDesign() {
    const nextStory = advanceStory(story, "review"); setStory(nextStory);
    changePhase("print", "Pinned the poster on the review wall.");
    if (nextStory.request === "pending" && story.request === "unheard") {
      setNotice("Sam just got a call. The venue has changed. Talk before sending this to print.");
      setChat(previous => ({ ...previous, sam: roomCrisis }));
      scene.current?.moveAgent("sam", "board"); scene.current?.speak("sam", "Wait. Something’s changed at the library.");
      addEvent("Sam", "The library foyer is closed. The poster’s venue needs a decision.");
      setPanel("sam");
    }
    const feedback = reviewLayout(layout).join(" ");
    setChat(previous => ({ ...previous, maya: feedback }));
    addEvent("Maya", feedback); scene.current?.moveAgent("maya", "board"); scene.current?.speak("maya", feedback);
  }
  function print() {
    setPrintedArtifact({ layout: layout.map(item => ({ ...item })), palette, venue: story.draftVenue });
    setStory({ ...advanceStory(story, "print"), printIssues: layoutIssues(layout) });
    setPrinting(true); addEvent("Alex", "Printer is running. Checking the first proof.");
    printTimer.current = setTimeout(() => {
      setPrinting(false); setPrintReady(true); setInventory(null);
      changePhase("deliver", "Printed a proof. It is waiting in the printer tray.");
      scene.current?.speak("alex", "Proof’s in the tray. Pick it up and take it to Sam.");
    }, 2400);
  }
  function reset() {
    if (printTimer.current) clearTimeout(printTimer.current);
    setStory(freshStory()); setPrintedArtifact(null);
    setPhase("arrive"); setInventory(null); setLayout(initialLayout.map(i => ({ ...i }))); setPrintReady(false); setPrinting(false); setPalette(palettes[0]);
    setEvents([{ id: Date.now(), who: "Fieldwork", text: "A fresh day. Pick up the brief from the project table." }]);
    setChat({}); setPanel(null);
  }
  function chooseStory(id: string) {
    if (story.delivered && id === "finish") { closePanel(); return; }
    if (story.delivered && id === "restart") { reset(); return; }
    if (story.delivered && id === "repair" && !handoffOutcome(story).accepted) {
      const roomNeedsFix = !["confirmed", "online"].includes(story.request);
      setStory({ ...story, delivered: false, request: roomNeedsFix ? "pending" : story.request }); setPhase("design"); setInventory("brief"); setPrintReady(false);
      if (roomNeedsFix) setPanel("sam"); else { closePanel(); scene.current?.approach("desk"); }
      return;
    }
    const action = id as StoryAction;
    if (!storyChoices("sam", story).some(choice => choice.id === action)) return;
    const response = storyResponses[action];
    setStory(advanceStory(story, action));
    if (action === "confirm-room" || action === "online-room") { setPhase("design"); setPrintReady(false); setNotice(""); }
    if (response) { setChat(previous => ({ ...previous, [response.agent]: response.line })); addEvent(response.agent === "sam" ? "Sam" : "You", response.line); }
  }
  const outcome = handoffOutcome(story);
  const currentAgent = panel && agentIds.includes(panel as AgentId) ? panel as AgentId : null;
  const activeItem = layout.find(i => i.id === selected)!;
  return <div className={`studio-app ${currentAgent ? "studio-in-conversation" : ""}`}>
    <div ref={host} className="studio-viewport" />
    <div className="studio-vignette" />
    <header className="studio-topbar">
      <Link href="/" className="studio-brand"><ArrowLeft size={16} /><span>Life<em>As</em></span><span className="studio-divider" /> <span className="studio-place">FIELDWORK STUDIO</span></Link>
      <div className="studio-live"><span className={mode === "ai" ? "live-dot ai" : "live-dot"} />{mode === "ai" ? "AI characters live" : mode === "connecting" ? "Connecting characters" : "Local character behaviour"}</div>
      <button className="studio-icon" onClick={() => setPaused(!paused)} aria-label={paused ? "Resume world" : "Pause world"}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
    </header>
    <aside className="studio-mission">
      <p className="studio-eyebrow">DAY 01 <span> / </span> GRAPHIC DESIGNER</p>
      <div className={`studio-clock ${story.deadline - story.minutes <= 12 ? "urgent" : ""}`}><time>{clockTime(story.minutes)}</time><span>Handoff {clockTime(story.deadline)}</span></div>
      <p className="studio-clock-explanation">Work advances the clock. Reading and walking don’t.</p>
      <div className="studio-mission-heading"><h1>{objective.title}</h1><span className="studio-step">{["arrive", "design", "review", "print", "deliver", "complete"].indexOf(phase) + 1}/6</span></div>
      <p>{phase === "deliver" && inventory !== "proof" ? "Your proof is in the printer tray. Pick it up, then bring it to Sam." : objective.detail}</p>
      <button className="studio-locate" onClick={() => scene.current?.approach(phase === "deliver" && inventory !== "proof" ? "printer" : objective.station)}>Walk there <MoveUpRight size={14} /></button>
      {story.request === "pending" && <button className="studio-story-alert" onClick={() => scene.current?.approach("sam")}>Sam needs a word. The venue changed. <ArrowRight size={13} /></button>}
      <div className="studio-progress">{["arrive", "design", "review", "print", "deliver"].map((p, i) => <span key={p} className={i < ["arrive", "design", "review", "print", "deliver", "complete"].indexOf(phase) ? "filled" : ""} />)}</div>
    </aside>
    <aside className="studio-cast" aria-label="People in the studio">
      <p className="studio-eyebrow">IN THE STUDIO</p>
      {agentIds.map(id => <button key={id} aria-label={`Approach ${characters[id].name}, ${characters[id].role}`} onClick={() => scene.current?.approach(id)}><span className="studio-avatar" style={{ background: characters[id].color }}>{characters[id].name[0]}</span><span><strong>{characters[id].name}</strong><small>{thinking === id ? "Thinking…" : moodFor(id, story) === "urgent" ? "Under pressure" : moodFor(id, story) === "concerned" ? "Something’s wrong" : characters[id].role}</small></span><MessageCircle size={15} /></button>)}
      {mode === "local" && <p className="studio-mode-note">No AI key configured. Characters currently follow local rules.</p>}
    </aside>
    <div className="studio-bottom">
      <div className="studio-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span><span><kbd>E</kbd> interact</span><span>Click floor to walk · scroll to zoom</span></div>
      {inventory && <div className="studio-inventory"><Hand size={16} /><span>Carrying <strong>{inventory === "brief" ? "client brief" : inventory === "design" ? "poster draft" : "printed proof"}</strong></span></div>}
    </div>
    {nearby && !panel && ready && <button className="studio-interact" onClick={() => interact(nearby[0] as StationId)}><kbd>E</kbd> {nearby[1].verb}</button>}
    <aside className="studio-feed" aria-label="Workplace activity" aria-live="polite">
      {events.slice(-2).map(e => <p key={e.id}><span>{e.who}</span>{e.text}</p>)}
    </aside>
    {notice && <div className="studio-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={14} /></button></div>}
    {!ready && <div className="studio-loading"><p className="studio-eyebrow">LIFEAS / WORLD 01</p><h2>{error ? "The studio couldn’t open." : "Opening the studio."}</h2><p>{error || "Setting out the desks, warming up the printer…"}</p>{error && <button onClick={() => location.reload()}>Try again</button>}</div>}
    {paused && !panel && <div className="studio-paused"><h2>Take a breath.</h2><p>The studio is paused.</p><button onClick={() => setPaused(false)}><Play size={16} /> Back to work</button></div>}
    <dialog ref={dialog} className={`studio-dialog ${currentAgent ? "studio-dialog-story" : ""} ${panel === "desk" && phase !== "arrive" ? "studio-dialog-editor" : ""}`} onCancel={e => { if (printing) e.preventDefault(); else closePanel(); }} onClick={e => { if (e.target === e.currentTarget && !printing) closePanel(); }}>
      <div className={currentAgent ? "studio-story-content" : "studio-dialog-content"}>
        {!currentAgent && <button className="studio-close" disabled={printing} onClick={closePanel} aria-label="Close interaction"><X size={20} /></button>}
        {currentAgent ? <CharacterDialogue
          key={currentAgent}
          agent={currentAgent}
          line={currentAgent === "sam" && story.delivered ? outcome.spoken : currentAgent === "sam" && story.request === "pending" ? roomCrisis : chat[currentAgent] ?? storyGreeting(currentAgent, phase, story) ?? greetingFor(currentAgent, phase)}
          direction={sceneDirection(currentAgent, story)}
          mood={moodFor(currentAgent, story)}
          clock={`${clockTime(story.minutes)} / HANDOFF ${clockTime(story.deadline)}`}
          choices={storyChoices(currentAgent, story)}
          onChoose={chooseStory}
          busy={thinking !== null}
          mode={mode}
          onSpeaking={setSpeaker}
          onClose={closePanel}
          onSend={text => { if (busy.current) return; addEvent("You", text); void decide(currentAgent, text); }}
        /> : panel === "brief" ? <>
          <p className="studio-eyebrow">PROJECT 001 / CLIENT BRIEF</p><h2>Give broken things<br />another Saturday.</h2>
          <p className="studio-dialog-intro">Central Library is hosting a repair café. Your job: make a poster that someone walking past can understand in seconds.</p>
          <dl className="studio-brief"><div><dt>Event</dt><dd>Repair café</dd></div><div><dt>When</dt><dd>Saturday, 10:00–14:00</dd></div><div><dt>Where</dt><dd>Library foyer, Central Library</dd></div><div><dt>Bring</dt><dd>One broken household item</dd></div><div><dt>Action</dt><dd>Book a free slot at library.example/repair</dd></div></dl>
          <p className="studio-small">Fictional client and booking address. Occupational basis: O*NET graphic-design tasks #300, #304, #305 and #23970.</p>
          <button className="studio-primary" onClick={() => { if (phase === "arrive") { setStory(advanceStory(story, "brief")); setInventory("brief"); changePhase("design", "Collected the repair café brief."); } closePanel(); }}>Take the brief <ArrowRight size={16} /></button>
        </> : panel === "desk" ? <>
          <p className="studio-eyebrow">YOUR WORKSTATION / LAYOUT TOOL</p><h2>Make the poster.</h2>
          {phase === "arrive" ? <><p className="studio-dialog-intro">You haven’t collected the brief yet. Find out what you’re designing before you start.</p><button className="studio-primary" onClick={() => { closePanel(); scene.current?.approach("brief"); }}>Find the brief <ArrowRight size={16} /></button></> : <>
            <p className="studio-small">Drag the text blocks to arrange the page. Click a block to change its size. This is the actual poster you’ll pin up, print and deliver.</p>
            <div className="studio-editor-grid">
              <div ref={poster} className="studio-poster" style={{ background: palette }}>
                <div className="studio-poster-art"><span /><span /><span /></div>
                {layout.map(item => <button key={item.id} className={`studio-poster-block ${selected === item.id ? "selected" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%`, fontSize: `${item.size}px`, maxWidth: `${96 - item.x}%` }}
                  onPointerDown={e => { e.preventDefault(); setSelected(item.id); const rect = poster.current!.getBoundingClientRect(); drag.current = { id: item.id, startX: e.clientX, startY: e.clientY, x: item.x, y: item.y, w: rect.width, h: rect.height }; e.currentTarget.setPointerCapture(e.pointerId); }}
                  onPointerMove={e => { const d = drag.current; if (!d || d.id !== item.id) return; setLayout(previous => previous.map(i => i.id === item.id ? { ...i, x: Math.max(2, Math.min(60, d.x + (e.clientX - d.startX) / d.w * 100)), y: Math.max(3, Math.min(85, d.y + (e.clientY - d.startY) / d.h * 100)) } : i)); }}
                  onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onClick={() => setSelected(item.id)} aria-label={`Move ${item.id} text`}>
                  {item.id === "title" ? <>REPAIR<br />CAFÉ.</> : item.id === "details" ? <>SATURDAY · 10–2<br />{venueForStory(story)}<br /><span className="poster-subline">Bring one broken household item</span></> : <>BOOK A FREE SLOT →<br /><span className="poster-subline">library.example/repair</span></>}
                </button>)}
              </div>
              <div className="studio-inspector">
                <p className="studio-eyebrow">SELECTED / {selected}</p>
                {(["title", "details", "booking"] as const).map(id => <button className={`studio-layer ${selected === id ? "active" : ""}`} key={id} onClick={() => setSelected(id)}>{id === "title" ? "01  Headline" : id === "details" ? "02  Event details" : "03  Booking action"}</button>)}
                <label>Type size <strong>{activeItem.size} pt</strong><input type="range" min={10} max={44} value={activeItem.size} onChange={e => setLayout(previous => previous.map(i => i.id === selected ? { ...i, size: Number(e.target.value) } : i))} /></label>
                <label>Horizontal position<input type="range" min={2} max={60} value={activeItem.x} onChange={e => setLayout(previous => previous.map(i => i.id === selected ? { ...i, x: Number(e.target.value) } : i))} /></label>
                <label>Vertical position<input type="range" min={3} max={85} value={activeItem.y} onChange={e => setLayout(previous => previous.map(i => i.id === selected ? { ...i, y: Number(e.target.value) } : i))} /></label>
                <p className="studio-eyebrow">PAPER COLOUR</p><div className="studio-swatches">{palettes.map(color => <button key={color} style={{ background: color }} aria-label={`Paper colour ${color}`} aria-pressed={palette === color} onClick={() => setPalette(color)}>{palette === color && <Check size={17} />}</button>)}</div>
                <p className="studio-small">Make the event easy to spot, keep details legible, and give the booking action room.</p>
              </div>
            </div>
            <button className="studio-primary" onClick={() => { setStory(advanceStory(story, "draft")); setInventory("design"); setPrintReady(false); changePhase("review", "Made a poster draft at the workstation."); closePanel(); }}>Save draft & pick it up · {story.drafts ? 7 : 14} min <Hand size={16} /></button>
          </>}
        </> : panel === "board" ? <>
          <p className="studio-eyebrow">REVIEW WALL / CREATIVE DIRECTION</p><h2>Step back. Look again.</h2>
          {phase === "review" ? <><p className="studio-dialog-intro">Pin your draft up so Maya can review it at a distance.</p><button className="studio-primary" onClick={pinDesign}>Pin the poster · {story.reviews ? 4 : 6} min <ArrowRight size={16} /></button></> : ["print", "deliver", "complete"].includes(phase) ? <>
            <p className="studio-dialog-intro">{chat.maya ?? reviewLayout(layout).join(" ")}</p>
            {story.request === "pending" && <button className="studio-primary" onClick={() => setPanel("sam")}>Hear what happened <MessageCircle size={16} /></button>}
            <p className="studio-small">Layout feedback checks type hierarchy, reading order, booking size, and overlap. Talk to Maya for a conversation about the work.</p>
            <div className="studio-actions"><button className="studio-primary" onClick={closePanel}>Keep working <ArrowRight size={16} /></button><button className="studio-secondary" onClick={() => { setPrintReady(false); changePhase("design", "Decided to revise the layout after review."); closePanel(); }}>Revise at my desk</button></div>
          </> : <p className="studio-dialog-intro">The wall is empty. Make a draft at your workstation, then bring it here.</p>}
        </> : panel === "printer" ? <>
          <p className="studio-eyebrow">PRODUCTION / PRINT STATION</p><h2>{printing ? "Ink meets paper." : printReady && inventory !== "proof" ? "Your proof is ready." : "Make it physical."}</h2>
          {printing ? <><div className="studio-print-animation"><div /></div><p className="studio-small" role="status">Printing your design…</p></> : printReady && inventory !== "proof" ? <><p className="studio-dialog-intro">The design you made is now in the output tray. Pick it up and take it to Sam.</p><button className="studio-primary" onClick={() => { setInventory("proof"); addEvent("You", "Picked up the printed proof from the tray."); closePanel(); }}>Pick up proof <Hand size={16} /></button></> : phase === "print" ? <>
            {story.jam === "unknown" ? <><p className="studio-dialog-intro">Alex presses start. A roller catches, then stops. An amber light flashes. “Paper’s caught in the rear path. Let’s inspect it before we waste the proof.”</p><button className="studio-primary" onClick={() => { setStory(advanceStory(story, "inspect-printer")); addEvent("Alex", "Printer stopped: paper caught in the rear path."); scene.current?.speak("alex", "Hold on. Don’t pull from the output tray."); }}>Inspect the paper path · 2 min</button></> : story.jam === "jammed" ? <><p className="studio-dialog-intro">The display points to the rear access door. A folded sheet is blocking the rollers. Alex waits beside you while you clear the path.</p><button className="studio-primary" onClick={() => { setStory(advanceStory(story, "clear-jam")); addEvent("You", "Opened the indicated service panel and cleared the jam with Alex."); }}>Open service panel & clear jam · 5 min</button></> : <><p className="studio-dialog-intro">The path is clear. Your poster is queued with: <strong>{story.draftVenue}</strong>.</p>{(["pending", "declined"].includes(story.request) || story.draftVenue !== venueForStory(story)) && <p className="studio-print-warning">The draft still has the old venue. Resolve the brief with Sam, then save an updated draft at your workstation before committing paper.</p>}<button className="studio-primary" onClick={print}>Close panel & print my poster · 6 min <ArrowRight size={16} /></button></>}
          </> : <p className="studio-dialog-intro">{inventory === "proof" ? "You’re carrying the proof. Sam is waiting in the lounge." : "Start with a design, then pin it on the review wall before printing."}</p>}
        </> : panel === "delivery" || panel === "done" ? <>
          <p className="studio-eyebrow">CLIENT LOUNGE / HANDOFF</p><h2>{phase === "complete" ? outcome.title : "One last conversation."}</h2>
          {phase === "complete" ? <><p className="studio-dialog-intro">{outcome.line}</p><p className="studio-small">Handoff at {clockTime(story.minutes)} · agreed departure {clockTime(story.deadline)} · printed venue: {story.printedVenue}</p><div className="studio-actions">{!outcome.accepted ? <button className="studio-primary" onClick={() => { chooseStory("repair"); }}>Make it right with Sam</button> : <button className="studio-primary" onClick={closePanel}>Stay in the studio</button>}<button className="studio-secondary" onClick={reset}><RotateCcw size={15} /> Start a new day</button></div></> : inventory === "proof" ? <><p className="studio-dialog-intro">Sam looks up as you arrive with the proof. “Let’s see what we’re putting on the library wall.”</p><button className="studio-primary" onClick={() => { setStory(advanceStory(story, "deliver")); setInventory(null); changePhase("complete", "Delivered the printed repair café poster to Sam."); scene.current?.moveAgent("sam", "delivery"); setPanel("sam"); scene.current?.speak("sam", handoffOutcome(advanceStory(story, "deliver")).spoken); }}>Hand over the poster · 5 min <Hand size={16} /></button></> : <p className="studio-dialog-intro">Sam needs the printed proof. Collect the brief, make a design and bring it through review and production first.</p>}
        </> : panel === "coffee" ? <>
          <p className="studio-eyebrow">KITCHENETTE / A SMALL PAUSE</p><h2>Everyone ends up here.</h2><p className="studio-dialog-intro">A kettle, a stack of mugs, and a chance to get away from your screen.</p><button className="studio-primary" onClick={() => { addEvent("You", "Took a coffee break and stepped away from the screen."); scene.current?.moveAgent("alex", "coffee"); scene.current?.speak("alex", "Good timing. I was about to put the kettle on."); closePanel(); }}><Coffee size={16} /> Make a coffee</button>
        </> : null}
      </div>
    </dialog>
  </div>;
}
