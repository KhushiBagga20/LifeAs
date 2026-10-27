# Block C — progress

Branch: `mafia` (the LifeAs career simulator and its 3D trial are saved on `lifeas`).
Rule: each milestone ends with tests passing, then a commit and a push of `mafia`.

## Milestones
| # | Milestone | Done when |
|---|---|---|
| G0 | ✅ **Foundation:** strip the career code, new design, theme and landing | the app builds, landing page in the new look, tests green |
| G1 | ✅ **Engine:** roles and line-ups, phases, night resolution, votes, wins, Influencer, Boss, per-seat views, event log | rule tests pass; 2,000 random games keep every invariant |
| G2 | **Rooms:** create/join/start/act, seat tokens, tick-on-read timers, polling, Postgres | service tests play full games with human and AI seats |
| G3 | **AI neighbours + narrator:** personas, suspicion model, AI night actions and votes, model chat and narration with fakes, leak tests, per-room cost cap | a 1-human game finishes with FakeLLM; real chat works on Azure |
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

## Log
_(date · what · tests · cost)_
- 2026-10-27 · G0: career code, O*NET data and trial removed (saved on `lifeas`); new design,
  night-city theme, landing page, roles; fresh local database `.data/blockc` · 63 unit + 6 e2e
  passing · $0
- 2026-10-27 · G1: engine (line-ups, phases, night resolution, votes, wins, Boss, Influencer,
  ghost chat, event log with visibility, per-seat views) · 29 rule tests + 2,000 random games ·
  93 unit passing · $0
