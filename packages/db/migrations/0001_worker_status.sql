CREATE TABLE "worker_status" (
	"id" text PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"cli_version" text,
	"message" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
