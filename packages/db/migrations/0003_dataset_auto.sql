CREATE TABLE "source_dataset" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"progress" text DEFAULT '' NOT NULL,
	"info" jsonb,
	"error" jsonb,
	"locked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_auto" (
	"run_id" text PRIMARY KEY NOT NULL,
	"on" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
