ALTER TABLE "attestation_access_grants" ALTER COLUMN "granted_to_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attestation_access_grants" ADD COLUMN "granted_to_email" text;--> statement-breakpoint
UPDATE "attestation_access_grants" g
  SET "granted_to_email" = u."email"
  FROM "users" u
  WHERE g."granted_to_user_id" = u."id" AND g."granted_to_email" IS NULL;--> statement-breakpoint
ALTER TABLE "attestation_access_grants" ALTER COLUMN "granted_to_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attestation_access_grants" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "attestation_access_grants" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "grants_token_hash_idx" ON "attestation_access_grants" USING btree ("token_hash");
