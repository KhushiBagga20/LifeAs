# Block C — Design

> **Someone in Block C runs with a crew. Find them before they run the block.**
> A social-deduction game (the Mafia / Werewolf family) set in a modern apartment block. Play
> online with friends; AI neighbours fill the empty seats with their own personalities, hunches
> and lies, and an AI narrator tells the story of every night.

Status: v0.1, 2026-10-27. Branch `mafia`. "Block C" is a working title.

---

## 1. The game

### 1.1 Roles
| Role | Team | Night | Wins when |
|---|---|---|---|
| **Neighbour** | Block | — | every crew member is out |
| **Crew** | Crew | chooses someone to take out (with the rest of the crew) | the crew is at least as many as everyone else alive |
| **Boss** *(optional)* | Crew | as crew; **looks clear** to the Undercover | as crew |
| **Undercover** | Block | checks one person: *crew* or *clear* | as the block |
| **Medic** | Block | protects one person (not the same person two nights running) | as the block |
| **Influencer** *(optional)* | Alone | — | gets **voted out** by the block ("any publicity…"). The game carries on. |

**Line-ups** (5–12 players): crew = 1 for 5–7 players, 2 for 8–9, 3 for 10–12; with Boss on
and at least two crew, one crew member is the Boss (a lone Boss could never be found). Always one Undercover and one Medic. Influencer only from 7 players.
Everyone else is a Neighbour.

### 1.2 A round
1. **Night** (30 s). Crew pick a target together (majority; the Boss breaks ties; no agreement
   means nobody). The Medic protects someone. The Undercover checks someone.
2. **Dawn** (~12 s). The narrator tells what happened. If the target wasn't protected they're
   out and their role is revealed.
3. **Day: discussion** (90 s, 60 s on Quick). Group chat. Anyone can **point at** someone
   (an accusation everyone sees) and react to messages.
4. **Day: vote** (30 s). Everyone alive votes for a living player or *skip*. Votes are public.
   The most votes wins if it beats *skip* and isn't tied; otherwise nobody goes.
5. **Verdict** (~10 s). The voted-out player's role is revealed.
6. Check wins → next night.

A phase ends early once every human who has something to do has done it.

### 1.3 What each player knows (the engine enforces it)
- **Everyone:** who's alive, roles of people who are out, the day chat, accusations, votes,
  the narrator's story.
- **Crew:** each other, the crew chat at night, the crew's target votes.
- **Undercover:** their own check results. **Medic:** who they protected.
- **Out players** see everything (all roles, all chats) and talk only to each other.

Every view a player (or an AI player's prompt) receives is built by one function from the
event log, filtered by what that seat may know. Nothing private is ever sent to a client that
isn't allowed it.

---

## 2. AI neighbours and the narrator

### 2.1 Neighbours
Empty seats are AI neighbours. Each has a persona built in code from the seed: name, age, flat
(e.g. 4B), job, how they text (lowercase and emoji / proper punctuation / all energy), and
traits (suspicious, chatty, quiet, logical, dramatic).

- **The brain is code; the voice is the model.**
  - A code **suspicion model** per AI tracks everyone from evidence that AI may know:
    accusations, how people vote, who died after accusing whom, role claims, and (for the
    Undercover) check results.
  - Night choices and votes come from that model, which is free and deterministic.
  - **Chat** comes from the model (fast tier): the AI's own view, its suspicions and the recent
    chat → one short message in its texting style, plus an optional *point at*. Crew AIs lie;
    others reason.
- **Talk scheduler:** AIs answer when mentioned or accused and otherwise take turns, so the chat
  feels alive without flooding: roughly one AI message every 6–12 s.
- AI chat replies are checked like everything else: schema, length, no claiming to be an AI.

### 2.2 Narrator
Smart tier, once per dawn. It gets only public information (who's out, their revealed role, the
day's tension) and writes 2–4 sentences of modern-city noir. It never hints at hidden roles.
Non-graphic: people are "taken out"; no gore.

### 2.3 Without a model
FakeLLM gives template chat and narration in each persona's style, so the game runs offline,
free, in tests and in development. With Azure configured (`AZURE_AI_*`), the real model speaks.
A per-room cap (`LLM_RUN_CAP_USD`, keyed by room) stops spending; past it, AIs quietly fall back
to templates.

---

## 3. Online rooms

- **Create a room** (your name, 5–12 seats, Boss on/off, Influencer on/off, pace Quick/Normal)
  → a 4-letter code and link. Friends **join** with a name. The host **starts**; AI neighbours
  fill the empty seats.
- **Identity:** each seat gets a random token (kept in the browser, stored hashed on the
  server). Every action carries it.
- **Authority:** the server owns the game. Clients send intents (chat, point, night target,
  vote); the engine validates them against the rules and the phase, then appends events.
- **Sync:** clients poll `GET /api/rooms/:code?since=<seq>` about once a second and get their
  own view plus new events they may see. Phase timers advance on these requests ("tick on
  read"): no background server needed, works on serverless. AI chat is generated after the
  response (`after()`), with a lease so two polls never do the same work.
- **Storage:** Postgres (PGlite locally): `rooms`, `seats`, `events`, plus `llm_calls` (AI cache
  and cost log).

---

## 4. Look and feel

### 4.1 The courtyard (3D, three.js)
The low-poly people from the LifeAs trial, restyled for a city block: hoodies, jackets, caps,
headphones, phones. They stand in a loose ring in the **Block C courtyard**: a five-storey
façade with balconies and windows, a streetlight, a bench, a basketball hoop, a CCTV pole,
bins and a mural.
- **Day:** warm light, people in the ring, speech bubbles with the real chat, a spotlight on
  whoever is being pointed at, raised hands during the vote.
- **Night:** blue dusk and lit windows. Crew players see the crew in red.
- **Dawn:** an ambulance light sweeps the courtyard; the person who's out stays as a pale
  ghost for the rest of the game.
- Isometric camera, gentle motion, reduced motion respected.

### 4.2 Screens
Landing (create / join) · lobby (seats, settings, share link) · role reveal (card flip) · the
game (scene + phase bar with timer + players + group chat + phase action bar) · case file
(winners, every role, night by night what really happened).
Phone first: scene on top, chat below. Laptop: scene with side panels.

### 4.3 Identity
Night-city palette: ink navy surfaces, sodium-amber light, **crew magenta**, **block cyan**.
Inter for UI, a mono for timers and flat numbers. Text passes 4.5:1 (tested).

---

## 5. Architecture
```
src/game/     engine (rules, phases, resolution, wins), line-ups, views — pure TS, seeded
src/ai/       personas, suspicion model, chat + narrator prompts, fakes
src/rooms/    room service: create/join/start/act, tick, AI scheduling, DB access
src/scene/    three.js courtyard and people
src/app/      landing, /r/[code] game page, /api/rooms/*
src/llm/      AI layer (Azure, Claude, FakeLLM), carried over from LifeAs
src/db/       Drizzle schema + migrations
```

## 6. Quality bar
1. Rules are always right: no action outside its phase or role, no information leaks.
2. AI neighbours feel like different people, lie convincingly when crew, and never stall a game.
3. A full game with 1 human and AI runs start to finish with no model configured.
4. Works on a phone and a laptop; keyboard accessible; reduced motion respected.
5. Costs are capped per room.

## 7. Testing
- **Engine:** unit tests for every rule; thousands of random simulated games checking invariants
  (dead never act, wins correct, views never leak).
- **AI:** prompts built only from the seat's view (leak tests), suspicion updates, fakes.
- **Rooms:** create/join/start/act through the service with PGlite in memory; timers by an
  injected clock.
- **E2E:** two browser contexts in the same room with AI seats, phone and laptop.
