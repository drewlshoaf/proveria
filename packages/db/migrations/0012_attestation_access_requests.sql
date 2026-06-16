CREATE TABLE "attestation_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attestation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_by_email" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attestation_access_requests" ADD CONSTRAINT "attestation_access_requests_attestation_id_attestations_id_fk" FOREIGN KEY ("attestation_id") REFERENCES "public"."attestations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attestation_access_requests" ADD CONSTRAINT "attestation_access_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attestation_access_requests" ADD CONSTRAINT "attestation_access_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attestation_access_requests" ADD CONSTRAINT "attestation_access_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "access_requests_attestation_status_idx" ON "attestation_access_requests" USING btree ("attestation_id","status");
--> statement-breakpoint
CREATE INDEX "access_requests_tenant_status_idx" ON "attestation_access_requests" USING btree ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "access_requests_requester_status_idx" ON "attestation_access_requests" USING btree ("requested_by_user_id","status");
