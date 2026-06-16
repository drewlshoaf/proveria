ALTER TABLE "submission_attempts" ADD COLUMN "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
