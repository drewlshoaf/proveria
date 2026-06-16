import { createClient } from '@proveria/db';

import { hashPassword } from '../src/auth/passwords.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';

const email =
  process.env.PROVERIA_EVAL_PRODUCER_EMAIL ?? 'producer-eval@example.com';
const password =
  process.env.PROVERIA_EVAL_PRODUCER_PASSWORD ??
  'producer-eval-password-123';
const verifierEmail =
  process.env.PROVERIA_EVAL_VERIFIER_EMAIL ?? 'verifier-eval@example.com';
const verifierPassword =
  process.env.PROVERIA_EVAL_VERIFIER_PASSWORD ??
  'verifier-eval-password-123';
const adminEmail =
  process.env.PROVERIA_EVAL_ADMIN_EMAIL ?? 'admin-producer-eval@example.com';
const adminPassword =
  process.env.PROVERIA_EVAL_ADMIN_PASSWORD ??
  'admin-producer-eval-password-123';
const memberPassword =
  process.env.PROVERIA_EVAL_MEMBER_PASSWORD ??
  'evaluation-member-password-123';
const displayName =
  process.env.PROVERIA_EVAL_PRODUCER_NAME ?? 'Evaluation Producer';
const verifierDisplayName =
  process.env.PROVERIA_EVAL_VERIFIER_NAME ?? 'Evaluation Verifier';
const adminDisplayName =
  process.env.PROVERIA_EVAL_ADMIN_NAME ?? 'Evaluation Admin Producer';
const workspaceName =
  process.env.PROVERIA_EVAL_WORKSPACE_NAME ?? 'Evaluation Workspace';
const workspaceSlug =
  process.env.PROVERIA_EVAL_WORKSPACE_SLUG ?? 'evaluation-workspace';
const projectName =
  process.env.PROVERIA_EVAL_PROJECT_NAME ?? 'Evaluation Evidence';
const projectSlug =
  process.env.PROVERIA_EVAL_PROJECT_SLUG ?? 'evaluation-evidence';
const additionalUsers = [
  {
    email: 'legal-reviewer-eval@example.com',
    displayName: 'Evaluation Legal Reviewer',
    orgRole: 'member',
    workspaceAccessMode: 'selected_workspaces',
    memberships: [
      { slug: workspaceSlug, role: 'producer' },
      { slug: 'evaluation-legal-workspace', role: 'producer' },
    ],
    devices: [
      {
        profileId: '10000000-0000-4000-8000-000000000001',
        publicKey: 'seedLegalReviewerPublicKey00000000000000001',
        name: 'Legal review laptop',
        platform: 'darwin',
        appVersion: '0.5.0',
        revoked: false,
      },
    ],
  },
  {
    email: 'finance-admin-eval@example.com',
    displayName: 'Evaluation Finance Admin',
    orgRole: 'member',
    workspaceAccessMode: 'selected_workspaces',
    memberships: [
      { slug: 'evaluation-finance-workspace', role: 'tenant_admin' },
    ],
    devices: [
      {
        profileId: '10000000-0000-4000-8000-000000000002',
        publicKey: 'seedFinanceAdminPublicKey000000000000000002',
        name: 'Finance admin desktop',
        platform: 'win32',
        appVersion: '0.5.0',
        revoked: false,
      },
      {
        profileId: '10000000-0000-4000-8000-000000000003',
        publicKey: 'seedFinanceOldPublicKey0000000000000000003',
        name: 'Finance retired laptop',
        platform: 'darwin',
        appVersion: '0.4.0',
        revoked: true,
      },
    ],
  },
  {
    email: 'research-producer-eval@example.com',
    displayName: 'Evaluation Research Producer',
    orgRole: 'member',
    workspaceAccessMode: 'selected_workspaces',
    memberships: [
      { slug: 'evaluation-research-workspace', role: 'producer' },
    ],
    devices: [
      {
        profileId: '10000000-0000-4000-8000-000000000004',
        publicKey: 'seedResearchProducerPublicKey0000000000004',
        name: 'Research workstation',
        platform: 'darwin',
        appVersion: '0.5.0',
        revoked: false,
      },
    ],
  },
  {
    email: 'compliance-member-eval@example.com',
    displayName: 'Evaluation Compliance Member',
    orgRole: 'member',
    workspaceAccessMode: 'selected_workspaces',
    memberships: [
      { slug: 'evaluation-compliance-workspace', role: 'producer' },
    ],
    devices: [],
  },
  {
    email: 'org-admin-eval@example.com',
    displayName: 'Evaluation Organization Admin',
    orgRole: 'organization_admin',
    workspaceAccessMode: 'all_workspaces',
    memberships: [
      { slug: workspaceSlug, role: 'tenant_admin' },
      { slug: 'evaluation-legal-workspace', role: 'tenant_admin' },
      { slug: 'evaluation-finance-workspace', role: 'tenant_admin' },
      { slug: 'evaluation-research-workspace', role: 'tenant_admin' },
      { slug: 'evaluation-marketing-workspace', role: 'tenant_admin' },
      { slug: 'evaluation-compliance-workspace', role: 'tenant_admin' },
    ],
    devices: [
      {
        profileId: '10000000-0000-4000-8000-000000000005',
        publicKey: 'seedOrgAdminPublicKey000000000000000000005',
        name: 'Org admin MacBook',
        platform: 'darwin',
        appVersion: '0.5.0',
        revoked: false,
      },
    ],
  },
] as const;
const extraWorkspaces = [
  {
    name: 'Evaluation Legal Workspace',
    slug: 'evaluation-legal-workspace',
    producerAccess: true,
    projects: [
      { name: 'Legal Evidence', slug: 'legal-evidence' },
      { name: 'Contract Review', slug: 'contract-review' },
    ],
  },
  {
    name: 'Evaluation Finance Workspace',
    slug: 'evaluation-finance-workspace',
    producerAccess: true,
    projects: [
      { name: 'Finance Evidence', slug: 'finance-evidence' },
      { name: 'Policy Archive', slug: 'policy-archive' },
    ],
  },
  {
    name: 'Evaluation Research Workspace',
    slug: 'evaluation-research-workspace',
    projects: [
      { name: 'Research Protocols', slug: 'research-protocols' },
      { name: 'Model Training Evidence', slug: 'model-training-evidence' },
    ],
  },
  {
    name: 'Evaluation Marketing Workspace',
    slug: 'evaluation-marketing-workspace',
    projects: [
      { name: 'Published Claims', slug: 'published-claims' },
      { name: 'Campaign Evidence', slug: 'campaign-evidence' },
    ],
  },
  {
    name: 'Evaluation Compliance Workspace',
    slug: 'evaluation-compliance-workspace',
    projects: [
      { name: 'Regulatory Evidence', slug: 'regulatory-evidence' },
      { name: 'Audit Support', slug: 'audit-support' },
    ],
  },
];

const main = async (): Promise<void> => {
  const handle = createClient({ url: DATABASE_URL, max: 1 });
  try {
    const passwordHash = await hashPassword(password);
    const existingOrganizationRows = await handle.sql<{ id: string }[]>`
      SELECT id FROM public.organizations
      WHERE name = 'Evaluation Organization'
      ORDER BY created_at ASC
      LIMIT 1`;
    let organizationId = existingOrganizationRows[0]?.id;
    if (!organizationId) {
      const organizationRows = await handle.sql<{ id: string }[]>`
        INSERT INTO public.organizations (name)
        VALUES ('Evaluation Organization')
        RETURNING id`;
      organizationId = organizationRows[0]?.id;
    }
    if (!organizationId) {
      throw new Error('failed to upsert evaluation organization');
    }

    const tenantRows = await handle.sql<{ id: string }[]>`
      INSERT INTO public.tenants (organization_id, name, slug, plan, is_personal)
      VALUES (${organizationId}, ${workspaceName}, ${workspaceSlug}, 'team_pro', false)
      ON CONFLICT (slug) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        name = EXCLUDED.name,
        plan = EXCLUDED.plan,
        is_personal = EXCLUDED.is_personal,
        updated_at = now()
      RETURNING id`;
    const tenantId = tenantRows[0]?.id;
    if (!tenantId) throw new Error('failed to upsert evaluation workspace');

    const userRows = await handle.sql<{ id: string; email: string }[]>`
      INSERT INTO public.users (email, password_hash, display_name)
      VALUES (${email.toLowerCase()}, ${passwordHash}, ${displayName})
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        updated_at = now(),
        deactivated_at = null
      RETURNING id, email`;
    const user = userRows[0];
    if (!user) throw new Error('failed to upsert evaluation producer');

    const verifierRows = await handle.sql<{ id: string; email: string }[]>`
      INSERT INTO public.users (email, password_hash, display_name)
      VALUES (
        ${verifierEmail.toLowerCase()},
        ${await hashPassword(verifierPassword)},
        ${verifierDisplayName}
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        updated_at = now(),
        deactivated_at = null
      RETURNING id, email`;
    const verifier = verifierRows[0];
    if (!verifier) throw new Error('failed to upsert evaluation verifier');

    const adminRows = await handle.sql<{ id: string; email: string }[]>`
      INSERT INTO public.users (email, password_hash, display_name)
      VALUES (
        ${adminEmail.toLowerCase()},
        ${await hashPassword(adminPassword)},
        ${adminDisplayName}
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        updated_at = now(),
        deactivated_at = null
      RETURNING id, email`;
    const admin = adminRows[0];
    if (!admin) throw new Error('failed to upsert evaluation admin producer');

    const additionalSeededUsers = [];
    const additionalUserPasswordHash = await hashPassword(memberPassword);
    for (const seedUser of additionalUsers) {
      const rows = await handle.sql<{ id: string; email: string }[]>`
        INSERT INTO public.users (email, password_hash, display_name)
        VALUES (
          ${seedUser.email.toLowerCase()},
          ${additionalUserPasswordHash},
          ${seedUser.displayName}
        )
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          display_name = EXCLUDED.display_name,
          updated_at = now(),
          deactivated_at = null
        RETURNING id, email`;
      const seededUser = rows[0];
      if (!seededUser) {
        throw new Error(`failed to upsert evaluation user ${seedUser.email}`);
      }
      additionalSeededUsers.push({ ...seedUser, id: seededUser.id });
    }

    await handle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantId}, ${user.id}, 'producer')
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        role = EXCLUDED.role`;

    await handle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantId}, ${admin.id}, 'tenant_admin')
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        role = EXCLUDED.role`;

    await handle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode, revoked_at)
      VALUES
        (${organizationId}, ${user.id}, 'member', 'selected_workspaces', null),
        (${organizationId}, ${admin.id}, 'organization_admin', 'all_workspaces', null)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        org_role = EXCLUDED.org_role,
        workspace_access_mode = EXCLUDED.workspace_access_mode,
        revoked_at = null,
        updated_at = now()`;

    const workspaceIdsBySlug = new Map([[workspaceSlug, tenantId]]);

    await handle.sql`
      INSERT INTO public.projects (
        tenant_id,
        slug,
        name,
        description,
        template_slug,
        visibility,
        created_by_user_id
      )
      VALUES (
        ${tenantId},
        ${projectSlug},
        ${projectName},
        'Local evaluation project for desktop attestation testing.',
        'general_provenance',
        'private',
        ${user.id}
      )
      ON CONFLICT (tenant_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        template_slug = EXCLUDED.template_slug,
        visibility = EXCLUDED.visibility,
        updated_at = now()`;

    for (const workspace of extraWorkspaces) {
      const workspaceRows = await handle.sql<{ id: string }[]>`
        INSERT INTO public.tenants
          (organization_id, name, slug, plan, is_personal)
        VALUES
          (${organizationId}, ${workspace.name}, ${workspace.slug}, 'team_pro', false)
        ON CONFLICT (slug) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          name = EXCLUDED.name,
          plan = EXCLUDED.plan,
          is_personal = EXCLUDED.is_personal,
          updated_at = now()
        RETURNING id`;
      const workspaceId = workspaceRows[0]?.id;
      if (!workspaceId) {
        throw new Error(`failed to upsert ${workspace.slug}`);
      }
      workspaceIdsBySlug.set(workspace.slug, workspaceId);

      await handle.sql`
        INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
        VALUES (${workspaceId}, ${admin.id}, 'tenant_admin')
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
          role = EXCLUDED.role`;

      if (workspace.producerAccess) {
        await handle.sql`
          INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
          VALUES (${workspaceId}, ${user.id}, 'producer')
          ON CONFLICT (tenant_id, user_id) DO UPDATE SET
            role = EXCLUDED.role`;
      }

      for (const project of workspace.projects) {
        await handle.sql`
          INSERT INTO public.projects (
            tenant_id,
            slug,
            name,
            description,
            template_slug,
            visibility,
            created_by_user_id
          )
          VALUES (
            ${workspaceId},
            ${project.slug},
            ${project.name},
            'Additional evaluation project for workspace access testing.',
            'general_provenance',
            'private',
            ${admin.id}
          )
          ON CONFLICT (tenant_id, slug) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            template_slug = EXCLUDED.template_slug,
            visibility = EXCLUDED.visibility,
            updated_at = now()`;
      }
    }

    for (const seededUser of additionalSeededUsers) {
      await handle.sql`
        INSERT INTO public.organization_memberships
          (organization_id, user_id, org_role, workspace_access_mode, revoked_at)
        VALUES
          (
            ${organizationId},
            ${seededUser.id},
            ${seededUser.orgRole},
            ${seededUser.workspaceAccessMode},
            null
          )
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          org_role = EXCLUDED.org_role,
          workspace_access_mode = EXCLUDED.workspace_access_mode,
          revoked_at = null,
          updated_at = now()`;

      for (const membership of seededUser.memberships) {
        const membershipTenantId = workspaceIdsBySlug.get(membership.slug);
        if (!membershipTenantId) {
          throw new Error(`missing seeded workspace ${membership.slug}`);
        }
        await handle.sql`
          INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
          VALUES (${membershipTenantId}, ${seededUser.id}, ${membership.role})
          ON CONFLICT (tenant_id, user_id) DO UPDATE SET
            role = EXCLUDED.role`;
      }

      for (const device of seededUser.devices) {
        const deviceTenantId =
          workspaceIdsBySlug.get(seededUser.memberships[0]?.slug ?? workspaceSlug) ??
          tenantId;
        await handle.sql`
          INSERT INTO public.devices (
            tenant_id,
            user_id,
            profile_id,
            public_key,
            name,
            platform,
            app_version,
            last_seen_at,
            revoked_at
          )
          VALUES (
            ${deviceTenantId},
            ${seededUser.id},
            ${device.profileId},
            ${device.publicKey},
            ${device.name},
            ${device.platform},
            ${device.appVersion},
            now(),
            ${device.revoked ? handle.sql`now()` : null}
          )
          ON CONFLICT (public_key) DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            user_id = EXCLUDED.user_id,
            profile_id = EXCLUDED.profile_id,
            name = EXCLUDED.name,
            platform = EXCLUDED.platform,
            app_version = EXCLUDED.app_version,
            last_seen_at = EXCLUDED.last_seen_at,
            revoked_at = EXCLUDED.revoked_at`;
      }
    }

    console.log('Evaluation producer ready');
    console.log(`  email: ${user.email}`);
    console.log(`  password: ${password}`);
    console.log(`  role: producer`);
    console.log(`  workspace: ${workspaceName} (${workspaceSlug})`);
    for (const workspace of extraWorkspaces.filter(
      (entry) => entry.producerAccess,
    )) {
      console.log(
        `  producer workspace: ${workspace.name} (${workspace.slug})`,
      );
    }
    console.log(`  plan: team_pro`);
    console.log(`  project: ${projectName} (${projectSlug})`);
    console.log('Evaluation admin producer ready');
    console.log(`  email: ${admin.email}`);
    console.log(`  password: ${adminPassword}`);
    console.log(`  role: tenant_admin`);
    console.log(`  workspace: ${workspaceName} (${workspaceSlug})`);
    for (const workspace of extraWorkspaces) {
      console.log(`  extra workspace: ${workspace.name} (${workspace.slug})`);
    }
    console.log('Evaluation verifier ready');
    console.log(`  email: ${verifier.email}`);
    console.log(`  password: ${verifierPassword}`);
    console.log('Additional evaluation users ready');
    console.log(`  password: ${memberPassword}`);
    for (const seededUser of additionalSeededUsers) {
      console.log(`  ${seededUser.email} (${seededUser.displayName})`);
    }
  } finally {
    await handle.close();
  }
};

main().catch((err) => {
  console.error('[seed-eval-producer] failed:', err);
  process.exit(1);
});
