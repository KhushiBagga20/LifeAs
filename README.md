# LifeAs

**Live a week in a job before you choose it.** Pick any career and play through a sped-up work
week, with a boss, coworkers and clients who remember what you did. At the end, see what the
job is really made of and how it suited you.

Status: early build (milestone M0 of 10). See [DESIGN.md](DESIGN.md) for the design and
[PROGRESS.md](PROGRESS.md) for where things stand.

## Run it

Requires Node 24 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. No database setup is needed: without `DATABASE_URL` the app uses an
embedded PGlite database in `.data/pglite`. To use Postgres instead, copy `.env.example` to
`.env.local` and set `DATABASE_URL`.

## Test it

```bash
npm run check
```

```bash
npx playwright install chromium
npm run e2e
```

`check` runs lint, the type check and the unit tests. `e2e` runs the browser tests at laptop
and phone sizes.

## Credits

Job data will come from O*NET (US Department of Labor), used under CC BY 4.0.
