import { signedRequest, signedRequestText } from '../api-client.js';
import { loadSession, saveSession } from '../session-store.js';

import { fail, ok, registerRpc } from './handlers.js';
import type {
  EvidenceExportJobSummary,
  OrganizationSummary,
  TenantAuditEventSummary,
  TenantInvitationSummary,
  TenantMemberAccessSummary,
  TenantMemberSummary,
  WorkspaceSummary,
} from './types.js';

interface MembersResponse {
  members: TenantMemberSummary[];
}

interface WorkspaceCreateResponse {
  tenant: WorkspaceSummary;
}

interface WorkspaceUpdateResponse {
  tenant: WorkspaceSummary;
}

interface OrganizationSettingsUpdateResponse {
  organization: OrganizationSummary;
  tenant: WorkspaceSummary;
}

interface MemberAccessResponse {
  member: TenantMemberAccessSummary;
}

interface InvitationsResponse {
  invitations: TenantInvitationSummary[];
}

interface InvitationCreateResponse {
  invitation: TenantInvitationSummary;
}

interface AuditResponse {
  events: TenantAuditEventSummary[];
  scope: 'full' | 'limited';
}

interface EvidenceExportJobResponse {
  job: EvidenceExportJobSummary;
  manifest: unknown;
}

interface EvidenceExportJobsResponse {
  jobs: EvidenceExportJobSummary[];
}

const queryString = (
  params: Record<string, string | number | undefined>,
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

const tenantPath = async (suffix = ''): Promise<string> => {
  const session = await loadSession();
  if (!session) throw new Error('no_session');
  return `/tenants/${session.activeWorkspace.slug}${suffix}`;
};

const mergeWorkspaceIntoSession = async (
  tenant: WorkspaceSummary,
  options: { activate?: boolean; remove?: boolean } = {},
): Promise<void> => {
  const session = await loadSession();
  if (!session) throw new Error('no_session');
  const existingWorkspaces = session.workspaces ?? [session.activeWorkspace];
  const workspaces = options.remove
    ? existingWorkspaces.filter((workspace) => workspace.id !== tenant.id)
    : [
        ...existingWorkspaces.filter((workspace) => workspace.id !== tenant.id),
        tenant,
      ];
  await saveSession({
    ...session,
    activeWorkspace: options.activate ? tenant : session.activeWorkspace,
    organizations: session.organizations ?? [],
    workspaces,
  });
};

const errorCode = (err: unknown, fallback: string): string => {
  const body = (err as { body?: { error?: string } }).body;
  return body?.error ?? fallback;
};

export const registerTenantRpc = (): void => {
  registerRpc('tenant.workspaces.create', async ({ name }) => {
    try {
      const session = await loadSession();
      if (!session) {
        return fail('not_signed_in', 'Sign in before creating a workspace.');
      }
      const response = await signedRequest<WorkspaceCreateResponse>({
        method: 'POST',
        path: `/tenants/${session.activeWorkspace.slug}/workspaces`,
        body: { name },
      });
      await mergeWorkspaceIntoSession(response.tenant, { activate: true });
      return ok(response);
    } catch (err) {
      const code = errorCode(err, 'workspace_create_failed');
      return fail(
        code,
        code === 'forbidden'
          ? 'Only organization admins can create workspaces.'
          : code === 'invalid_name'
            ? 'Enter a workspace name.'
            : err instanceof Error
              ? err.message
              : 'Could not create workspace.',
      );
    }
  });

  registerRpc('tenant.workspaces.archive', async ({ workspaceId }) => {
    try {
      const response = await signedRequest<WorkspaceUpdateResponse>({
        method: 'POST',
        path: await tenantPath(`/workspaces/${workspaceId}/archive`),
        body: {},
      });
      await mergeWorkspaceIntoSession(response.tenant);
      return ok(response);
    } catch (err) {
      const code = errorCode(err, 'workspace_archive_failed');
      return fail(
        code,
        code === 'cannot_archive_active_workspace'
          ? 'Switch to a different workspace before archiving this one.'
          : err instanceof Error
            ? err.message
            : 'Could not archive workspace.',
      );
    }
  });

  registerRpc('tenant.workspaces.restore', async ({ workspaceId }) => {
    try {
      const response = await signedRequest<WorkspaceUpdateResponse>({
        method: 'POST',
        path: await tenantPath(`/workspaces/${workspaceId}/restore`),
        body: {},
      });
      await mergeWorkspaceIntoSession(response.tenant);
      return ok(response);
    } catch (err) {
      return fail(
        errorCode(err, 'workspace_restore_failed'),
        err instanceof Error ? err.message : 'Could not restore workspace.',
      );
    }
  });

  registerRpc('tenant.organizationSettings.update', async ({ projectNoun }) => {
    try {
      const response = await signedRequest<OrganizationSettingsUpdateResponse>({
        method: 'PATCH',
        path: await tenantPath('/organization/settings'),
        body: { projectNoun },
      });
      await mergeWorkspaceIntoSession(response.tenant, { activate: true });
      const session = await loadSession();
      if (session) {
        await saveSession({
          ...session,
          organizations: (session.organizations ?? []).map((organization) =>
            organization.id === response.organization.id
              ? response.organization
              : organization,
          ),
          workspaces: (session.workspaces ?? []).map((workspace) =>
            workspace.organizationId === response.organization.id
              ? {
                  ...workspace,
                  projectNoun: response.organization.projectNoun,
                }
              : workspace,
          ),
        });
      }
      return ok(response);
    } catch (err) {
      const code = errorCode(err, 'organization_settings_update_failed');
      return fail(
        code,
        code === 'forbidden'
          ? 'Only organization admins can update global settings.'
          : err instanceof Error
            ? err.message
            : 'Could not update global settings.',
      );
    }
  });

  registerRpc('tenant.members.list', async () => {
    try {
      return ok(
        await signedRequest<MembersResponse>({
          method: 'GET',
          path: await tenantPath('/members'),
        }),
      );
    } catch (err) {
      return fail(
        errorCode(err, 'members_list_failed'),
        err instanceof Error ? err.message : 'Could not load members.',
      );
    }
  });

  registerRpc('tenant.members.remove', async ({ userId }) => {
    try {
      await signedRequest<void>({
        method: 'DELETE',
        path: await tenantPath(`/members/${userId}`),
      });
      return ok({ ok: true } as const);
    } catch (err) {
      const code = errorCode(err, 'member_remove_failed');
      return fail(
        code,
        code === 'cannot_remove_self'
          ? 'You cannot remove your own workspace access from the desktop app.'
          : code === 'cannot_remove_last_admin'
          ? 'You cannot remove the last workspace admin.'
          : err instanceof Error
            ? err.message
            : 'Could not remove that member.',
      );
    }
  });

  registerRpc(
    'tenant.members.updateAccess',
    async ({
      userId,
      role,
      organizationRole,
      workspaceAccessMode,
      workspaceIds,
    }) => {
      try {
        return ok(
          await signedRequest<MemberAccessResponse>({
            method: 'PATCH',
            path: await tenantPath(`/members/${userId}/access`),
            body: {
              ...(role ? { role } : {}),
              ...(organizationRole ? { organizationRole } : {}),
              ...(workspaceAccessMode ? { workspaceAccessMode } : {}),
              ...(workspaceIds ? { workspaceIds } : {}),
            },
          }),
        );
      } catch (err) {
        const code = errorCode(err, 'member_access_update_failed');
        return fail(
          code,
          code === 'cannot_remove_self'
            ? 'You cannot remove your own workspace admin access.'
            : code === 'cannot_remove_last_admin'
              ? 'You cannot remove the last workspace admin.'
              : err instanceof Error
                ? err.message
                : 'Could not update member access.',
        );
      }
    },
  );

  registerRpc('tenant.invitations.list', async () => {
    try {
      return ok(
        await signedRequest<InvitationsResponse>({
          method: 'GET',
          path: await tenantPath('/invitations'),
        }),
      );
    } catch (err) {
      return fail(
        errorCode(err, 'invitations_list_failed'),
        err instanceof Error ? err.message : 'Could not load invitations.',
      );
    }
  });

  registerRpc('tenant.invitations.create', async ({ email, role }) => {
    try {
      return ok(
        await signedRequest<InvitationCreateResponse>({
          method: 'POST',
          path: await tenantPath('/invitations'),
          body: { email, role },
        }),
      );
    } catch (err) {
      const code = errorCode(err, 'invitation_create_failed');
      const message =
        code === 'already_member'
          ? 'That email is already a member.'
          : code === 'invalid_email'
            ? 'Enter a valid email address.'
            : code === 'user_limit_exceeded'
              ? 'This workspace has reached its member limit.'
            : err instanceof Error
              ? err.message
              : 'Could not create invitation.';
      return fail(code, message);
    }
  });

  registerRpc('tenant.invitations.revoke', async ({ invitationId }) => {
    try {
      await signedRequest<void>({
        method: 'POST',
        path: await tenantPath(`/invitations/${invitationId}/revoke`),
        body: {},
      });
      return ok({ ok: true } as const);
    } catch (err) {
      return fail(
        errorCode(err, 'invitation_revoke_failed'),
        err instanceof Error ? err.message : 'Could not revoke invitation.',
      );
    }
  });

  registerRpc('tenant.audit.list', async ({ limit }) => {
    try {
      const n =
        Number.isInteger(limit) && limit && limit > 0
          ? Math.min(limit, 200)
          : 100;
      return ok(
        await signedRequest<AuditResponse>({
          method: 'GET',
          path: await tenantPath(`/audit?limit=${n}`),
        }),
      );
    } catch (err) {
      return fail(
        errorCode(err, 'audit_list_failed'),
        err instanceof Error ? err.message : 'Could not load audit events.',
      );
    }
  });

  registerRpc('tenant.audit.export', async (args) => {
    try {
      const exportPath =
        args.scope === 'organization'
          ? '/organization/audit/export'
          : '/audit/export';
      const path = await tenantPath(
        `${exportPath}${queryString({
          format: args.format,
          category: args.category,
          actorUserId: args.actorUserId,
          projectId: args.projectId,
          from: args.from,
          to: args.to,
        })}`,
      );
      const response = await signedRequestText({
        method: 'GET',
        path,
      });
      const date = new Date().toISOString().slice(0, 10);
      return ok({
        filename: `proveria-${args.scope === 'organization' ? 'organization-' : ''}events-${date}.${args.format}`,
        contentType:
          response.contentType ??
          (args.format === 'csv' ? 'text/csv' : 'application/json'),
        body: response.body,
      });
    } catch (err) {
      return fail(
        errorCode(err, 'audit_export_failed'),
        err instanceof Error ? err.message : 'Could not export events.',
      );
    }
  });

  registerRpc('tenant.evidenceExport.manifest', async (args) => {
    try {
      const path = await tenantPath(
        `/evidence-export/manifest${queryString({
          projectId: args.projectId,
          actorUserId: args.actorUserId,
          scope: args.scope,
          includeEvents: args.includeEvents ? 'true' : undefined,
        })}`,
      );
      const response = await signedRequestText({
        method: 'GET',
        path,
      });
      const date = new Date().toISOString().slice(0, 10);
      return ok({
        filename: `proveria-evidence-manifest-${date}.json`,
        contentType: response.contentType ?? 'application/json',
        body: response.body,
      });
    } catch (err) {
      return fail(
        errorCode(err, 'evidence_export_manifest_failed'),
        err instanceof Error
          ? err.message
          : 'Could not export evidence manifest.',
      );
    }
  });

  registerRpc('tenant.evidenceExport.jobs.create', async (args) => {
    try {
      const response = await signedRequest<EvidenceExportJobResponse>({
        method: 'POST',
        path: await tenantPath('/evidence-export/jobs'),
        body: {
          scope: args.scope,
          projectId: args.projectId,
          actorUserId: args.actorUserId,
          includeEvents: args.includeEvents ?? true,
        },
      });
      const date = new Date().toISOString().slice(0, 10);
      return ok({
        job: response.job,
        filename: `proveria-evidence-export-${date}.json`,
        contentType: 'application/json',
        body: JSON.stringify(response.manifest, null, 2),
      });
    } catch (err) {
      return fail(
        errorCode(err, 'evidence_export_job_failed'),
        err instanceof Error
          ? err.message
          : 'Could not create evidence export job.',
      );
    }
  });

  registerRpc('tenant.evidenceExport.jobs.list', async (args) => {
    try {
      const response = await signedRequest<EvidenceExportJobsResponse>({
        method: 'GET',
        path: await tenantPath(
          `/evidence-export/jobs${queryString({ limit: args.limit })}`,
        ),
      });
      return ok(response);
    } catch (err) {
      return fail(
        errorCode(err, 'evidence_export_jobs_list_failed'),
        err instanceof Error
          ? err.message
          : 'Could not load evidence export jobs.',
      );
    }
  });

  registerRpc('tenant.evidenceExport.jobs.get', async (args) => {
    try {
      const response = await signedRequest<EvidenceExportJobResponse>({
        method: 'GET',
        path: await tenantPath(
          `/evidence-export/jobs/${encodeURIComponent(args.id)}`,
        ),
      });
      const created = response.job.createdAt.slice(0, 10);
      return ok({
        job: response.job,
        filename: `proveria-evidence-export-${created}-${response.job.id}.json`,
        contentType: 'application/json',
        body: JSON.stringify(response.manifest, null, 2),
      });
    } catch (err) {
      return fail(
        errorCode(err, 'evidence_export_job_get_failed'),
        err instanceof Error
          ? err.message
          : 'Could not load evidence export job.',
      );
    }
  });

  registerRpc('tenant.evidenceExport.jobs.bundle', async (args) => {
    try {
      const response = await signedRequestText({
        method: 'GET',
        path: await tenantPath(
          `/evidence-export/jobs/${encodeURIComponent(args.id)}/bundle`,
        ),
      });
      return ok({
        jobId: args.id,
        filename: `proveria-evidence-bundle-${args.id}.json`,
        contentType: response.contentType ?? 'application/json',
        body: response.body,
      });
    } catch (err) {
      return fail(
        errorCode(err, 'evidence_export_bundle_failed'),
        err instanceof Error
          ? err.message
          : 'Could not download evidence export bundle.',
      );
    }
  });
};
