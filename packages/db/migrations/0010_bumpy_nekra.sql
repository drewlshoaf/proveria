CREATE TABLE "audit"."audit_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_seq" integer NOT NULL,
	"last_seq" integer NOT NULL,
	"merkle_root" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_event_hash_chain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"sequence_num" integer NOT NULL,
	"prev_hash" text NOT NULL,
	"this_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit"."audit_checkpoints" ADD CONSTRAINT "audit_checkpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."audit_checkpoints" ADD CONSTRAINT "audit_checkpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."audit_event_hash_chain" ADD CONSTRAINT "audit_event_hash_chain_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."audit_event_hash_chain" ADD CONSTRAINT "audit_event_hash_chain_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "audit"."audit_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_checkpoints_tenant_time_idx" ON "audit"."audit_checkpoints" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_tenant_seq_idx" ON "audit"."audit_event_hash_chain" USING btree ("tenant_id","sequence_num");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_event_idx" ON "audit"."audit_event_hash_chain" USING btree ("event_id");