ALTER TABLE "export_jobs" ADD COLUMN "progress_percent" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "max_retries" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "retention_policy" jsonb DEFAULT '{"retention_days":30,"delete_after_expiration":false}'::jsonb NOT NULL;
