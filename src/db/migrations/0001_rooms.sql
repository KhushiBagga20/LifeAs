CREATE TABLE "room_events" (
	"room_code" text NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "room_events_room_code_seq_pk" PRIMARY KEY("room_code","seq")
);
--> statement-breakpoint
CREATE TABLE "room_seats" (
	"room_code" text NOT NULL,
	"seat_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_seats_room_code_seat_id_pk" PRIMARY KEY("room_code","seat_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"settings" jsonb NOT NULL,
	"host_seat" text NOT NULL,
	"seed" text NOT NULL,
	"state" jsonb,
	"meta" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
