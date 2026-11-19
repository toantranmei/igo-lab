ALTER TABLE "user_event" ADD COLUMN "person_code" text;
--> statement-breakpoint
ALTER TABLE "user_event" ADD COLUMN "person_group" text;
--> statement-breakpoint
ALTER TABLE "user_event" ADD COLUMN "kind" text DEFAULT 'WRITTEN' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_event" ADD COLUMN "consent_ref" text;
--> statement-breakpoint
ALTER TABLE "user_event" ADD COLUMN "retain_until" text;
--> statement-breakpoint
CREATE TABLE "survey_response" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"respondent_code" text NOT NULL,
	"competency_label" text NOT NULL,
	"importance" integer,
	"discrimination" integer,
	"level" integer,
	"consent_ref" text NOT NULL,
	"retain_until" text,
	"submitted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "survey_session" ON "survey_response" USING btree ("session_id");
--> statement-breakpoint
CREATE TABLE "ai_tool" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"channel" text NOT NULL,
	"account_type" text NOT NULL,
	"retention" text NOT NULL,
	"no_training" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "ai_tool" ("id", "provider", "channel", "account_type", "retention", "no_training", "note") VALUES ('anthropic-claude-cli', 'Anthropic', 'Claude Code CLI (claude -p)', 'Tài khoản Claude của tổ chức đăng nhập trên máy worker', 'Theo điều khoản thương mại của Anthropic cho tài khoản đó; cần pháp chế xác nhận', true, 'Mục mặc định; người quản trị cập nhật theo hợp đồng thực tế.') ON CONFLICT DO NOTHING;
