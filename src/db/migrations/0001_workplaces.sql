CREATE TABLE "workplaces" (
	"id" text PRIMARY KEY NOT NULL,
	"career_code" text NOT NULL,
	"options" jsonb NOT NULL,
	"seed" text NOT NULL,
	"data" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
