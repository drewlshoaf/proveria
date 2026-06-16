CREATE TABLE "oidc_identity_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"issuer_url" text NOT NULL,
	"authorization_endpoint" text NOT NULL,
	"token_endpoint" text NOT NULL,
	"jwks_uri" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_ref" text,
	"scopes" jsonb DEFAULT '["openid","email","profile"]'::jsonb NOT NULL,
	"claim_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"claims" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oidc_auth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"code_verifier" text NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_provider_id_oidc_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_identity_providers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oidc_auth_states" ADD CONSTRAINT "oidc_auth_states_provider_id_oidc_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_identity_providers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identity_providers_slug_idx" ON "oidc_identity_providers" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "oidc_identity_providers_enabled_idx" ON "oidc_identity_providers" USING btree ("enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_provider_subject_idx" ON "external_identities" USING btree ("provider_id","provider_subject");
--> statement-breakpoint
CREATE INDEX "external_identities_user_provider_idx" ON "external_identities" USING btree ("user_id","provider_id","disconnected_at");
--> statement-breakpoint
CREATE INDEX "external_identities_email_idx" ON "external_identities" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_auth_states_state_hash_idx" ON "oidc_auth_states" USING btree ("state_hash");
--> statement-breakpoint
CREATE INDEX "oidc_auth_states_provider_active_idx" ON "oidc_auth_states" USING btree ("provider_id","expires_at","consumed_at");
