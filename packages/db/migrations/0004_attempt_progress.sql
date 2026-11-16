CREATE TABLE "attempt_progress" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"steps" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
