// One small real AI call per tier, to check the credentials, the models and cost tracking.
// Needs a configured provider in .env.local: ANTHROPIC_API_KEY, or the AZURE_AI_* variables
// (see .env.example). Costs a fraction of a cent per tier.
//   npm run llm:smoke
import { z } from "zod";
import { getLLM } from "../src/llm";

const Answer = z.object({ greeting: z.string(), mood: z.enum(["calm", "busy", "tired"]) });

async function main() {
  const llm = getLLM();
  if (llm.provider.name === "fake") {
    console.error("No AI provider configured: set ANTHROPIC_API_KEY or the AZURE_AI_* variables in .env.local first (see .env.example).");
    process.exit(1);
  }
  for (const tier of ["fast", "smart"] as const) {
    const result = await llm.generate({
      tier,
      purpose: "smoke-test",
      system: "You are a coworker in a small design studio. Reply in one short line.",
      messages: [{ role: "user", content: "Morning! How's your day looking?" }],
      schema: Answer,
      maxTokens: 2000,
      seedSalt: new Date().toISOString(),
    });
    console.log(
      `${tier}: ${result.model}${result.fellBack ? " (fallback)" : ""} · $${result.costUsd.toFixed(5)} · ${result.latencyMs} ms`,
    );
    console.log(`  ${JSON.stringify(result.value)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
