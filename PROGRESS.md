# LifeAs — progress

Plan: about 4 weeks of focused work (22 working days). Started: 2026-10-19
Rule: do the milestones in order; each one ends with tests passing and the "done when" true.
M10 is the stretch milestone. If you're behind, skip it and do M11.

## Milestones
| # | Milestone | Days | Done when |
|---|---|---|---|
| M0 | 🟡 **Scaffold & deploy** (all but the deploy): Next.js + TS strict, Tailwind tokens, fonts, lint, Vitest, Playwright, Postgres + Drizzle, env config, Vercel deploy | 1 | A live URL shows the empty app shell in the design system; tests run in CI |
| M1 | ✅ **Career data:** O*NET import script, search (titles + alternate titles), CareerProfile builder, credit on About page | 2–3 | "nurse", "ux designer" and "electrician" find the right occupations; a profile page shows the six kinds-of-work bars |
| M2 | 🟡 **AI layer** (all but the live check, which needs an API key): provider interface, adapter(s), FakeLLM, cache, cost tracking, per-run + daily caps, retries. **Choose the provider and fast-tier model** by running 3 careers on each candidate | 3–4 | A real call works; cost is recorded per call; caps refuse over-limit calls; the choice and its reasons are written under Decisions |
| M3 | 🟡 **Career compiler** (code complete and tested; the featured six still need compiling with the real model, see *M3 status*): Workplace generation (cast, **locations with kinds and sizes, home and work places, routines**), coverage / routine / diversity checks, repair pass; compile the 6 featured careers | 4–6 | All 6 pass the checks; reading them, the weeks feel like the real job, boring parts included |
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
- **AI provider: Claude, through the official SDK, swappable.** Callers only see
  `getLLM().generate({ tier, purpose, system, messages, schema })`; providers implement one
  interface. Both tiers default to `claude-opus-5-5` (the documented default); set
  `LLM_FAST_MODEL=claude-haiku-5-5` to compare the cheaper fast tier once a key exists. Opus
  requests opt into server-side fallback (`fallbacks: "default"`) so a policy refusal is retried
  on Anthropic's recommended fallback model; refusals that still fail reach the caller as a typed
  error. Effort: low for the fast tier, medium for smart; thinking stays adaptive. · 2026-10-20
- **One table is both the AI cache and the cost log** (`llm_calls`). Repeated identical requests
  cost nothing; failed attempts are logged for cost but never served. Caps: $2 per run and $10
  per UTC day by default, checked against a worst-case estimate before each call. · 2026-10-20
- **No key yet → FakeLLM everywhere.** Without `ANTHROPIC_API_KEY` the app runs on FakeLLM
  (deterministic, schema-valid, free), so building can continue; the live check
  (`npm run llm:smoke`) and the Opus-vs-Haiku comparison wait for a key. · 2026-10-20
- **Code decides the week's shape, the AI writes it.** Slots (day, time, kind of moment) and the
  kind of work of every moment are planned in code from the O*NET shares by largest remainder,
  so the coverage check holds by construction; a test runs the planner on all 923 careers. The
  AI picks the O*NET task for each slot and writes the content. One kind of work per moment keeps
  the fit maths simple. · 2026-10-20
- **Lengths:** Quick shift = one day, 5 moments; Full week = 12 moments over Mon–Fri. Routine every
  day, 1–2 pressure moments (2 when time pressure or conflict is high), 1–2 real tasks. · 2026-10-20
- **Cast demographics come from code** (age by relation, gender independent of role; a test
  checks the independence), and home, café and street are always added by code. · 2026-10-20
- **The compiler's brief is JSON** in the user message, after a stable system prompt (the cached
  prefix). FakeLLM reads the same brief, so dev and tests get believable workplaces without a key. · 2026-10-20
- **Repair, then fix in code:** one AI repair pass with the list of problems; anything left that's
  a simple reference mistake (bad room, task id, cast id, repeated voice) is fixed in code; only
  structural problems fail the compile. · 2026-10-20
- **Workplaces are stored** (`workplaces` table) and featured ones are committed as JSON under
  `src/data/workplaces/` once compiled with a real model (`npm run compile:featured`). Until then
  they compile on demand with FakeLLM, marked `source = fake`. · 2026-10-20
- **M3 hardening (direction update of 2026-10-20).** The compiler is now staged (prepare →
  generate → validate → repair → fallback → assemble → independent re-check), and the model
  only proposes content that code validates:
  - `validateWorkplace` checks the *finished* workplace on its own (schema, unique ids, every
    reference, week shape, routine per day, coverage, cast, routines, goals), so nothing
    malformed reaches the engine whatever produced it.
  - The repair pass sends only the broken parts back and applies only those parts of the reply.
  - Failures are a typed `CompileError` (invalid, provider, budget, refusal, data) with issues.
  · 2026-10-20
- **Moments declare the kind of work they were written for** (`kindOfWork`), checked against
  the planned kind. This makes the coverage check meaningful for the content, not just the
  labels: a mismatch is repaired; the fallback may relabel only if the week still matches the
  job's mix, otherwise the compile fails. · 2026-10-20
- **Schema changes for M4 and M7:** moments get stable ids (`m1`…); free-text `wants` became
  structured `goals` (id, description, who it involves, status `open`) so the engine can track
  them; places get two-way `adjacentIds` (semantic links, no coordinates) and the street joins
  the district to the workplace's entrance; workplaces record `sources` (O*NET and compiler
  versions). · 2026-10-20
- **Stored workplaces are keyed on the O*NET release and `COMPILER_VERSION` too**, so new data
  or a changed compiler compiles afresh. `COMPILER_VERSION` is 2. · 2026-10-20
- **Three place kinds for work outside buildings:** vehicle (cab, ambulance, boat, cockpit),
  field (farm, dock, roadside) and depot (garage, yard, station, hangar). They're approximations,
  but better than putting a taxi driver in an open-plan office. · 2026-10-20
- **Data gaps are passed to the model, not papered over.** The brief carries *data notes*: no
  working-conditions survey (21 careers), unrated tasks (12), and that all data is US-based.
  The model is told to keep those details general rather than invent them. · 2026-10-20
- **Careers sharing a seed no longer share a cast:** every random draw includes the career
  code. Before, all six featured careers would have had the same boss age and gender. · 2026-10-20
- **Azure provider added (Microsoft Foundry deployment `gpt-6-astra`).** It uses the documented
  v1 Chat Completions API: `POST {resource}/openai/v1/chat/completions`, no `api-version`, the key
  in the `api-key` header, the deployment name as `model`, `max_completion_tokens`, and
  `response_format` `json_schema` with `strict: true`.
  - **Plain `fetch`, no new dependency.** The adapter does its own bounded retries: up to 2 on
    408/409/429/5xx, timeouts and network errors, honouring `retry-after-ms` / `retry-after`
    (capped at 20 s), with a 90 s per-attempt timeout.
  - **Schemas:** converted to the strict subset (every property required, objects closed,
    length/range/count keywords removed); zod still enforces the full schema afterwards.
    Optional fields are refused: AI schemas use `.nullable()`.
  - **Reasoning effort:** `reasoning_effort` low (fast tier) / medium (smart tier), dropped
    automatically if the deployment rejects it.
  - **Prices:** come from `AZURE_AI_PRICE_*` because they aren't in our table and shouldn't be
    guessed; the spending caps depend on them.
  - **Selection:** `LLM_PROVIDER` wins; otherwise Claude if `ANTHROPIC_API_KEY` is set, else
    Azure if its three connection variables are set, else FakeLLM.
  - **Not verified live yet:** the variables weren't set in this environment.
  · 2026-10-20
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
- 2026-10-20 · Repo pushed to github.com/KhushiBagga20/LifeAs (`main`), on top of its initial commit
- 2026-10-20 · M2: AI layer (provider interface, Claude adapter with structured output, caching,
  effort and fallback; FakeLLM; cache + cost log in Postgres; run and daily caps; validation retry;
  truncation retry; concurrency limit; smoke script) · 81 unit passing · $0
- Left in M2: live check and model comparison (needs `ANTHROPIC_API_KEY` in `.env.local`)
- 2026-10-20 · M3: career compiler (slot planning, cast sampling, JSON brief, smart-tier draft,
  validation, repair pass, code fixes, assembly with district and routines), realistic compiler
  fake, workplaces table, compile:featured script · 102 unit + 16 e2e passing · $0
- Left in M3: run `npm run compile:featured` with a key, read the six weeks for realism, commit them
- 2026-10-20 · M3 hardening: staged compiler with typed errors, part-by-part repair, safe
  fallback, independent `validateWorkplace`, declared kind of work, goals, moment ids, place
  links, versioned cache keys, data notes, outdoor/mobile place kinds, `eval:compiler` · 135
  unit + 16 e2e passing; 1,846/1,846 FakeLLM compiles valid · $0

- 2026-10-20 · Azure provider for the Foundry deployment (v1 Chat Completions, strict JSON
  schema, retries and timeouts, env config with prices, provider selection) · 27 new tests ·
  not verified live (no credentials in this environment) · $0

## M3 status (2026-10-20)

**Not complete.** Everything that can be built and tested without a model is done. The
acceptance criterion *"All 6 pass the checks; reading them, the weeks feel like the real job,
boring parts included"* needs the real model, and there's no `ANTHROPIC_API_KEY` yet.

| Acceptance item | Status | Evidence |
|---|---|---|
| Profile + options + seed → validated Workplace | ✅ code | `compileWorkplace`; `validateWorkplace` returns no issues for all 6 featured careers and 10 sample careers in tests |
| Task, cast and place references valid | ✅ | draft checks + independent check; tests for each unknown-reference case |
| Required moment kinds, routine every day | ✅ | `WEEK_RULES` shared by planner and validator; tests for a day without routine and wrong task counts |
| Coverage within tolerance | ✅ | planner property test over all 923 careers × 2 lengths; declared kind of work checked; repair and fallback tests |
| Distinct names and voices, actionable goals | ✅ | tests for repeated names, voices, goals involving no one |
| Meters valid | ✅ | schema bounds and unique ids, tested |
| Rubrics where required | ✅ | schema (2–4 criteria) and task/non-task tests |
| One bounded repair, safe fallback, typed failure | ✅ | tests: repair fixes coverage and missing moments; fallback relabels only within tolerance; failed repair gives `CompileError("invalid")`; ≤ 4 provider calls |
| Timeouts, invalid output, budget | ✅ | tests: timeout → `CompileError("provider")`; invalid output twice → `invalid` after 2 calls; cap → `budget` with 0 calls |
| Reproducible, versioned caching | ✅ | same seed → same workplace; ids change with options, seed, career and O*NET version |
| **The six featured weeks feel like the real job** | ❌ needs a key | `npm run compile:featured`, then read them; FakeLLM output is a placeholder |

**Tests run (2026-10-20, all observed):**
- `npm run check`: lint clean, type check clean, 135/135 unit tests passing
- `npm run e2e`: production build, then 16/16 browser tests passing
- `npm run eval:compiler`: 16/16 valid (6 featured + 10 sample)
- `npm run eval:compiler -- --all`: 1,846/1,846 valid (923 careers × quick and full), with FakeLLM

**Not tested:** any real-model output (quality, voice, realism, real repair rates, cost and
latency per compile); the Claude adapter is tested against a stubbed SDK client only.

**Data limitations found:**
- 21 careers have no working-conditions survey and 12 have no task ratings (listed by
  `eval:compiler -- --all`, e.g. Taxi Drivers, Emergency Medical Technicians, Legislators,
  Cardiologists).
- All O*NET data is US-based, so it can't be assumed to describe workplaces in India or
  elsewhere.
- The place kinds are approximations for jobs outside buildings.
- FakeLLM picks places by keywords in the job title. That's for development only, never shown
  as fact, and the featured weeks must come from the real model.

**Ready for M4:**
- `Workplace` (stable ids for people, places, moments and goals)
- `MomentPlan` (fixed occupational structure; editable setup, stakes and cast)
- `Character.goals[].status` and `routine`
- `Location.adjacentIds`
- `getWorkplace()`, the `workplaces` table, `getLLM()`
- FakeLLM `register()` for the engine's own fakes

The parked draft on the local branch `m4/moment-engine` predates these changes. It must be
rebased and adapted: use `goals` instead of `wants`, refer to moments by `id`, and track goal
status as engine-owned state.

**Risks for M4 and later:**
- Real-model quality is unproven: distinct voices, believable routine moments, and whether
  declared kinds of work match the content.
- A full compile is one large smart-tier call (roughly 6–12k output tokens, likely tens of
  seconds), so it needs streaming or a progress state in the UI.
- Fixed costs per career before visitors can play it: compiling the featured six once.
- The fit report will rest on few moments (5–12), so it must show sample sizes, as planned.
- With Azure configured, both tiers use the one deployment (`gpt-6-astra`), including the many
  fast-tier character calls in M4. Check its prices before running weeks; add a separate fast
  deployment if it's expensive.
