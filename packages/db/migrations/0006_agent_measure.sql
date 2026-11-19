CREATE TABLE "agent_measure" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"anchor_set" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"measured_by" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_measure_key" ON "agent_measure" USING btree ("task_id","model","prompt_version","measured_at");
