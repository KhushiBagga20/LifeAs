# LifeAs — progress

Plan: about 4 weeks of focused work (22 working days). Started: 2026-10-19
Rule: do the milestones in order; each one ends with tests passing and the "done when" true.
M10 is the stretch milestone. If you're behind, skip it and do M11.

## Milestones
| # | Milestone | Days | Done when |
|---|---|---|---|
| M0 | 🟡 **Scaffold & deploy** (all but the deploy): Next.js + TS strict, Tailwind tokens, fonts, lint, Vitest, Playwright, Postgres + Drizzle, env config, Vercel deploy | 1 | A live URL shows the empty app shell in the design system; tests run in CI |
| M1 | ✅ **Career data:** O*NET import script, search (titles + alternate titles), CareerProfile builder, credit on About page | 2–3 | "nurse", "ux designer" and "electrician" find the right occupations; a profile page shows the six kinds-of-work bars |
| M2 | **AI layer:** provider interface, adapter(s), FakeLLM, cache, cost tracking, per-run + daily caps, retries. **Choose the provider and fast-tier model** by running 3 careers on each candidate | 3–4 | A real call works; cost is recorded per call; caps refuse over-limit calls; the choice and its reasons are written under Decisions |
| M3 | **Career compiler:** Workplace generation (cast, **locations with kinds and sizes, home and work places, routines**), coverage / routine / diversity checks, repair pass; compile the 6 featured careers | 4–6 | All 6 pass the checks; reading them, the weeks feel like the real job, boring parts included |
| M4 | **Moment engine:** open / exchange / resolve, task review, director (*Meanwhile* events with who goes where), **routines and `move` events**, meters and trust with clamps, event log, snapshots, determinism + replay tests | 6–8 | A full Quick shift plays end to end through the API with both FakeLLM and the real model, and the event log says where everyone is at every step |
| M5 | **Design system + picker + expectations + briefing** | 8–9 | Screens look finished on phone and laptop; screenshots reviewed |
| M6 | **Scene panel:** backdrops, portraits with expressions, streamed lines, replies + free text, task views, pulse, HUD | 9–12 | A Quick shift is fun to play on a phone through the panel alone; first line appears in ~2 s |
| M7 | **2D world:** PixiJS stage, map generator (cut-away workplace + district with home, café, street), figures from the avatar generator, pathfinding, routines on screen, speech bubbles, day/night, camera (follow, zoom into moments), event list as text | 12–16 | Every featured career gets its own believable map; figures walk to meetings, lunch and home as the clock runs; moments zoom in and open the panel; ≥ 55 fps median on laptop and phone; reduced motion works |
| M8 | **Fit report:** fit model, narrative with moment citations, job-makeup chart, expected vs real, related careers, share card | 16–17 | The report numbers match a hand calculation on a test run; every claim links to a moment or a source |
| M9 | **Ask a senior** chat | 18 | Answers stay in character and separate facts (cited) from opinion |
| M10 | **Replay + compare** *(stretch)* | 19–20 | Replay from any moment branches correctly; two reports show side by side |
| M11 | **Launch hardening:** visitor limits, daily spend cap, "watch a recorded week" fallback, all loading/error/limit states, accessibility, performance, e2e green, README, **portfolio case study** | 20–22 | A stranger can open the link on a phone, play a week and read a report; the case study explains the design decisions |

Status key: 🟡 in progress · ✅ done

## Decisions
_(what · why · date)_
- **Name: LifeAs**, from the project folder; replaces the working title "Week One". · 2026-10-19
- **Database fallback:** without `DATABASE_URL` the app uses embedded PGlite (`.data/pglite`), so
  it runs and tests with no setup. Production will use hosted Postgres via `DATABASE_URL`. · 2026-10-19
- **Colours darkened for contrast:** the light accent (`#BC4C35`) and the energised / pressure /
  info colours are darker than first proposed so text passes 4.5:1; `tests/contrast.test.ts`
  enforces it in both themes. · 2026-10-19
- **Fonts:** Fraunces, Inter, IBM Plex Mono through `next/font/google`, which downloads them at
  build time and serves them from our own domain. · 2026-10-19
- **Node 24+:** Vitest 5 needs `@types/node` 22+; matches the local runtime. · 2026-10-19
- **Kind-of-work colours:** no per-kind colours. The career chart is one series, so every bar
  uses `--series-1`; `--series-2` is ready for the "you vs the job" comparison in M7. Both
  pass the dataviz palette checks (light and dark) and 3:1 against the surface. · 2026-10-20
- **O*NET 31.0, JSON release:** newest release (August 2026). Its files are named differently
  from older guides ("Job Titles", "Career Interest Types"). The download goes to `.data/onet`
  (ignored); the trimmed output in `src/data/onet/` (≈11 MB, 923 careers) is committed so the
  app needs no import step to run. · 2026-10-20
- **923 of 1,016 occupations:** the other 93 (mostly "…, All Other") have no tasks or interest
  data. 12 shipped careers have tasks without ratings or working conditions; their pages say so. · 2026-10-20
- **"What this job is made of" = interest shares:** each RIASEC score minus the floor of 1,
  divided by the total. It's labelled as coming from interest ratings, not time spent. · 2026-10-20
- **Featured careers changed from the design:** UX designers are mostly *Thinking* in O*NET
  data, and "product manager" maps to Marketing Managers, so the featured list uses Graphic
  designer (Creating) and Lawyer (Leading). A test checks each featured career's high point. · 2026-10-20
- **Search without a library:** word-for-word matching first; prefix and typo matching only
  when that finds nothing (this stops "nurse" matching "nursery" and "lawyer" matching
  "sawyer"). No AI fallback until M2. · 2026-10-20
- **Data read from disk with `use cache`**, and shipped to the routes that need it with
  `outputFileTracingIncludes`. Featured career pages are prerendered; the rest render on first
  visit and are then cached. · 2026-10-20
- **Browser tests run against a production build** (`next build && next start`), because
  Next.js 16 won't run a second dev server in the same folder. · 2026-10-20
- **2D world added (M7):** workplace plus a small district (home, café, street), not a whole
  city: the job stays the focus. Conversations stay in a scene panel so they're easy to read.
  The plan grows from ~3 to ~4 weeks rather than cutting a feature. M3 and M4 now also produce
  locations, routines and `move` events for the map. · 2026-10-20
- **Next.js keeps the previous page mounted (hidden)** with Cache Components. Two forms can be
  in the document at once, so the search label wraps its input instead of using an id, and
  tests only count visible text. · 2026-10-20

## Log
_(date · what was done · tests · cost spent)_
- 2026-10-19 · M0: Next.js 16.4 + TS strict, Tailwind v4 tokens (light + dark), fonts, home
  page, Drizzle with Postgres/PGlite, `/api/health`, Vitest, Playwright (laptop + phone), CI
  workflow, CLAUDE.md, README · 22 unit + 4 e2e passing, lint and build clean · $0
- Left in M0: deploy to Vercel with a hosted Postgres (needs your Vercel and database accounts)
- 2026-10-20 · M1: O*NET 31.0 import (923 careers), search with ranking and typo fallback,
  career pages (kinds-of-work chart with table view, top tasks, working conditions, preparation,
  related careers), search results, featured careers, About page with the O*NET credit, search
  API, not-found page · 62 unit + 16 e2e passing, lint and build clean · $0
