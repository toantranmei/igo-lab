CREATE TABLE "agent_call" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text,
	"attempt_id" text,
	"task_id" text NOT NULL,
	"task_key" text NOT NULL,
	"cache_hit" boolean NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"cli_version" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"usage" jsonb,
	"cost_usd" double precision,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "agent_result" (
	"task_key" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"input_canonical" text NOT NULL,
	"output" jsonb NOT NULL,
	"first_call_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"block" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"prev_attempt_id" text,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text,
	"output" jsonb,
	"output_hash" text,
	"gates" jsonb,
	"trace" jsonb,
	"error" jsonb,
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"base_release_id" text,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dict_record" (
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"release_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dict_record_workspace_id_kind_id_version_pk" PRIMARY KEY("workspace_id","kind","id","version")
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"workspace_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"original_name" text NOT NULL,
	"content_sha256" text NOT NULL,
	"blob_sha256" text,
	"normalized_text" text NOT NULL,
	"normalizer_version" text NOT NULL,
	"parser_version" text NOT NULL,
	"segmenter_version" text NOT NULL,
	"segments" jsonb NOT NULL,
	"origin_group" text,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role_id" text,
	"language" text,
	"check_status" text NOT NULL,
	"usage_note" text,
	"source_url" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "document_version_document_id_version_pk" PRIMARY KEY("document_id","version")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text,
	"run_id" text,
	"attempt_id" text,
	"block" text,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text,
	"output_hash" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_event_hash" text,
	"event_hash" text NOT NULL,
	CONSTRAINT "event_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "export_file" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"blob_sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text,
	"severity" text NOT NULL,
	"fingerprint" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_preview" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"digest" text NOT NULL,
	"blob_sha256" text NOT NULL,
	"mode" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jd_set_revision" (
	"jd_set_id" text NOT NULL,
	"revision" integer NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"parent_revision" integer,
	"document_refs" jsonb NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jd_set_revision_jd_set_id_revision_pk" PRIMARY KEY("jd_set_id","revision")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"locked_at" timestamp with time zone,
	"tries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_attempt_id_unique" UNIQUE("attempt_id")
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"data" jsonb NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release" (
	"release_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"seq" integer NOT NULL,
	"parent_release_id" text,
	"version_label" text NOT NULL,
	"run_id" text,
	"candidate_id" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diff" jsonb NOT NULL,
	"members" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"reverts" text,
	"origin" text DEFAULT 'B8' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"role_title" text NOT NULL,
	"role_id" text NOT NULL,
	"family" text,
	"industry" text,
	"purpose" text DEFAULT '' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"label" text NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"submitted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_cursor" (
	"run_id" text NOT NULL,
	"block" text NOT NULL,
	"attempt_id" text NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_cursor_run_id_block_pk" PRIMARY KEY("run_id","block")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stop_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "call_attempt" ON "agent_call" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "call_key" ON "agent_call" USING btree ("task_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_run_block_no" ON "block_attempt" USING btree ("run_id","block","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_run_idem" ON "block_attempt" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "dict_release" ON "dict_record" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "doc_ws_hash" ON "document_version" USING btree ("workspace_id","content_sha256");--> statement-breakpoint
CREATE INDEX "event_run" ON "event" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "event_ws" ON "event" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "jdset_session" ON "jd_set_revision" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_ws_seq" ON "release" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "release_ws_candidate" ON "release" USING btree ("workspace_id","run_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_session_no" ON "run" USING btree ("session_id","run_no");--> statement-breakpoint
CREATE INDEX "session_ws" ON "session" USING btree ("workspace_id");