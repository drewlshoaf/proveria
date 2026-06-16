export type Result<T, E = RpcError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface RpcError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  plan: string;
  projectNoun?: string;
  role: 'tenant_admin' | 'producer' | 'consumer';
  organizationId?: string | null;
  archivedAt?: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  projectNoun?: string;
  role: string;
  workspaceAccessMode: 'all_workspaces' | 'selected_workspaces' | 'none' | string;
}

export interface OidcProviderSummary {
  slug: string;
  displayName: string;
  issuerUrl: string;
  scopes: string[];
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  createdAt: string;
  archivedAt: string | null;
}

export interface AttestationSubmitResult {
  attestationId: string;
  attemptId: string;
  state: string;
  merkleRoot: string;
  leafHash: string;
  submittedHash: string;
  shingleCount: number;
  componentCount: number;
}

export interface AttestationSummary {
  id: string;
  label: string;
  description: string | null;
  state: string;
  createdAt: string;
  confirmedAt: string | null;
  verificationLinkId?: string | null;
  projectSlug: string;
  projectName: string;
}

export interface RecentAttestationSummary extends AttestationSummary {
  failedAt: string | null;
}

export interface AttestationDetail {
  id: string;
  label: string;
  state: string;
  confirmedAttemptId: string | null;
  manifestObjectKey: string | null;
  merkleRoot: string | null;
  packageId: string | null;
  receiptAvailable: boolean;
  verificationLinkId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  tenantSlug: string;
  coverageType: string;
  shinglingPresets: string[];
  extractionMethods: string[];
}

export interface GoogleDriveSourceSummary {
  provider: 'google_drive';
  fileId: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  modifiedTime?: string;
  selectedByUserId: string;
  selectedAt: string;
  googleAccountEmail?: string;
}

export interface AttestationAttemptSummary {
  id: string;
  state: string;
  validationError: string | null;
  isConfirmed: boolean;
  createdAt: string;
  uploadedAt: string | null;
  validatedAt: string | null;
  failedAt: string | null;
  sourceMetadata: GoogleDriveSourceSummary | null;
}

export interface AttestationAccessGrantSummary {
  id: string;
  grantedToEmail: string;
  createdAt: string;
  pending: boolean;
}

export interface AttestationAccessRequestSummary {
  id: string;
  attestationId: string;
  requestedByEmail: string;
  message: string | null;
  status: string;
  resolutionReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  attestation: { id: string; label: string };
  project: { slug: string; name: string };
}

export interface DeviceSummary {
  id: string;
  isCurrent: boolean;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  profileId: string;
  name: string;
  platform: string;
  appVersion: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface TenantDeviceSummary {
  id: string;
  userId: string;
  profileId: string;
  name: string;
  platform: string;
  appVersion: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface ExternalIdentitySummary {
  id: string;
  providerSlug: string;
  providerDisplayName: string;
  email: string;
  emailVerified: boolean;
  linkedAt: string;
  lastSeenAt: string | null;
  disconnectedAt: string | null;
}

export interface TenantMemberSummary {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  organizationRole: string;
  workspaceAccessMode: string;
  joinedAt: string;
  workspaces?: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
  }>;
}

export interface TenantMemberAccessSummary {
  userId: string;
  role: string | null;
  organizationRole: string;
  workspaceAccessMode: string;
  revoked: boolean;
}

export interface TenantInvitationSummary {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

export interface TenantAuditEventSummary {
  id: string;
  category: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  actorUserId: string | null;
  actorDeviceId: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface EvidenceExportJobSummary {
  id: string;
  kind: string;
  status: string;
  filters: unknown;
  artifactCount: number;
  rowCount: number;
  resultObjectKey: string | null;
  error: string | null;
  progressPercent: number;
  retryCount: number;
  maxRetries: number;
  expiresAt: string | null;
  retentionPolicy: unknown;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RpcMethods {
  'auth.register': {
    request: {
      email: string;
      password: string;
      displayName?: string;
      workspaceName: string;
      apiUrl: string;
      invitationToken?: string;
    };
    response: {
      user: { id: string; email: string; displayName: string | null };
      activeWorkspace: WorkspaceSummary;
      organizations: OrganizationSummary[];
      workspaces: WorkspaceSummary[];
      profileId: string;
      deviceId: string;
    };
  };
  'auth.signIn': {
    request: { email: string; password: string; apiUrl: string };
    response: {
      user: { id: string; email: string; displayName?: string | null };
      activeWorkspace: WorkspaceSummary;
      organizations: OrganizationSummary[];
      workspaces: WorkspaceSummary[];
      profileId: string;
      deviceId: string;
    };
  };
  'auth.oidcProviders': {
    request: { apiUrl: string };
    response: { providers: OidcProviderSummary[] };
  };
  'auth.oidcSignIn': {
    request: { apiUrl: string; provider: string };
    response: {
      user: { id: string; email: string; displayName?: string | null };
      activeWorkspace: WorkspaceSummary;
      organizations: OrganizationSummary[];
      workspaces: WorkspaceSummary[];
      profileId: string;
      deviceId: string;
    };
  };
  'auth.signOut': {
    request: Record<string, never>;
    response: { ok: true };
  };
  'auth.switchWorkspace': {
    request: { workspaceId: string };
    response: {
      activeWorkspace: WorkspaceSummary;
      organizations: OrganizationSummary[];
      workspaces: WorkspaceSummary[];
    };
  };
  'auth.currentSession': {
    request: Record<string, never>;
    response: {
      user: { id: string; email: string; displayName?: string | null };
      activeWorkspace: WorkspaceSummary;
      organizations: OrganizationSummary[];
      workspaces: WorkspaceSummary[];
      profileId: string;
      deviceId: string;
      apiUrl: string;
    } | null;
  };
  'projects.list': {
    request: { includeArchived?: boolean };
    response: { projects: ProjectSummary[] };
  };
  'projects.create': {
    request: {
      slug: string;
      name: string;
      description?: string;
    };
    response: { project: ProjectSummary };
  };
  'projects.archive': {
    request: { projectSlug: string };
    response: { project: ProjectSummary };
  };
  'projects.restore': {
    request: { projectSlug: string };
    response: { project: ProjectSummary };
  };
  'attestations.createWholeFile': {
    request: {
      projectSlug: string;
      label: string;
      description?: string;
      fileName: string;
      fileSize: number;
      sha256Hex: string;
      contentProof?: {
        preset: 'standard';
        sourceExtractionMethod:
          | 'plain-text/v1'
          | 'pdf-text-layer/v1'
          | 'ocr-tesseract/v1';
        normalizedTokenCount: number;
        shingles: Array<{
          canonicalPayloadHash: string;
          sourceIndex: number;
        }>;
        ocrSummary?: {
          engine: 'tesseract';
          engineVersion: string;
          languagePack: 'eng';
          languagePackVersion: string;
          pageCount: number;
          ocrPageCount: number;
          failedPageCount: number;
          lowConfidencePageCount: number;
          meanConfidence: number | null;
          warnings: string[];
        };
      };
      exactImageProof?: {
        method: 'exact-image-sha256/v1';
        mediaType: 'image/png' | 'image/jpeg';
      };
      sourceMetadata?: {
        provider: 'google_drive';
        fileId: string;
        fileName: string;
        mimeType?: string;
        size?: number;
        modifiedTime?: string;
        googleAccountEmail?: string;
      };
    };
    response: AttestationSubmitResult;
  };
  'attestations.ocrPdf': {
    request: { pdfBase64: string };
    response: {
      contentProof: {
        preset: 'standard';
        sourceExtractionMethod: 'ocr-tesseract/v1';
        normalizedTokenCount: number;
        shingleCount: number;
        shingles: Array<{
          canonicalPayloadHash: string;
          sourceIndex: number;
        }>;
        ocrSummary: {
          engine: 'tesseract';
          engineVersion: string;
          languagePack: 'eng';
          languagePackVersion: string;
          pageCount: number;
          ocrPageCount: number;
          failedPageCount: number;
          lowConfidencePageCount: number;
          meanConfidence: number | null;
          warnings: string[];
        };
      };
    };
  };
  'attestations.list': {
    request: { projectSlug: string };
    response: { attestations: AttestationSummary[] };
  };
  'attestations.recent': {
    request: { limit?: number };
    response: { attestations: RecentAttestationSummary[] };
  };
  'attestations.get': {
    request: { attestationId: string };
    response: {
      attestation: AttestationDetail;
      attempts: AttestationAttemptSummary[];
    };
  };
  'attestations.receipt': {
    request: { attestationId: string };
    response: {
      receipt: unknown;
      signatureValid: boolean;
      verificationLinkId?: string | null;
    };
  };
  'attestations.openReceiptPdf': {
    request: { url: string; filename?: string };
    response: { ok: true };
  };
  'attestations.accessGrants.list': {
    request: { attestationId: string };
    response: { grants: AttestationAccessGrantSummary[] };
  };
  'attestations.accessGrants.create': {
    request: { attestationId: string; email: string; message?: string };
    response: { grant: AttestationAccessGrantSummary };
  };
  'attestations.accessGrants.revoke': {
    request: { attestationId: string; grantId: string };
    response: { ok: true };
  };
  'attestations.accessRequests.list': {
    request: { status?: 'pending' | 'approved' | 'denied' | 'all' };
    response: { requests: AttestationAccessRequestSummary[] };
  };
  'attestations.accessRequests.approve': {
    request: { requestId: string; reason: string };
    response: {
      request: { id: string; status: string; resolvedAt: string };
      grant: AttestationAccessGrantSummary;
    };
  };
  'attestations.accessRequests.deny': {
    request: { requestId: string; reason: string };
    response: { request: { id: string; status: string; resolvedAt: string } };
  };
  'devices.list': {
    request: Record<string, never>;
    response: { devices: DeviceSummary[] };
  };
  'devices.listForWorkspace': {
    request: Record<string, never>;
    response: { devices: TenantDeviceSummary[] };
  };
  'devices.revoke': {
    request: { deviceId: string };
    response: { ok: true };
  };
  'devices.revokeForWorkspace': {
    request: { deviceId: string };
    response: { ok: true };
  };
  'externalIdentities.list': {
    request: Record<string, never>;
    response: { identities: ExternalIdentitySummary[] };
  };
  'externalIdentities.connect': {
    request: { provider: string };
    response: { ok: true };
  };
  'externalIdentities.disconnect': {
    request: { identityId: string };
    response: { ok: true };
  };
  'tenant.members.list': {
    request: Record<string, never>;
    response: { members: TenantMemberSummary[] };
  };
  'tenant.workspaces.create': {
    request: { name: string };
    response: { tenant: WorkspaceSummary };
  };
  'tenant.workspaces.archive': {
    request: { workspaceId: string };
    response: { tenant: WorkspaceSummary };
  };
  'tenant.workspaces.restore': {
    request: { workspaceId: string };
    response: { tenant: WorkspaceSummary };
  };
  'tenant.organizationSettings.update': {
    request: { projectNoun: string };
    response: { organization: OrganizationSummary; tenant: WorkspaceSummary };
  };
  'tenant.members.remove': {
    request: { userId: string };
    response: { ok: true };
  };
  'tenant.members.updateAccess': {
    request: {
      userId: string;
      role?: 'tenant_admin' | 'producer' | 'consumer';
      organizationRole?: 'organization_admin' | 'member';
      workspaceAccessMode?: 'all_workspaces' | 'selected_workspaces' | 'none';
      workspaceIds?: string[];
    };
    response: { member: TenantMemberAccessSummary };
  };
  'tenant.invitations.list': {
    request: Record<string, never>;
    response: { invitations: TenantInvitationSummary[] };
  };
  'tenant.invitations.create': {
    request: { email: string; role: 'tenant_admin' | 'producer' | 'consumer' };
    response: { invitation: TenantInvitationSummary };
  };
  'tenant.invitations.revoke': {
    request: { invitationId: string };
    response: { ok: true };
  };
  'tenant.audit.list': {
    request: { limit?: number };
    response: { events: TenantAuditEventSummary[]; scope: 'full' | 'limited' };
  };
  'tenant.audit.export': {
    request: {
      format: 'json' | 'csv';
      scope?: 'workspace' | 'organization';
      category?: string;
      actorUserId?: string;
      projectId?: string;
      from?: string;
      to?: string;
    };
    response: {
      filename: string;
      contentType: string;
      body: string;
    };
  };
  'tenant.evidenceExport.manifest': {
    request: {
      scope?: 'workspace' | 'organization';
      projectId?: string;
      actorUserId?: string;
      includeEvents?: boolean;
    };
    response: {
      filename: string;
      contentType: string;
      body: string;
    };
  };
  'tenant.evidenceExport.jobs.create': {
    request: {
      scope?: 'workspace' | 'organization';
      projectId?: string;
      actorUserId?: string;
      includeEvents?: boolean;
    };
    response: {
      job: EvidenceExportJobSummary;
      filename: string;
      contentType: string;
      body: string;
    };
  };
  'tenant.evidenceExport.jobs.list': {
    request: { limit?: number };
    response: { jobs: EvidenceExportJobSummary[] };
  };
  'tenant.evidenceExport.jobs.get': {
    request: { id: string };
    response: {
      job: EvidenceExportJobSummary;
      filename: string;
      contentType: string;
      body: string;
    };
  };
  'tenant.evidenceExport.jobs.bundle': {
    request: { id: string };
    response: {
      jobId: string;
      filename: string;
      contentType: string;
      body: string;
    };
  };
}

export type RpcMethodName = keyof RpcMethods;
export type RpcRequest<M extends RpcMethodName> = RpcMethods[M]['request'];
export type RpcResponse<M extends RpcMethodName> = RpcMethods[M]['response'];

export interface RpcEnvelope<M extends RpcMethodName = RpcMethodName> {
  v: 1;
  method: M;
  args: RpcRequest<M>;
}
