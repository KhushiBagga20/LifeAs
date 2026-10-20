import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { llmCalls } from "@/db/schema";
import type { Usage } from "./types";

// Where AI calls are cached and their cost is logged: Postgres in the app, memory in tests.

export type StoredCall = {
  cacheKey: string;
  provider: string;
  model: string;
  tier: string;
  purpose: string;
  runId: string | null;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  output: unknown;
  fellBack: boolean;
  /** Only successful answers are served from the cache. */
  cacheable: boolean;
};

export interface CallStore {
  lookup(cacheKey: string): Promise<StoredCall | null>;
  record(call: StoredCall): Promise<void>;
  spentSince(since: Date): Promise<number>;
  spentForRun(runId: string): Promise<number>;
}

export class MemoryCallStore implements CallStore {
  readonly calls: (StoredCall & { at: Date })[] = [];

  async lookup(cacheKey: string) {
    return this.calls.find((c) => c.cacheKey === cacheKey && c.cacheable) ?? null;
  }
  async record(call: StoredCall) {
    this.calls.push({ ...call, at: new Date() });
  }
  async spentSince(since: Date) {
    return this.calls.filter((c) => c.at >= since).reduce((n, c) => n + c.costUsd, 0);
  }
  async spentForRun(runId: string) {
    return this.calls.filter((c) => c.runId === runId).reduce((n, c) => n + c.costUsd, 0);
  }
}

export class DbCallStore implements CallStore {
  constructor(private readonly db: () => Promise<Database>) {}

  async lookup(cacheKey: string): Promise<StoredCall | null> {
    const db = await this.db();
    const [row] = await db.select().from(llmCalls).where(eq(llmCalls.cacheKey, cacheKey)).limit(1);
    if (!row) return null;
    return {
      cacheKey: row.cacheKey,
      provider: row.provider,
      model: row.model,
      tier: row.tier,
      purpose: row.purpose,
      runId: row.runId,
      usage: {
        inputTokens: row.inputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
      },
      costUsd: row.costUsd,
      latencyMs: row.latencyMs,
      output: row.response,
      fellBack: row.fellBack,
      cacheable: true,
    };
  }

  async record(call: StoredCall): Promise<void> {
    const db = await this.db();
    // Failed attempts are logged for cost under a key that is never looked up.
    const cacheKey = call.cacheable ? call.cacheKey : `${call.cacheKey}:failed:${Date.now()}:${Math.random()}`;
    await db
      .insert(llmCalls)
      .values({
        cacheKey,
        provider: call.provider,
        model: call.model,
        tier: call.tier,
        purpose: call.purpose,
        runId: call.runId,
        inputTokens: call.usage.inputTokens,
        cacheReadTokens: call.usage.cacheReadTokens,
        cacheWriteTokens: call.usage.cacheWriteTokens,
        outputTokens: call.usage.outputTokens,
        costUsd: call.costUsd,
        latencyMs: call.latencyMs,
        response: call.output ?? null,
        fellBack: call.fellBack,
      })
      .onConflictDoNothing({ target: llmCalls.cacheKey });
  }

  async spentSince(since: Date): Promise<number> {
    const db = await this.db();
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, since));
    return Number(row?.total ?? 0);
  }

  async spentForRun(runId: string): Promise<number> {
    const db = await this.db();
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(and(eq(llmCalls.runId, runId)));
    return Number(row?.total ?? 0);
  }
}
