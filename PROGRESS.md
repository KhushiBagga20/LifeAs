# Block C — progress

Branch: `mafia` (the LifeAs career simulator and its 3D trial are saved on `lifeas`).
Rule: each milestone ends with tests passing, then a commit and a push of `mafia`.

## Milestones
| # | Milestone | Done when |
|---|---|---|
| G0 | ✅ **Foundation:** strip the career code, new design, theme and landing | the app builds, landing page in the new look, tests green |
| G1 | ✅ **Engine:** roles and line-ups, phases, night resolution, votes, wins, Influencer, Boss, per-seat views, event log | rule tests pass; 2,000 random games keep every invariant |
| G2 | ✅ **Rooms:** create/join/start/act, seat tokens, tick-on-read timers, polling, Postgres | service tests play full games with human and AI seats |
| G3 | ✅ **AI neighbours + narrator:** personas, suspicion model, AI night actions and votes, model chat and narration with fakes, leak tests, per-room cost cap | a 1-human game finishes with FakeLLM; real chat works on Azure |
| G4 | **3D courtyard:** Block C scene, people, day/night, bubbles, spotlight, votes, ghosts | smooth on laptop and phone; reduced motion works |
| G5 | **Screens:** landing, lobby, role reveal, night actions, dawn, day chat/point/vote, case file | a whole game is playable and fun on phone and laptop |
| G6 | **Polish + e2e:** two-browser multiplayer test, accessibility, error and reconnect states | e2e green; a stranger can host and play with a friend |

Status key: 🟡 in progress · ✅ done

## Decisions
- **Pivot from LifeAs to a Mafia game** on branch `mafia`, keeping the stack, the AI layer
  (Azure, Claude, FakeLLM) and the trial's low-poly 3D people. · 2026-10-27
- **Modern city setting, "Block C"**: Crew (Mafia), Boss (Godfather), Undercover (Detective),
  Medic (Doctor), Influencer (Jester), Neighbours. · 2026-10-27
- **Online rooms with AI filling seats**, server-authoritative, polling sync with tick-on-read
  timers (no websockets or extra services needed). · 2026-10-27
- **Engine rules decided in G1:** crew can't target crew; the Undercover can't check themselves;
  the Medic may protect themselves, but nobody twice in a row; crew ties go to the Boss's pick,
  else nobody is taken out; votes for yourself aren't allowed; skip beats a lower top vote; the
  Influencer's personal win doesn't end the game; dead players see everything and only talk in
  the ghost chat; a timed-out phase ends at its deadline so catching up keeps the rhythm. · 2026-10-27
- **AI brains in code, voices from the model:** night actions and votes from a suspicion model
  (free, deterministic); chat and narration from the model. · 2026-10-27
- **Rooms in G2:** 4-letter codes without vowels (no accidental words); seat tokens are random
  24-byte strings stored only as SHA-256 hashes and sent in an `x-seat-token` header; every
  request locks the room row, catches the game up to now, then acts. AI seats plan their moves
  when a phase begins (night jobs at 15–70% of the night, votes at 15–80%, about 60% of them
  point during the day) and each intent is worked out at its moment from that seat's own view.
  Catch-up steps one phase at a time so a long silence still gives the AI its turn every night.
  Chat is limited to one message per 1.2 s per seat. A seat that dies (or a finished game)
  should re-poll from `since=-1` to get the history it can now see. · 2026-10-27
- **AI talk in G3:** a scheduler (pure, in `src/rooms/timeline.ts`) queues lines from events:
  two AIs open each day, regular turns every 7–12 s, replies when someone is named, accused or
  voted for, vote calls, crew tactics at night only if a human is in the crew. A runner
  (`src/rooms/talk.ts`) runs after each response via `after()`: it claims due lines under the
  room lock (25 s lease), has the model write them outside the lock, then posts them only if
  the phase hasn't moved on. At most one AI line in flight per call, 2 s between AI lines, 6 s
  per AI, and a per-phase budget. Words match deeds: a vote call casts that vote, a crew plan
  that pick. The model also returns who the chat made it suspect or trust, which feeds that
  AI's votes, so humans can persuade them; an Undercover AI who has found the crew may reveal
  it, swaying the block and drawing the crew's fire. · 2026-10-27
- **Safety of AI text:** prompts are built only from that seat's view (the narrator from a
  spectator's), checked by leak tests that plant a secret in the crew chat. Replies are
  checked in code: length, no "as an AI", no crew member outing themselves in public, no
  graphic narration; anything that fails becomes a template line in the persona's style.
  Templates are also the FakeLLM output, so the game plays offline. · 2026-10-27
- **Balance (G3):** a lone Boss could never be found, so the Boss only appears with 2+ crew;
  one crew member up to 7 seats (2 for 8–9, 3 for 10–12). The AI now reads two classic tells:
  whoever a night victim accused looks worse, and staying silent is suspicious. 120 games with
  one plain human went 65 block / 55 crew; `tests/balance.test.ts` guards it. · 2026-10-27
- **Real model cost:** on Azure `gpt-6-astra`, a chat line is about $0.011 (4–6 s) and a
  narration about $0.01 (6–7 s), so a game costs roughly $0.40–0.60. The per-room cap
  (`LLM_RUN_CAP_USD`, run id `room:CODE`) and the daily cap still apply; e2e forces
  `LLM_PROVIDER=fake`. `npm run talk:smoke` plays a minute of a real room. · 2026-10-27

## Log
_(date · what · tests · cost)_
- 2026-10-27 · G0: career code, O*NET data and trial removed (saved on `lifeas`); new design,
  night-city theme, landing page, roles; fresh local database `.data/blockc` · 63 unit + 6 e2e
  passing · $0
- 2026-10-27 · G1: engine (line-ups, phases, night resolution, votes, wins, Boss, Influencer,
  ghost chat, event log with visibility, per-seat views) · 29 rule tests + 2,000 random games ·
  93 unit passing · $0
- 2026-10-27 · G2: rooms (create, join, settings, start, act, poll), seat tokens, tick-on-read
  catch-up, AI seats with personas and planned moves, API routes · 7 service tests (12 full
  games solo and with friends, leak checks on every poll) + room API e2e · 100 unit + 8 e2e
  passing · $0
- 2026-10-27 · G3: AI chat and narrator (prompts from each seat's view, talk scheduler and
  runner with leases, persuasion, Undercover reveals, checks and template fallbacks), balance
  fixes (Boss needs a partner, one crew up to 7 seats, two new tells) · 115 unit (leak tests,
  fallbacks, once-only posting, balance over 40 games) + 8 e2e passing · real Azure smoke: 2
  narrations + 12 chat lines, all from the model · $0.17
