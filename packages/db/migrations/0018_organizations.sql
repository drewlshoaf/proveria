CREATE TYPE "public"."organization_role" AS ENUM('organization_admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."workspace_access_mode" AS ENUM('all_workspaces', 'selected_workspaces', 'none');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_role" "organization_role" DEFAULT 'member' NOT NULL,
	"workspace_access_mode" "workspace_access_mode" DEFAULT 'selected_workspaces' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE TEMP TABLE "tenant_organization_backfill" (
	"tenant_id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
INSERT INTO "tenant_organization_backfill" ("tenant_id", "organization_id")
SELECT "id", gen_random_uuid()
FROM "tenants"
WHERE "organization_id" IS NULL;
--> statement-breakpoint
INSERT INTO "organizations" ("id", "name", "created_at", "updated_at")
SELECT
	"tenant_organization_backfill"."organization_id",
	"tenants"."name",
	"tenants"."created_at",
	"tenants"."updated_at"
FROM "tenant_organization_backfill"
INNER JOIN "tenants" ON "tenants"."id" = "tenant_organization_backfill"."tenant_id";
--> statement-breakpoint
UPDATE "tenants"
SET "organization_id" = "tenant_organization_backfill"."organization_id"
FROM "tenant_organization_backfill"
WHERE "tenants"."id" = "tenant_organization_backfill"."tenant_id";
--> statement-breakpoint
INSERT INTO "organization_memberships" (
	"organization_id",
	"user_id",
	"org_role",
	"workspace_access_mode",
	"created_at",
	"updated_at"
)
SELECT DISTINCT
	"tenant_organization_backfill"."organization_id",
	"tenant_memberships"."user_id",
	CASE
		WHEN "tenant_memberships"."role" = 'tenant_admin' THEN 'organization_admin'::"organization_role"
		ELSE 'member'::"organization_role"
	END,
	'selected_workspaces'::"workspace_access_mode",
	"tenant_memberships"."created_at",
	"tenant_memberships"."created_at"
FROM "tenant_organization_backfill"
INNER JOIN "tenant_memberships"
	ON "tenant_memberships"."tenant_id" = "tenant_organization_backfill"."tenant_id"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
--> statement-breakpoint
DROP TABLE "tenant_organization_backfill";--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tenants_organization_idx" ON "tenants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_access_idx" ON "organization_memberships" USING btree ("organization_id","workspace_access_mode","revoked_at");
