# LifeAs — Design

> **Live a week in a job before you choose it.** Pick any career and play a sped-up work week
> in it, with AI coworkers, a boss and clients who have their own personalities, remember what
> you did, and get on with their own lives between your scenes. At the end, see what the job is
> really made of and how it suited you.

Status: draft v0.1, 2026-10-19.

---

## 1. Product

### 1.1 Why it exists
People choose careers from salary tables, family advice and "day in the life" videos. None of
those let you *feel* the job: the meetings, the boring parts, the people, the pressure. LifeAs
puts you inside a realistic week of the job, built from real occupational data, so the dull 40%
shows up alongside the exciting 10%.

It is a preview of what the work feels like. It is **not** a test of whether you'd be good at
it, and it is not career advice.

### 1.2 Who it's for
Anyone exploring careers: students choosing a path, graduates choosing between roles, people
thinking about switching. The setting adapts to the player's country or city (names, workplace
culture, currency). The job content comes from O*NET, which is US data (§2), and the app says so.

### 1.3 What the player does
1. **Pick a career.** Free text ("ER nurse", "UX designer at an agency", "civil engineer on a
   metro project") or a featured card. Optional: level (intern / junior / experienced),
   workplace (startup, large company, government, hospital, freelance, …), location, and length
   (**Quick shift** ≈ 10 min, 5 moments · **Full week** ≈ 25 min, 12 moments).
2. **Say what you expect** (10 seconds). "What do you think you'll spend most of your time
   on?" Pick 3 from the job's real activities. The report shows expected vs real.
3. **Briefing.** Your role, the workplace, the people you'll work with (portrait + one line
   each), the week ahead, what doing well means here, and a "what this job is made of" bar.
4. **Play the week.** A sequence of moments (§1.4). Between moments, a short *Meanwhile…*
   shows what the others did off-screen.
5. **Pulse check** after each moment: one tap, *energised / fine / drained*.
6. **Fit report** at the end (§1.6).
7. **Ask a senior** at any time: chat with an experienced character from this career.
8. **Replay a moment.** Go back to any moment, choose differently, and see how the week changes.
9. **Compare.** Try a second career and see both reports side by side.

### 1.4 Moments
| Kind | What happens | Example (product manager) |
|---|---|---|
| **Conversation** | A meeting, call, hallway chat or patient visit. Characters speak; you pick one of 2–4 suggested replies or type your own. Up to 4 exchanges, then it resolves. | Engineers argue about a deadline in standup |
| **Task** | 1–3 minutes of the real work: write a short email, rank 5 requests, spot the mistake in a chart / drawing / prescription, pick a design and justify it, estimate a number. A senior reviews it in character against a rubric. | Write 3 lines explaining why a feature should wait |
| **Routine** | The parts nobody films: paperwork, status updates, waiting on approvals, data entry. Short but always present. Leaving them out would misrepresent the job. | Update the sprint board and the weekly report |
| **Pressure** | Something goes wrong: a deadline moves, a client escalates, an emergency. Built from the job's real working conditions (O*NET work context: time pressure, conflict, consequence of error). | The biggest client threatens to leave |

Every moment records which real job activities it stands for (O*NET task and work-activity
ids) and which **kind of work** it is. The six kinds are O*NET's interest areas in plain
words: **Hands-on · Thinking · Creating · Helping · Leading · Organising**. These tags are
what let the report compare what you felt with what the job is made of.

### 1.5 The living workplace
- **Cast:** 4–7 characters: a boss, 2–3 coworkers, 1–2 outsiders (client, patient, customer,
  student, …) and 1 senior/mentor. Each has a name, role, two-sentence backstory, personality,
  what they want this week, a private agenda, and a **voice** (formality, slang, language mix,
  terse or chatty).
- **They remember.** Each keeps memories of what happened and what you said, plus a trust level
  toward you. Trust and mood change how they speak to you later in the week.
- **They act without you.** Between moments a *director* step lets characters talk to each other
  and follow their agendas: the engineer complains to your boss; the client emails again. This
  appears as *Meanwhile…* lines and can reshape the next moments (within limits, §4.4).
- **Job meters:** 2–4 meters specific to the job ("Launch readiness", "Ward calm", "Site
  safety", "Client happiness") plus your **energy**. They only move because of events.

### 1.6 The fit report
- **Your week** in one paragraph, linking to the key moments.
- **What energised and drained you,** by kind of work, computed from your pulse taps, not guessed
  by AI. Each number shows how many moments it's based on.
- **What the job is actually made of:** the share of each kind of work from O*NET, next to your
  energy for it. This is the main insight, e.g. *"you lit up in people moments; this job is
  mostly analysis."*
- **Expected vs real:** your 3 guesses against the job's top activities.
- **How you worked:** notable choices, with a senior's take (clearly labelled as an opinion).
- **Facts with sources:** typical tasks, preparation level (O*NET Job Zone), related careers to
  try next. Pay and local career paths only where a real source exists. Otherwise they are left
  out, never made up.
- **Shareable** link and image card.
- **No single "87% match" score.** The report shows the parts and leaves the verdict to you.

### 1.7 Non-goals and rules
- Not career advice, a skills test or a hiring tool. Never tells anyone they'd be bad at a job.
- Not training for regulated work. Medical, legal and safety moments feel realistic but are not
  instruction; one clear line in the UI says so.
- Synthetic characters only. Cast demographics are sampled in code, independent of role, so
  casting doesn't follow stereotypes.
- No illegal "careers". If a query matches nothing legitimate, say so kindly and suggest
  alternatives.
- v1 has no accounts. Runs are stored anonymously and anyone can delete their own run.

---

## 2. Grounding data: O*NET
The O*NET® database is the US Department of Labor's free occupational database, licensed
**CC BY 4.0**. LifeAs uses release **31.0 (August 2026)**: 1,016 occupations, of which 923 have
the task, interest and job-zone data we need. `npm run onet:import` turns the JSON release into
`src/data/onet/` (committed). Every page that shows the data carries the attribution O*NET asks
for, including the "modified" sentences. Public copy uses "O*NET" only as an adjective
("O*NET data"), with ®.

| O*NET 31.0 file | Used for |
|---|---|
| Occupation Data, Job Titles, Sample of Reported Titles | Career search; "also called" |
| Task Statements + Task Ratings (importance, relevance, frequency) | Planning the week's moments; "the most important tasks" |
| Work Activities | Detail under each kind of work |
| Career Interest Types (RIASEC profile + high points) | "What this job is made of" (the six kinds of work) |
| Work Context + Work Context Categories | "What the days are like"; pressure moments and realism |
| Job Zones + Job Zone Reference | Preparation level |
| Related Occupations | "Related careers" / try next |

Ratings O*NET marks `recommend_suppress = Y` are dropped.

**Matching a search:** word-for-word matching over the occupation title, common titles and
alternate titles, with light stemming. Ranking prefers exact title matches, then query words
that appear in the occupation title, then how many of the job's titles match. Only when
nothing matches word for word does a looser pass allow an unfinished last word and typos.
If nothing matches at all, the page suggests other wording and the featured careers. Later,
the AI maps the query to the closest occupation and says so ("closest match: Zoologists and
Wildlife Biologists").

---

## 3. Architecture

```
┌──────────────────────────── Next.js app (TypeScript, one deploy) ─────────────────────────────┐
│  UI (React)        picker · briefing · scene player · meanwhile · report · senior chat ·      │
│                    compare · about/sources                                                    │
│  API (route handlers, SSE for streamed dialogue)                                              │
│  engine/           career compiler · moment runner · task reviewer · director · fit model ·   │
│                    replay · event log · snapshots · seeded RNG                                │
│  llm/              provider interface · Claude adapter (+ others if chosen) · FakeLLM ·       │
│                    cache · cost tracking · caps                                               │
│  data/onet/        import script → generated JSON / tables                                    │
└───────────────────────────────────────────▲───────────────────────────────────────────────────┘
                                            │
                                  Postgres (Drizzle ORM)
             careers · workplaces · runs · events · snapshots · llm_calls (also the cache)
```

- **Next.js (App Router) + TypeScript strict**, deployed to Vercel: one language and one deploy,
  so the portfolio link always works.
- **Postgres** (Neon or Supabase free tier) with Drizzle ORM.
- **LLM layer:** a small interface of our own, `generate<T>(tier, messages, zodSchema)`, plus
  `stream`, with one adapter per provider. The Claude adapter uses the official
  `@anthropic-ai/sdk` with structured outputs. Every response is validated with zod.
- **UI:** React, Tailwind with our own design tokens (no default palette), Framer Motion,
  lucide icons, self-hosted fonts. SVG backdrops and portraits.
- **Tests:** Vitest (unit) and Playwright (end-to-end).

---

## 4. Engine

### 4.1 Data model
```text
CareerProfile   onet_code, title, description, tasks[{id, text, importance, frequency}],
                activities[{id, name, importance}], interests{R,I,A,S,E,C}, work_context{…},
                job_zone, related[codes]                                   # from O*NET only
Workplace       id, onet_code, options{level, workplace, location}, setting{name, place,
                culture notes, currency}, you{title, responsibilities},
                cast[Character], locations[{id, name, kind}], meters[{id, name, start, meaning}],
                week[MomentPlan], seed
Character       id, name, role, age, gender, avatar_seed, backstory, personality{big5},
                wants, agenda, voice{formality, slang, language_mix, verbosity, quirks}
MomentPlan      n, day, time, location_id, kind(conversation|task|routine|pressure),
                cast_ids[], onet_task_ids[], work_kinds{R..C weights}, setup, stakes,
                task_spec?{type, prompt, rubric[]}
Run             id, workplace_id, parent_run_id?, branch_moment?, seed, status, moment_n,
                meters{}, energy, trust{char_id: -1..1}, expectations[], cost, created_at
Event           run_id, seq, moment_n, kind(line|reply|task_answer|review|resolve|meanwhile|
                pulse|meter|system), actor_id?, content, data{}, cause_ids[]   # append-only
Snapshot        run_id, moment_n, blob (full run state + character memories + rng state)
LLMCall         hash, provider, model, tier, tokens{in, cached, out}, cost, latency_ms,
                response, created_at                                        # also the cache
```

### 4.2 Career compiler (smart tier, structured output)
Input: the CareerProfile, options and seed. Output: a Workplace.
1. **Code first:** sample cast size, ages and genders, and the moment count per kind, from the
   seed and the job's task weights.
2. **Model drafts** the setting, cast personas and voices, locations, meters and the week plan,
   using the sampled demographics as fixed inputs.
3. **Code checks:**
   - **Coverage:** the share of moments per kind of work is within ±15 points of the job's
     O*NET profile.
   - **Routine:** a Full week has at least one routine moment per day.
   - **Valid references:** every moment references real task ids.
   - **Distinct voices:** no two characters have the same voice settings or name.
4. **One repair pass:** check failures go back to the model once. If they still fail, the run
   uses the closest valid plan and logs it.

Cached by (onet_code, options, seed). Featured careers are compiled once and committed, so they
cost nothing for visitors.

### 4.3 Running a moment
- **Open** (fast tier): the scene's first lines from the characters present, each with
  `{speaker, line, emotion}`, plus 2–4 suggested replies that are different approaches with no
  obvious right answer. The inputs are each character's persona, voice, trust, top memories
  (recency × importance) and the moment plan.
- **Exchange** (fast tier): characters react to your reply in character. Up to 4 rounds, or
  until the model marks the moment resolved.
- **Task review** (smart tier): a score per rubric criterion and feedback in the senior's voice.
  It is always formative and never a pass/fail on you.
- **Resolve** (fast tier): a summary, meter changes, trust changes per character, new memories
  and cause links. **Code clamps** these to ±20 per meter and ±0.3 trust per moment, so one
  sentence can't swing the week.

### 4.4 Director (between moments, fast tier)
Input: agendas, trust, meters and the last resolution. Output: 0–3 off-screen events (who did
what with whom), shown as *Meanwhile…* lines, plus optional edits to the next 1–2 moments (their
setup, stakes or cast). The director **cannot delete a moment or change its kind or task tags**,
so the week stays faithful to the job's real makeup.

### 4.5 Event log, snapshots, replay
- **Event log:** every event is appended to one log, with `cause_ids` linking it to the events
  behind it. The UI and the report read from it.
- **Snapshots:** taken before every moment.
- **Replay:** copies the snapshot at moment *k* into a new run (`parent_run_id`, `branch_moment`).
- **Determinism:** one seeded RNG per run, and LLM responses cached by
  `hash(provider, model, messages, schema, seed)`. The same seed with the same choices gives the
  same week, and replaying a recorded run costs nothing.

### 4.6 Fit model (code, not AI)
- Each moment has kind-of-work weights (from its tasks and activities).
- Pulse values: energised = +1, fine = 0, drained = −1.
- **Affinity per kind** = the weighted mean of the pulses, reported with the number of moments
  it's based on.
- The report pairs affinity with the job's O*NET profile and highlights the two biggest gaps:
  *"you enjoy it but the job rarely needs it"* and *"it drains you and the job is full of it"*.
- The AI writes the narrative from these numbers and cites moments, but it cannot change the
  numbers.

### 4.7 Ask a senior (smart tier, streamed)
Persona + CareerProfile + this run's events. Answers in character and keeps two things apart:
**facts** (from O*NET, cited) and **personal opinion** (labelled).

### 4.8 Models, cost and limits
**Two tiers:** *smart* (compiler, task review, report, ask a senior) and *fast* (character
lines, suggested replies, resolve, director). The provider is decided in M2 by running the same
3 careers on each candidate and comparing voice quality, speed and cost.

If Claude is chosen: the documented default is `claude-opus-5-5`. Using `claude-haiku-5-5` for
the fast tier is a cost/quality call to make after comparing the two in M2. Opus 5.5 can't turn
thinking off, so character lines would run at `low` effort.

Rough cost of one Full week. This assumes ~70 fast calls and ~5 smart calls at about 2.5k input
and 300 output tokens each. It uses Claude list prices cached on 2026-10-06, is calculated
before prompt caching, and excludes thinking tokens. Measure it for real in M2:

| Setup | ≈ per Full week |
|---|---|
| Opus 5.5 for both tiers | ~$1.30 |
| Haiku 5.5 fast + Opus 5.5 smart | ~$0.25 |

**Keeping the public demo safe and cheap:**
- Featured careers are pre-compiled.
- Each visitor gets a small daily limit (e.g. 2 Full weeks).
- A global daily spend cap applies; when it's hit, visitors get *"watch a recorded week"* (a
  cached replay that costs nothing) instead of an error.
- API keys live only in server environment variables and are never sent to the browser.
- **Prompt caching:** stable content first (rules → career profile → cast), the volatile scene
  context last.

### 4.9 Reliability
- Every response is validated against its zod schema; on failure, one retry with the
  validation error.
- If the retry also fails, a safe fallback (a neutral in-character line, or "no change"); the
  run never crashes.
- Timeouts and backoff on rate limits.
- A failed run resumes from its last snapshot.

---

## 5. API
```
GET    /api/careers/search?q=          → matches (code, title, why it matched)
GET    /api/careers/{code}             → CareerProfile
POST   /api/runs                       {code, options, expectations, seed?} → Run (+ Workplace)
GET    /api/runs/{id}                  → run state, current moment, meters, trust
POST   /api/runs/{id}/reply            {choice_id | text}   → SSE: lines, then resolve
POST   /api/runs/{id}/task             {answer}             → review
POST   /api/runs/{id}/pulse            {value}
POST   /api/runs/{id}/advance          → meanwhile events + next moment
POST   /api/runs/{id}/replay           {from_moment} → new Run
POST   /api/runs/{id}/senior           {message}            → SSE reply
GET    /api/runs/{id}/report           → report (cached once generated)
DELETE /api/runs/{id}
GET    /api/compare?runs=a,b           → side-by-side report data
```

---

## 6. Experience design

### 6.1 Feel
**A graphic novel about work.** It's warm, human and specific, and the scene is the hero, not
a dashboard. Everything below is a proposal to react to.
- **Palette (tokens):**
  - paper `#F6F1E7` (background), ink `#1D1B18` (text), ink-soft `#5B554C`, hairline
    `rgba(29,27,24,.12)`
  - accent: terracotta `#BC4C35` for fills, `#A3402B` for small text
  - meanings: sage `#4F6F57` energised, ochre `#8A6212` pressure, slate `#3F5C7D` information
    (darkened in M0 so text passes 4.5:1; `tests/contrast.test.ts` enforces it)
  - a matching dark theme
- **Type:** a characterful serif for scene titles and the report (e.g. Fraunces), Inter for UI,
  and a mono for times and numbers. Self-hosted.
- **Motion:** lines appear one by one after a short typing beat, portraits change expression with
  emotion, and meters ease to new values. Respects reduced motion.

### 6.2 Scene screen (the hero)
- **Top band:** an illustrated backdrop for the location, tinted by time of day, with day and
  time.
- **Middle:** the characters present (portrait, name, role; trust shown on hover/tap), with the
  dialogue column beside or below them.
- **Bottom:** suggested replies plus a text box; a HUD with Mon–Fri progress, energy, job meters
  and the *Ask a senior* button.
- **Must work on a phone as well as a laptop,** because portfolio links get opened on phones.

### 6.3 Art
- **Backdrops:** about 12 location kinds (open office, meeting room, hospital ward, clinic,
  classroom, kitchen, studio, lab, construction site, shop floor, courtroom, outdoors/field,
  home office), drawn as layered SVG in one style and tinted per scene.
- **Portraits:** a deterministic SVG avatar generator (our own, or an open-source one whose art
  licence allows this use) with 4–5 expressions and role-appropriate clothing.
- **No AI image generation in v1** (cost and inconsistency).

### 6.4 Screens
Home / career picker · expectation picker · briefing · scene player · task views (write, rank,
spot-the-error, pick-and-justify) · *Meanwhile* interlude · fit report · senior chat drawer ·
compare · about & sources.

### 6.5 States
Every screen has a designed loading state (a skeleton shaped like the scene), streaming,
error-with-retry and limit-reached state (which offers a recorded week). There are no empty
"No data" pages.

---

## 7. Quality bar
1. **The week is honest:** routine moments exist, and the mix passes the coverage check.
2. Characters sound like **different real people** (not formal letters), and they remember and
   refer back.
3. Suggested replies are **real dilemmas** with no obvious right answer.
4. Report numbers come from the player's taps and real data, show their sample size and cite
   sources.
5. No stereotyped casting, and names fit the setting.
6. Works on phone and laptop; keyboard accessible; text contrast ≥ 4.5:1; reduced motion
   respected.
7. No placeholder content and no default-template look.
8. The first line of a scene appears within ~2 s (streamed).
9. Costs are capped, and the demo never shows a broken page.

---

## 8. Testing
- **Unit (Vitest):**
  - O*NET import and search
  - fit model maths
  - coverage checker
  - meter and trust clamps
  - schema validation
  - cost calculation
  - cache keys
- **FakeLLM:** deterministic, schema-valid responses with seeded variety. All automated tests
  and most UI work use it.
- **Determinism:** the same seed, choices and FakeLLM give an identical event log.
- **Replay:** events before the branch point are identical across the two runs.
- **End-to-end (Playwright, FakeLLM):** pick a career → briefing → play a Quick shift (with a
  task and pulses) → report → replay → compare, at phone and laptop sizes, with screenshots.
- **Quality eval (real model, small, run whenever prompts change):** 10 varied careers, checked
  for schema validity, coverage, cast diversity, and a 1–5 human rating of realism and
  distinctness of voice.

---

## 9. Repository layout
```
LifeAs/
  DESIGN.md  PROGRESS.md  README.md  CLAUDE.md  AGENTS.md
  src/
    app/          routes (pages + api)
    components/   scene, portraits, backdrops, report, charts, controls
    engine/       compiler.ts moment.ts review.ts director.ts fit.ts replay.ts events.ts rng.ts
    llm/          index.ts (interface) claude.ts fake.ts cache.ts cost.ts limits.ts
    db/           index.ts schema.ts migrations/
    lib/          shared helpers (kinds of work, formatting)
  data/onet/      import script + generated/
  scripts/        import-onet, compile-featured, eval
  tests/          Vitest unit tests
  e2e/            Playwright tests
```

---

## 10. Open decisions
| Decision | Proposal | When |
|---|---|---|
| Name | **LifeAs** (decided 2026-10-19) | Done |
| AI provider | Compare candidates on 3 careers | M2 |
| Fast-tier model | Compare quality vs cost | M2 |
| Visual direction | Graphic novel, warm paper (§6.1) | M5 |
| Featured careers | **Decided in M1:** Electrician (Hands-on), Data scientist (Thinking), Graphic designer (Creating), Registered nurse (Helping), Lawyer (Leading), Accountant (Organising); each is its kind's first interest high point in O*NET data | Done |
| Local pay / career-path data | Only with a real source per country; v2 | Later |
