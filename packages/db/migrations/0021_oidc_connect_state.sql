ALTER TABLE "oidc_auth_states" ADD COLUMN "flow" text DEFAULT 'sign_in' NOT NULL;
--> statement-breakpoint
ALTER TABLE "oidc_auth_states" ADD COLUMN "connect_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "oidc_auth_states" ADD CONSTRAINT "oidc_auth_states_connect_user_id_users_id_fk" FOREIGN KEY ("connect_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
