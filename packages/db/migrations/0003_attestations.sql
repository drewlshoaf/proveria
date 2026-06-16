CREATE TABLE "attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_by_user_id" uuid NOT NULL,
	"created_by_device_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"confirmed_attempt_id" uuid,
	"manifest_object_key" text,
	"leaves_object_key" text,
	"receipt_json_object_key" text,
	"receipt_pdf_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "submission_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attestation_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"manifest_object_key" text,
	"validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_created_by_device_id_devices_id_fk" FOREIGN KEY ("created_by_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_attempts" ADD CONSTRAINT "submission_attempts_attestation_id_attestations_id_fk" FOREIGN KEY ("attestation_id") REFERENCES "public"."attestations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attestations_project_label_idx" ON "attestations" USING btree ("project_id","label");--> statement-breakpoint
CREATE INDEX "attestations_tenant_state_idx" ON "attestations" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "attestations_project_idx" ON "attestations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "submission_attempts_attestation_idx" ON "submission_attempts" USING btree ("attestation_id");--> statement-breakpoint
CREATE INDEX "submission_attempts_attestation_state_idx" ON "submission_attempts" USING btree ("attestation_id","state");