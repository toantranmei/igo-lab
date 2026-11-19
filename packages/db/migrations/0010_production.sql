CREATE TABLE "production_item" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"role_title" text NOT NULL,
	"level" text,
	"industry" text,
	"framework_type" text NOT NULL,
	"root_item_id" text,
	"session_id" text,
	"audit_sampled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "production_batch" ON "production_item" USING btree ("workspace_id","batch_id");
