ALTER TABLE "api_keys" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_method" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_path" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_status_code" integer;
