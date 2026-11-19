ALTER TABLE "session" ADD COLUMN "charter" jsonb DEFAULT '{}'::jsonb NOT NULL;
