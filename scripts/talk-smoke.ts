// A few real AI lines in a real room: the narrator's opening and first dawn, and AI neighbours
// talking on day one, with the configured provider. Prints the story and what it cost.
// Needs a provider in .env.local (see .env.example). Costs a few cents.
//   npm run talk:smoke
import { createDatabase } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";
import { getLLM, type LLM } from "../src/llm";
import { actInRoom, createRoom, pollRoom, rawEvents, startGame } from "../src/rooms/service";
import { runTalk } from "../src/rooms/talk";

async function main() {
  let real: LLM;
  try {
    real = getLLM();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (real.provider.name === "fake") {
    console.error("No AI provider configured: set the AZURE_AI_* variables (or ANTHROPIC_API_KEY) in .env.local first.");
    process.exit(1);
  }
  let spent = 0;
  const calls: string[] = [];
  const llm: LLM = {
    provider: real.provider,
    async generate(request) {
      try {
        const result = await real.generate(request);
        spent += result.costUsd;
        calls.push(`${request.purpose}: ok in ${result.latencyMs} ms, $${result.costUsd.toFixed(4)}`);
        return result;
      } catch (error) {
        calls.push(`${request.purpose}: FAILED (${error instanceof Error ? error.message.slice(0, 160) : error})`);
        throw error;
      }
    },
  };

  const db = createDatabase({ url: "", pgliteDir: "memory://" });
  await migrateDatabase(db);
  const clock = { now: Date.now() };
  const deps = { db, clock: () => clock.now, llm };
  const host = await createRoom(deps, { name: "Khushi", settings: { seats: 7, pace: "normal" } });
  await startGame(deps, host.code, host.token);
  let mentioned = false;
  // Reveal, night, dawn and the first 40 seconds of the day, a second and a half at a time.
  for (let t = 0; t < 8_000 + 30_000 + 10_000 + 40_000; t += 1_500) {
    clock.now += 1_500;
    const poll = await pollRoom(deps, host.code, host.token);
    if (poll.view?.phase === "day" && !mentioned && poll.view.me?.alive) {
      const ai = Object.entries(poll.profiles).find(([id, p]) => p.kind === "ai" && poll.view!.seats.find((s) => s.id === id)?.alive);
      if (ai) await actInRoom(deps, host.code, host.token, { type: "chat", text: `${ai[1].name}, you went very quiet after that. Where were you last night?` });
      mentioned = true;
    }
    await runTalk(deps, host.code);
    if (poll.status === "ended") break;
  }

  const events = await rawEvents(deps, host.code);
  const seats = events[0].data.seats as { id: string; name: string }[];
  const name = Object.fromEntries(seats.map((s) => [s.id, s.name]));
  console.log(`Room ${host.code}, provider ${real.provider.name} (${real.provider.modelFor("fast")})\n`);
  for (const e of events) {
    if (e.kind === "narration") console.log(`  NARRATOR: ${e.text}`);
    if (e.kind === "chat") console.log(`  ${name[e.actor!]}: ${e.text}`);
    if (e.kind === "phase") console.log(`-- ${e.data.phase}`);
    if (e.kind === "night-out") console.log(`  (${name[e.target!]} is out)`);
  }
  console.log(`\nCalls:\n  ${calls.join("\n  ")}\nSpent: $${spent.toFixed(4)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
