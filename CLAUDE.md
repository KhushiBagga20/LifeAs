@AGENTS.md

# Block C

A social-deduction (Mafia) game in a modern apartment block: online rooms with friends, AI
neighbours in the empty seats, an AI narrator, a low-poly 3D courtyard.

- **Read first:** `DESIGN.md` (the design, the source of truth) and `PROGRESS.md` (milestones,
  decisions, log). Continue from the first unfinished milestone. Record non-obvious choices
  under *Decisions* in PROGRESS.md and add a log line when a milestone moves.
- **Stack:** Next.js 16 (App Router, Cache Components on), TypeScript strict, Tailwind v4 with
  our own tokens in `src/app/globals.css` (default palette off: `bg-bg`, `bg-surface`,
  `text-text`, `text-soft`, `border-line`, `text-amber`, `text-crew`, `text-block`, …), Drizzle
  on Postgres, three.js for the courtyard.
- **Database:** with `DATABASE_URL` set, Postgres. Without it, embedded PGlite in `.data/blockc`.
  Tests use `createDatabase({ url: "", pgliteDir: "memory://" })`.
- **AI calls:** only through `getLLM().generate({ tier, purpose, system, messages, schema })` in
  `src/llm`. Providers: Azure (`AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY`, `AZURE_AI_DEPLOYMENT`,
  `AZURE_AI_PRICE_*`), Claude (`ANTHROPIC_API_KEY`), or FakeLLM when neither is set;
  `LLM_PROVIDER` forces one. Server-side env only, never `NEXT_PUBLIC_`. Tests always use FakeLLM
  or a scripted provider/fetch. AI output schemas use `.nullable()`, not `.optional()`.

## Git
- Work happens on the `mafia` branch (`main` holds the old LifeAs app, `lifeas` the archive with
  its 3D trial). When a milestone's tests pass, commit and push `mafia` to `origin`
  (github.com/KhushiBagga20/LifeAs) without asking.
- Commits are the owner's only: no `Co-Authored-By` trailer or other Claude attribution.

## Commands
- `npm run dev` starts the app at http://localhost:3000 (preview config: `.claude/launch.json`, name `web`)
- `npm run check` runs lint, the type check and the unit tests
- `npm run e2e` runs the Playwright tests at laptop and phone sizes (screenshots go to `qa/screens/`)
- `npm run build` creates a production build
- `npm run llm:smoke` makes one real AI call per tier with the configured provider (`.env.local`)
- `npm run db:generate` creates a migration after changing `src/db/schema.ts`

## Rules
- The server owns the game. Clients send intents; the engine validates them against the rules
  and the phase. AI output is a proposal that code validates; AI brains (night actions, votes)
  are code.
- No information leaks: every view a client or an AI prompt gets is built from the event log
  filtered by what that seat may know. Test it.
- Never mark a milestone done with failing tests, and never weaken a test to make it pass.
- Every screen works at phone width (390 px) and laptop width (1280 px) with no sideways scroll.
- Text colours pass 4.5:1 contrast; `tests/contrast.test.ts` checks the tokens.
- Keep it non-graphic: people are "taken out", never described in gory detail.
