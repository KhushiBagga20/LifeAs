# LifeAs

**Live a week in a job before you choose it.** Pick any career and play through a sped-up work
week, with a boss, coworkers and clients who remember what you did. At the end, see what the
job is really made of and how it suited you.

Status: early build (milestones M0–M1 of 10). See [DESIGN.md](DESIGN.md) for the design and
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

## Job data

Careers come from the O*NET® 31.0 database. The trimmed data the app reads is committed in
`src/data/onet/`, so nothing needs importing to run the app. To rebuild it from a new release:

```bash
mkdir -p .data/onet && curl -L -o .data/onet/db_31_0_json.zip https://www.onetcenter.org/dl_files/database/db_31_0_json.zip
```

```bash
unzip -o .data/onet/db_31_0_json.zip -d .data/onet
```

```bash
npm run onet:import -- .data/onet/db_31_0_json 31.0 "August 2026"
```

`npm run onet:search -- "nurse" "ux designer"` prints the top search results for any query.

## Credits

This project includes information from the
[O*NET 31.0 Database](https://www.onetcenter.org/database.html) by the U.S. Department of
Labor, Employment and Training Administration (USDOL/ETA). Used under the
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license. LifeAs has modified all or
some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.
O*NET® is a trademark of USDOL/ETA.
