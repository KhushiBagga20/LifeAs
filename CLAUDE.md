@AGENTS.md

# LifeAs

A career simulator: play a sped-up work week in any job, then see what the job is really made of.

- **Read first:** `DESIGN.md` (the design, the source of truth) and `PROGRESS.md` (milestones,
  decisions, log). Continue from the first unfinished milestone. Record non-obvious choices
  under *Decisions* in PROGRESS.md and add a log line when a milestone moves.
- **Stack:** Next.js 16 (App Router, Cache Components on), TypeScript strict, Tailwind v4 with
  our own tokens in `src/app/globals.css` (the default palette is off, so use `bg-paper`,
  `text-ink`, `text-ink-soft`, `border-line`, `text-accent-ink`, …), Drizzle on Postgres.
- **Database:** with `DATABASE_URL` set, Postgres. Without it, embedded PGlite in `.data/pglite`.
  Tests use `createDatabase({ url: "", pgliteDir: "memory://" })`.
- **AI calls:** only through `getLLM().generate({ tier, purpose, system, messages, schema })` in
  `src/llm`. Providers: Claude (`ANTHROPIC_API_KEY`), Azure (`AZURE_AI_ENDPOINT`,
  `AZURE_AI_API_KEY`, `AZURE_AI_DEPLOYMENT` plus `AZURE_AI_PRICE_*`), or FakeLLM when neither is
  set; `LLM_PROVIDER` forces one. Server-side env only, never `NEXT_PUBLIC_`. Tests always use
  FakeLLM or a scripted provider/fetch, never a real one. AI output schemas use `.nullable()`,
  not `.optional()` (strict JSON schema can't express optional fields). Register realistic fakes
  per purpose with `FakeProvider.register`.

## Git
- Work on a branch per milestone (e.g. `m2/ai-layer`). When the milestone's tests pass, fast-forward
  `main`, commit, and push to `origin` (github.com/KhushiBagga20/LifeAs) without asking.
- Commits are the owner's only: no `Co-Authored-By` trailer or other Claude attribution.

## Commands
- `npm run dev` starts the app at http://localhost:3000 (preview config: `.claude/launch.json`, name `web`)
- `npm run check` runs lint, the type check and the unit tests
- `npm run e2e` runs the Playwright tests at laptop and phone sizes (screenshots go to `qa/screens/`)
- `npm run build` creates a production build
- `npm run llm:smoke` makes one real AI call per tier with the configured provider (`.env.local`)
- `npm run db:generate` creates a migration after changing `src/db/schema.ts`
- `npm run eval:compiler` compiles the featured six + a diverse sample and reports problems
  (`-- --all`: every career, both lengths, FakeLLM only)
- `npm run compile:featured` compiles the featured careers with the real model into `src/data/workplaces/`

## Rules
- Never mark a milestone done with failing tests, and never weaken a test to make it pass.
- Every screen must work at phone width (390 px) and laptop width (1280 px) with no sideways scroll.
- Text colours must pass 4.5:1 contrast; `tests/contrast.test.ts` checks the tokens.
- No placeholder content. Copy and data are real, or the feature waits.
- The engine owns the truth: AI output is a proposal that code validates before any state
  changes. Workplaces must pass `validateWorkplace`; occupational structure comes from O*NET
  and code, never from the model alone.
