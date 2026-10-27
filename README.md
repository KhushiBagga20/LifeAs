# Block C

**Someone in Block C runs with a crew. Find them before they run the block.**

A social-deduction game (the Mafia / Werewolf family) set in a modern apartment block, for 5–12
players. Play online with friends; AI neighbours fill the empty seats with their own
personalities, hunches and lies, and an AI narrator tells the story of every night.

Status: early build on the `mafia` branch. See [DESIGN.md](DESIGN.md) for the design and
[PROGRESS.md](PROGRESS.md) for where things stand. The earlier LifeAs career simulator is on the
`main` and `lifeas` branches.

## Run it

Requires Node 24 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. No database setup is needed: without `DATABASE_URL` the app uses an
embedded PGlite database in `.data/blockc`.

## AI neighbours and narrator

Without AI configuration the game uses FakeLLM: template chat and narration that need no key.
For real AI voices, copy `.env.example` to `.env.local` and set the `AZURE_AI_*` variables
(an Azure / Microsoft Foundry deployment, with its prices for the spending caps) or
`ANTHROPIC_API_KEY`. Check it with one small call per tier:

```bash
npm run llm:smoke
```

## Test it

```bash
npm run check
```

```bash
npx playwright install chromium
npm run e2e
```
