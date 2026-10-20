CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"purpose" text NOT NULL,
	"run_id" text,
	"input_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"response" jsonb NOT NULL,
	"fell_back" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE INDEX "llm_calls_run_idx" ON "llm_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");