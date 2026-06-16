// Resolve a workspace by slug + the caller's access to it.
// Returns null when either the tenant doesn't exist or the user isn't a
// member/admin — callers translate both cases to 404 to avoid leaking
// existence.

import { and, eq } from 'drizzle-orm';
import {
  organizationMemberships,
  tenantMemberships,
  tenants,
  type DrizzleClient,
  type Tenant,
  type TenantMembership,
  type User,
} from '@proveria/db';

export interface TenantContext {
  tenant: Tenant;
  membership: TenantMembership;
}

export const resolveTenantContext = async (
  db: DrizzleClient,
  user: User,
  slug: string,
): Promise<TenantContext | null> => {
  const tenantRows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return null;

  if (tenant.organizationId) {
    const [organizationMembership] = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, tenant.organizationId),
          eq(organizationMemberships.userId, user.id),
        ),
      )
      .limit(1);
    if (
      !organizationMembership ||
      organizationMembership.revokedAt ||
      organizationMembership.workspaceAccessMode === 'none'
    ) {
      return null;
    }

    if (
      organizationMembership.workspaceAccessMode === 'all_workspaces' ||
      organizationMembership.orgRole === 'organization_admin'
    ) {
      const [membership] = await db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, tenant.id),
            eq(tenantMemberships.userId, user.id),
          ),
        )
        .limit(1);
      return {
        tenant,
        membership:
          membership ??
          ({
            tenantId: tenant.id,
            userId: user.id,
            role:
              organizationMembership.orgRole === 'organization_admin'
                ? 'tenant_admin'
                : 'producer',
            createdAt: organizationMembership.createdAt,
          } satisfies TenantMembership),
      };
    }
  }

  const membershipRows = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenant.id),
        eq(tenantMemberships.userId, user.id),
      ),
    )
    .limit(1);
  const membership = membershipRows[0];
  if (!membership) return null;

  return { tenant, membership };
};
