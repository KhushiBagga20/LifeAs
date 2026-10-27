# LifeAs

**Step into the job.** Control a character in a 3D workplace, use the tools, make something,
and work alongside characters with their own goals.

The current prototype is **Fieldwork Studio**, a small graphic-design workplace built with
Three.js. Open [the studio](http://localhost:3000/play) after starting the app.

```bash
npm install
npm run dev
```

Requires Node 24+. No account, database configuration or AI key is needed to explore the studio.

## Play

- **WASD / arrow keys:** walk. **E:** interact with a nearby station or character.
- **Click the floor:** walk there. **Click an object or character:** approach and interact.
- **Scroll:** zoom. The objective's **Walk there** button navigates to the next work area.
- Collect the brief, walk to the workstation, drag and resize the poster's text, carry the
  draft to the review wall, print it, pick up the proof, and deliver it to the client lounge.
- The poster you edit is rendered onto objects in the 3D world. Layout feedback checks
  hierarchy, reading order, booking size and overlap.
- Three visible coworkers move around the studio. Click their characters or portraits to
  approach and talk. Conversations cut to the speaking character with the actual studio behind
  them, animated speech, short dialogue beats and replies along the bottom. Use Continue to
  advance a longer line. Escape returns to
  walking. Other coworkers continue working. Reduced motion disables the camera/text animation.

The previous questionnaire pilot has been removed. Its URL redirects to `/play`.
This is an early spatial prototype: one workplace, procedural character art, no run persistence,
and a constrained poster-layout tool. It is not yet a complete simulation of the profession.

## The first day has consequences

The work clock starts at 09:00. The client’s volunteer leaves with the posters at 10:00.
Work actions show their time cost; reading and walking do not consume the clock.

At the first review the venue changes. Choose how to resolve the uncertainty, then physically
return to your workstation and save a corrected draft. The first print attempt has a jam to
inspect and clear. Revisions take time; ask Sam for an extension if you need it. The ending
reflects the actual proof, its layout issues and whether you met the agreed departure. A rejected
proof can be corrected. Printed artwork is frozen until you make another print.

These story events are authored and state-driven. A configured model can react to them through
each character’s own perspective; it cannot invent a completed repair or change the deadline.

## Character agents

Each of Maya (creative direction), Alex (production), and Sam (client) has a separate identity,
goal, and bounded memory. They observe recent shared world events, choose a destination, and
speak. Decisions are requested in rotating turns every 18 seconds; direct conversation requests
an additional turn. Movement and artifact state remain deterministic code.

Without a provider key, **local behaviour mode** supplies explicit scripted guidance and
movement. It is labelled in the UI. Free-form dialogue and model-directed decisions need a real
provider: copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`, or the documented
`AZURE_AI_*` settings and prices. `LLM_PROVIDER` can select a provider explicitly. Keys stay on
the server. Check a configured provider with `npm run llm:smoke`.

Agent sessions are held in server memory for one hour, with separate memory per character,
a one-request-at-a-time guard, a minimum interval between requests, and 24 model generation
requests per session. The existing AI layer also applies configured run/daily caps. If a
provider fails, the UI identifies the fallback. These process-local sessions and limits need a
shared persistent store before multi-instance deployment. The pre-existing AI cost ledger
still needs concurrency/failed-attempt accounting hardening before a public paid launch.

## Verify

```bash
npm run check
npm run e2e
```

Unit tests cover career data, compiler/providers, pathfinding around furniture, layout reviews,
and independent character memory. Browser tests exercise physical traversal and the complete
poster handoff at phone and laptop sizes. E2E starts a production build and requires Chromium
(`npx playwright install chromium`). Google fonts are downloaded at build time.

## Occupational data and existing foundations

The career explorer at `/careers`, O*NET import pipeline, compiler and AI adapters are retained
as foundations for future workplaces. The committed O*NET data covers 923 occupations. The 3D
studio is currently authored; the compiler does not yet generate arbitrary 3D environments.
The studio's client, characters and event are fictional. Its tasks reference O*NET graphic-design
tasks #300, #304, #305 and #23970. O*NET interest shares are not working-time percentages.

Without `DATABASE_URL`, AI/compiler storage uses embedded PGlite in `.data/pglite`. Set
`DATABASE_URL` for hosted Postgres. See `.env.example` for configuration.

## Credits

This project includes information from the [O*NET 31.0 Database](https://www.onetcenter.org/database.html)
by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). LifeAs has modified some information.
USDOL/ETA has not approved, endorsed, or tested these modifications. O*NET® is a trademark of
USDOL/ETA. The studio's 3D assets are generated in code; no third-party character assets are used.
