ALTER TABLE "worker_status" ADD COLUMN "breaker" jsonb;
--> statement-breakpoint
ALTER TABLE "block_attempt" ADD COLUMN "started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "block_attempt" ADD COLUMN "finished_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "run_auto" ADD COLUMN "stop" jsonb;
--> statement-breakpoint
CREATE TABLE "trace_event" (
	"attempt_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "trace_event_pk" PRIMARY KEY("attempt_id","seq")
);
--> statement-breakpoint
CREATE TABLE "calc_record" (
	"attempt_id" text NOT NULL,
	"seq" integer NOT NULL,
	"step" text NOT NULL,
	"substep" text NOT NULL,
	"item_ref" text,
	"formula" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"output" jsonb,
	"decision" text,
	"seat" text,
	CONSTRAINT "calc_record_pk" PRIMARY KEY("attempt_id","seq")
);
--> statement-breakpoint
CREATE INDEX "calc_record_substep" ON "calc_record" USING btree ("attempt_id","substep");
