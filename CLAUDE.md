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
- **AI calls:** only through the `src/llm` layer once it exists (M2). Tests and most UI work use
  FakeLLM, never a real provider.

## Commands
- `npm run dev` starts the app at http://localhost:3000 (preview config: `.claude/launch.json`, name `web`)
- `npm run check` runs lint, the type check and the unit tests
- `npm run e2e` runs the Playwright tests at laptop and phone sizes (screenshots go to `qa/screens/`)
- `npm run build` creates a production build

## Rules
- Never mark a milestone done with failing tests, and never weaken a test to make it pass.
- Every screen must work at phone width (390 px) and laptop width (1280 px) with no sideways scroll.
- Text colours must pass 4.5:1 contrast; `tests/contrast.test.ts` checks the tokens.
- No placeholder content. Copy and data are real, or the feature waits.
