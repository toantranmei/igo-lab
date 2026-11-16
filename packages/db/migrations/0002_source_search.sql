CREATE TABLE "source_search" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"dataset" text NOT NULL,
	"role" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"progress" text DEFAULT '' NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"locked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
