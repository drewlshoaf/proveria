CREATE TABLE "verification_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" text NOT NULL,
	"attestation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"looked_up_by_user_id" uuid,
	"result_type" text NOT NULL,
	"submitted_hash" text NOT NULL,
	"result_object_key" text NOT NULL,
	"signed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_results_package_id_unique" UNIQUE("package_id")
);
--> statement-breakpoint
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_attestation_id_attestations_id_fk" FOREIGN KEY ("attestation_id") REFERENCES "public"."attestations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_looked_up_by_user_id_users_id_fk" FOREIGN KEY ("looked_up_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_results_attestation_idx" ON "verification_results" USING btree ("attestation_id");--> statement-breakpoint
CREATE INDEX "verification_results_user_time_idx" ON "verification_results" USING btree ("looked_up_by_user_id","created_at");