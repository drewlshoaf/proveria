import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PDF_TEXT_LAYER_MIN_TOKENS } from '@proveria/ocr/browser';
import {
  normalizeForShingling,
  shinglePlainTextInBrowser,
  tokenizeNormalized,
} from '@proveria/shingling/browser';
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { useLocation } from 'wouter';

import {
  buildContentProofRpcPayload,
  buildExactImageProofRpcPayload,
} from '../lib/content-proof';
import type {
  RendererExactImageProof,
  RendererOcrSummary,
} from '../lib/content-proof';
import { rpc } from '../lib/rpc';

interface ReceiptSummary {
  attestation_id: string;
  package_id: string;
  merkle_root: string;
  manifest_canonical_sha256: string;
  confirmed_at: string;
  issued_at: string;
  device_signature?: {
    key_id: string;
    algorithm: string;
    verified: boolean;
  };
  signatures?: Array<{
    signer_kind: string;
    key_id: string;
    algorithm: string;
  }>;
}

interface AttestationAttemptLike {
  state: string;
  isConfirmed: boolean;
  createdAt: string;
  failedAt: string | null;
}

interface GoogleDriveSourceMetadata {
  provider: 'google_drive';
  fileId: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  modifiedTime?: string;
  selectedByUserId?: string;
  selectedAt?: string;
  googleAccountEmail?: string;
}

interface ModelReleaseSourceMetadata {
  provider: 'model_release';
  recordType: 'model_provenance_record';
  schemaVersion: string;
  canonicalHash: string;
  modelName: string;
  modelVersion: string;
  modelType: string;
  releaseStage: string;
  claimType: string;
  claimText: string;
  claimScope: string;
  subjectType: string;
  subjectIdentifier: string;
  subjectHash: string;
  artifactManifestHash: string;
  modelCardHash: string;
  datasetManifestHash: string;
  evaluationReportHash: string;
  riskReviewHash?: string;
  policyId: string;
  policyVersion: string;
  policyDecision: string;
  finalApprover: string;
  finalApprovalTimestamp: string;
  disclosureMode: string;
  verificationPolicy: string;
  createdByUserId?: string;
  createdAt?: string;
  retentionPeriod?: string;
  knownLimitations?: string;
}

type AttestationSourceMetadata =
  | GoogleDriveSourceMetadata
  | ModelReleaseSourceMetadata;

interface AttestationSourceAttemptLike {
  isConfirmed: boolean;
  sourceMetadata?: AttestationSourceMetadata | null;
}

interface TenantMemberCacheEntry {
  userId: string;
  workspaces?: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
  }>;
}

type HashMode = 'file' | 'external' | 'google_drive' | 'model_release';

interface ModelReleaseFormState {
  modelName: string;
  modelVersion: string;
  modelType: string;
  releaseStage: string;
  claimType: string;
  claimText: string;
  claimScope: string;
  subjectType: string;
  subjectIdentifier: string;
  subjectHash: string;
  artifactManifestHash: string;
  modelCardHash: string;
  datasetManifestHash: string;
  evaluationReportHash: string;
  riskReviewHash: string;
  policyId: string;
  policyVersion: string;
  policyDecision: string;
  finalApprover: string;
  finalApprovalTimestamp: string;
  disclosureMode: string;
  verificationPolicy: string;
  retentionPeriod: string;
  knownLimitations: string;
}

const DEFAULT_GRANT_EMAIL = import.meta.env.DEV
  ? 'verifier-eval@example.com'
  : '';
const DEFAULT_MODEL_RELEASE_FORM: ModelReleaseFormState = {
  modelName: '',
  modelVersion: '',
  modelType: 'LLM',
  releaseStage: 'production',
  claimType: 'model_release_approved',
  claimText: 'This model version was approved for production release.',
  claimScope: 'full_release_package',
  subjectType: 'model_artifact',
  subjectIdentifier: '',
  subjectHash: '',
  artifactManifestHash: '',
  modelCardHash: '',
  datasetManifestHash: '',
  evaluationReportHash: '',
  riskReviewHash: '',
  policyId: '',
  policyVersion: '',
  policyDecision: 'approved',
  finalApprover: '',
  finalApprovalTimestamp: '',
  disclosureMode: 'public_receipt_private_evidence',
  verificationPolicy: 'verify_model_release_claim',
  retentionPeriod: '',
  knownLimitations: '',
};
const PROJECT_NOUN_OPTIONS = [
  'Project',
  'Team',
  'Case',
  'Client',
  'Department',
  'Matter',
  'Engagement',
] as const;
const ATTESTATION_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.\-]{0,127}$/;
const ATTESTATION_NAME_HELP =
  'Use letters, numbers, spaces, dots, underscores, or hyphens. The name must start with a letter or number.';
const SHOW_GOOGLE_SURFACES = false;

export const HomeRoute = (): React.JSX.Element => {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<HomeView>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<
    string | null
  >(null);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceCreateName, setWorkspaceCreateName] = useState('');
  const [workspaceCreateError, setWorkspaceCreateError] = useState<
    string | null
  >(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [settingsProjectNoun, setSettingsProjectNoun] = useState('Project');
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectSlug, setProjectSlug] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectViewMode, setProjectViewMode] =
    useState<ProjectViewMode>('list');
  const [updatingProjectSlug, setUpdatingProjectSlug] = useState<string | null>(
    null,
  );
  const [attestationProjectSlug, setAttestationProjectSlug] = useState('');
  const [attestationLabel, setAttestationLabel] = useState('');
  const [hashMode, setHashMode] = useState<HashMode>('file');
  const [attestationFiles, setAttestationFiles] = useState<
    AttestationFileInput[]
  >([]);
  const [externalHash, setExternalHash] = useState('');
  const [driveFileReference, setDriveFileReference] = useState('');
  const [driveFileName, setDriveFileName] = useState('');
  const [driveMimeType, setDriveMimeType] = useState('');
  const [driveModifiedTime, setDriveModifiedTime] = useState('');
  const [driveAccountEmail, setDriveAccountEmail] = useState('');
  const [modelReleaseForm, setModelReleaseForm] =
    useState<ModelReleaseFormState>(DEFAULT_MODEL_RELEASE_FORM);
  const [hashing, setHashing] = useState(false);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const [attestationDropActive, setAttestationDropActive] = useState(false);
  const [attestationResults, setAttestationResults] = useState<
    AttestationSubmitResult[]
  >([]);
  const [submittingAttestation, setSubmittingAttestation] = useState(false);
  const [selectedAttestationId, setSelectedAttestationId] = useState('');
  const [attestationSearch, setAttestationSearch] = useState('');
  const [attestationStatusFilter, setAttestationStatusFilter] =
    useState<AttestationStatusFilter>('all');
  const [attestationSort, setAttestationSort] = useState<AttestationSort>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [attestationPage, setAttestationPage] = useState(1);
  const [attestationViewMode, setAttestationViewMode] =
    useState<AttestationViewMode>('list');
  const [attestationDetailTab, setAttestationDetailTab] =
    useState<AttestationDetailTab>('records');
  const [attestationColumnWidths, setAttestationColumnWidths] =
    useState<AttestationColumnWidths>(DEFAULT_ATTESTATION_COLUMN_WIDTHS);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] =
    useState<ProjectStatusFilter>('all');
  const [projectSort, setProjectSort] = useState<ProjectSort>({
    key: 'name',
    direction: 'asc',
  });
  const [projectPage, setProjectPage] = useState(1);
  const [projectColumnWidths, setProjectColumnWidths] =
    useState<ProjectColumnWidths>(DEFAULT_PROJECT_COLUMN_WIDTHS);
  const [requestSearch, setRequestSearch] = useState('');
  const [requestStatusFilter, setRequestStatusFilter] =
    useState<RequestStatusFilter>('all');
  const [requestSort, setRequestSort] = useState<RequestSort>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [requestPage, setRequestPage] = useState(1);
  const [requestColumnWidths, setRequestColumnWidths] =
    useState<RequestColumnWidths>(DEFAULT_REQUEST_COLUMN_WIDTHS);
  const [eventSearch, setEventSearch] = useState('');
  const [eventsTab, setEventsTab] = useState<EventsTab>('records');
  const [eventCategoryFilter, setEventCategoryFilter] = useState('all');
  const [eventProjectExportFilter, setEventProjectExportFilter] =
    useState('all');
  const [eventActorExportFilter, setEventActorExportFilter] = useState('all');
  const [eventExportScope, setEventExportScope] = useState<
    'workspace' | 'organization'
  >('workspace');
  const [eventExportFrom, setEventExportFrom] = useState('');
  const [eventExportTo, setEventExportTo] = useState('');
  const [eventSort, setEventSort] = useState<EventSort>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [eventPage, setEventPage] = useState(1);
  const [eventColumnWidths, setEventColumnWidths] =
    useState<EventColumnWidths>(DEFAULT_EVENT_COLUMN_WIDTHS);
  const [eventExportMessage, setEventExportMessage] = useState<string | null>(
    null,
  );
  const [exportingEventsFormat, setExportingEventsFormat] = useState<
    'json' | 'csv' | null
  >(null);
  const [exportingEvidenceManifest, setExportingEvidenceManifest] =
    useState(false);
  const [downloadingEvidenceExportJobId, setDownloadingEvidenceExportJobId] =
    useState<string | null>(null);
  const [downloadingEvidenceBundleJobId, setDownloadingEvidenceBundleJobId] =
    useState<string | null>(null);
  const [detailEventSearch, setDetailEventSearch] = useState('');
  const [detailEventCategoryFilter, setDetailEventCategoryFilter] =
    useState('all');
  const [detailEventSort, setDetailEventSort] = useState<EventSort>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [detailEventPage, setDetailEventPage] = useState(1);
  const [expandedDetailEventIds, setExpandedDetailEventIds] = useState<
    Set<string>
  >(new Set());
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [receiptJson, setReceiptJson] = useState<string | null>(null);
  const [receiptSummary, setReceiptSummary] = useState<ReceiptSummary | null>(
    null,
  );
  const [receiptLinkMessage, setReceiptLinkMessage] = useState<string | null>(
    null,
  );
  const [receiptLinkIdOverride, setReceiptLinkIdOverride] = useState<
    string | null
  >(null);
  const [resolvingReceiptBundle, setResolvingReceiptBundle] = useState(false);
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const [verifierLinkMessage, setVerifierLinkMessage] = useState<string | null>(
    null,
  );
  const [grantEmail, setGrantEmail] = useState(DEFAULT_GRANT_EMAIL);
  const [grantNote, setGrantNote] = useState('');
  const [grantNoteEdited, setGrantNoteEdited] = useState(false);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);
  const [grantingAccess, setGrantingAccess] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const [verifierFormOpen, setVerifierFormOpen] = useState(false);
  const [verifierSearch, setVerifierSearch] = useState('');
  const [verifierStatusFilter, setVerifierStatusFilter] =
    useState<VerifierStatusFilter>('all');
  const [verifierSort, setVerifierSort] = useState<VerifierSort>({
    key: 'createdAt',
    direction: 'desc',
  });
  const [verifierPage, setVerifierPage] = useState(1);
  const [verifierColumnWidths, setVerifierColumnWidths] =
    useState<VerifierColumnWidths>(DEFAULT_VERIFIER_COLUMN_WIDTHS);
  const [accessRequestMessage, setAccessRequestMessage] = useState<
    string | null
  >(null);
  const [resolvingAccessRequestId, setResolvingAccessRequestId] = useState<
    string | null
  >(null);
  const [accessRequestDecisionReasons, setAccessRequestDecisionReasons] =
    useState<Record<string, string>>({});
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] =
    useState<MemberRoleFilter>('all');
  const [memberSort, setMemberSort] = useState<MemberSort>({
    key: 'user',
    direction: 'asc',
  });
  const [memberPage, setMemberPage] = useState(1);
  const [memberColumnWidths, setMemberColumnWidths] =
    useState<MemberColumnWidths>(DEFAULT_MEMBER_COLUMN_WIDTHS);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>({
    key: 'name',
    direction: 'asc',
  });
  const [workspacePage, setWorkspacePage] = useState(1);
  const [workspaceColumnWidths, setWorkspaceColumnWidths] =
    useState<WorkspaceColumnWidths>(DEFAULT_WORKSPACE_COLUMN_WIDTHS);
  const [updatingWorkspaceId, setUpdatingWorkspaceId] = useState<string | null>(
    null,
  );
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);
  const [disconnectingIdentityId, setDisconnectingIdentityId] = useState<
    string | null
  >(null);
  const [connectingIdentityProvider, setConnectingIdentityProvider] = useState<
    string | null
  >(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<'tenant_admin' | 'producer'>('producer');
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberEditDrafts, setMemberEditDrafts] = useState<
    Record<string, MemberEditDraft>
  >({});
  const [selectedMemberDetailId, setSelectedMemberDetailId] = useState<
    string | null
  >(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [savingMemberAccessId, setSavingMemberAccessId] = useState<
    string | null
  >(null);
  const [revokingInvitationId, setRevokingInvitationId] = useState<
    string | null
  >(null);
  const hasActiveSubmittedAttestations = [
    ...attestationResults,
    ...attestationFiles.flatMap((file) => (file.result ? [file.result] : [])),
  ].some((result) => result.ok && isActiveAttestationState(result.state));
  const submittedAttestationResults = [
    ...attestationResults,
    ...attestationFiles.flatMap((file) => (file.result ? [file.result] : [])),
  ];
  const submittedSuccessResults = submittedAttestationResults.filter(
    (result): result is AttestationSubmitSuccess => result.ok,
  );
  const submittedConfirmedResults = submittedSuccessResults.filter(
    (result) => result.state === 'confirmed',
  );
  const expectedSubmissionCount =
    hashMode === 'file' || hashMode === 'google_drive'
      ? attestationFiles.length
      : externalHash.trim().length > 0
        ? 1
        : 0;
  const submissionProgress = getSubmissionProgress({
    expectedCount: expectedSubmissionCount,
    hashing,
    submitting: submittingAttestation,
    results: submittedAttestationResults,
  });
  const submissionBatchSummary = getSubmissionBatchSummary({
    expectedCount: expectedSubmissionCount,
    fileCount: attestationFiles.length,
    hashMode,
    hashing,
    submitting: submittingAttestation,
    results: submittedAttestationResults,
  });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const result = await rpc.auth.currentSession();
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const workspaceRole = session.data?.activeWorkspace.role ?? 'producer';
  const workspacePlan = session.data?.activeWorkspace.plan ?? 'free';
  const activeWorkspaceId = session.data?.activeWorkspace.id;
  const activeOrganization = session.data?.organizations.find(
    (organization) =>
      organization.id === session.data?.activeWorkspace.organizationId,
  );
  const canExportOrganizationEvents =
    activeOrganization?.role === 'organization_admin';
  const canGenerateContentProof = workspacePlan !== 'free';
  const canManageWorkspace = workspaceRole === 'tenant_admin';
  const projectNoun =
    activeOrganization?.projectNoun ??
    session.data?.activeWorkspace.projectNoun ??
    'Project';
  const projectNounPlural = pluralizeProjectNoun(projectNoun);
  const projectNounLower = projectNoun.toLowerCase();
  const projectNounPluralLower = projectNounPlural.toLowerCase();
  const projects = useQuery({
    queryKey: ['projects', canManageWorkspace],
    enabled: Boolean(session.data),
    queryFn: async () => {
      const result = await rpc.projects.list({
        includeArchived: canManageWorkspace,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.projects;
    },
  });
  const attestations = useQuery({
    queryKey: ['attestations', attestationProjectSlug],
    enabled: Boolean(attestationProjectSlug),
    refetchInterval:
      activeView === 'attestations' && hasActiveSubmittedAttestations
        ? 3000
        : activeView === 'attestations' && attestationViewMode === 'list'
          ? 15000
          : false,
    queryFn: async () => {
      const result = await rpc.attestations.list({
        projectSlug: attestationProjectSlug,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.attestations;
    },
  });
  const recentAttestations = useQuery({
    queryKey: ['attestations-recent'],
    enabled: Boolean(session.data),
    refetchInterval:
      activeView === 'attestations' && hasActiveSubmittedAttestations
        ? 5000
        : false,
    queryFn: async () => {
      const result = await rpc.attestations.recent({ limit: 8 });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.attestations;
    },
  });
  const selectedAttestation = useQuery({
    queryKey: ['attestation', selectedAttestationId],
    enabled: Boolean(selectedAttestationId),
    queryFn: async () => {
      const result = await rpc.attestations.get({
        attestationId: selectedAttestationId,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const devices = useQuery({
    queryKey: ['devices'],
    enabled: Boolean(session.data),
    queryFn: async () => {
      const result = await rpc.devices.list();
      if (!result.ok) throw new Error(result.error.message);
      return result.value.devices;
    },
  });
  const workspaceDevices = useQuery({
    queryKey: ['workspace-devices', session.data?.activeWorkspace.id],
    enabled: Boolean(session.data) && canManageWorkspace,
    queryFn: async () => {
      const result = await rpc.devices.listForWorkspace();
      if (!result.ok) throw new Error(result.error.message);
      return result.value.devices;
    },
  });
  const externalIdentities = useQuery({
    queryKey: ['external-identities'],
    enabled: Boolean(session.data),
    queryFn: async () => {
      const result = await rpc.externalIdentities.list();
      if (!result.ok) throw new Error(result.error.message);
      return result.value.identities;
    },
  });
  const profileOidcProviders = useQuery({
    queryKey: ['profile-oidc-providers', session.data?.apiUrl],
    enabled: Boolean(session.data),
    queryFn: async () => {
      const apiUrl = session.data?.apiUrl ?? '';
      const result = await rpc.auth.oidcProviders({ apiUrl });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.providers;
    },
  });
  const visibleExternalIdentities =
    externalIdentities.data?.filter(
      (identity) =>
        SHOW_GOOGLE_SURFACES || identity.providerSlug !== 'google',
    ) ?? [];
  const visibleProfileOidcProviders =
    profileOidcProviders.data?.filter(
      (provider) => SHOW_GOOGLE_SURFACES || provider.slug !== 'google',
    ) ?? [];
  const connectedGoogleIdentity = SHOW_GOOGLE_SURFACES
    ? externalIdentities.data?.find(
        (identity) =>
          identity.providerSlug === 'google' && !identity.disconnectedAt,
      )
    : undefined;
  const accessGrants = useQuery({
    queryKey: ['attestation-access-grants', selectedAttestationId],
    enabled: Boolean(selectedAttestationId),
    queryFn: async () => {
      const result = await rpc.attestations.accessGrants.list({
        attestationId: selectedAttestationId,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.grants;
    },
  });
  const accessRequests = useQuery({
    queryKey: ['attestation-access-requests'],
    enabled: Boolean(session.data),
    refetchInterval:
      activeView === 'overview' || activeView === 'requests' ? 15000 : false,
    queryFn: async () => {
      const result = await rpc.attestations.accessRequests.list({
        status: 'all',
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.requests;
    },
  });
  const members = useQuery({
    queryKey: ['tenant-members'],
    enabled: Boolean(session.data) && canManageWorkspace,
    queryFn: async () => {
      const result = await rpc.tenant.members.list();
      if (!result.ok) throw new Error(result.error.message);
      return result.value.members;
    },
  });
  const invitations = useQuery({
    queryKey: ['tenant-invitations'],
    enabled: Boolean(session.data) && canManageWorkspace,
    queryFn: async () => {
      const result = await rpc.tenant.invitations.list();
      if (!result.ok) throw new Error(result.error.message);
      return result.value.invitations;
    },
  });
  const audit = useQuery({
    queryKey: ['tenant-audit'],
    enabled: Boolean(session.data),
    queryFn: async () => {
      const result = await rpc.tenant.audit.list({ limit: 50 });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const evidenceExportJobs = useQuery({
    queryKey: ['tenant-evidence-export-jobs'],
    enabled: Boolean(session.data) && canManageWorkspace,
    queryFn: async () => {
      const result = await rpc.tenant.evidenceExport.listJobs({ limit: 5 });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.jobs;
    },
  });
  const modelReleaseRecord = useMemo(
    () => buildModelReleaseRecord(modelReleaseForm),
    [modelReleaseForm],
  );
  const [modelReleaseHash, setModelReleaseHash] = useState('');
  useEffect(() => {
    let canceled = false;
    void sha256TextHex(stableCanonicalJson(modelReleaseRecord)).then((hash) => {
      if (!canceled) setModelReleaseHash(hash);
    });
    return () => {
      canceled = true;
    };
  }, [modelReleaseRecord]);
  const submittedHash =
    hashMode === 'external'
      ? externalHash.trim().toLowerCase()
      : hashMode === 'model_release'
        ? modelReleaseHash
        : '';
  const modelReleaseReady =
    isValidAttestationName(attestationLabel) &&
    Boolean(modelReleaseForm.modelName.trim()) &&
    Boolean(modelReleaseForm.modelVersion.trim()) &&
    Boolean(modelReleaseForm.claimText.trim()) &&
    Boolean(modelReleaseForm.subjectIdentifier.trim()) &&
    HEX64.test(modelReleaseForm.subjectHash.trim().toLowerCase()) &&
    HEX64.test(modelReleaseForm.artifactManifestHash.trim().toLowerCase()) &&
    HEX64.test(modelReleaseForm.modelCardHash.trim().toLowerCase()) &&
    HEX64.test(modelReleaseForm.datasetManifestHash.trim().toLowerCase()) &&
    HEX64.test(modelReleaseForm.evaluationReportHash.trim().toLowerCase()) &&
    (!modelReleaseForm.riskReviewHash.trim() ||
      HEX64.test(modelReleaseForm.riskReviewHash.trim().toLowerCase())) &&
    Boolean(modelReleaseForm.policyId.trim()) &&
    Boolean(modelReleaseForm.policyVersion.trim()) &&
    Boolean(modelReleaseForm.finalApprover.trim()) &&
    Boolean(modelReleaseForm.finalApprovalTimestamp.trim()) &&
    HEX64.test(modelReleaseHash);
  const driveFileId = parseGoogleDriveFileId(driveFileReference);
  const fileAttestationsReady =
    (hashMode === 'file' || hashMode === 'google_drive') &&
    attestationFiles.length > 0 &&
    attestationFiles.every(
      (file) =>
        isValidAttestationName(file.label) &&
        HEX64.test(file.hash) &&
        !file.error,
    );
  const attestationSubmissionLocked =
    submittingAttestation ||
    attestationFiles.some((file) => Boolean(file.result)) ||
    attestationResults.length > 0;
  const recentAttestationById = useMemo(
    () =>
      new Map(
        (recentAttestations.data ?? []).map((attestation) => [
          attestation.id,
          attestation,
        ]),
      ),
    [recentAttestations.data],
  );
  const submittedAttestationSnapshotById = useMemo(() => {
    const snapshots = new Map<string, AttestationStateSnapshot>();
    for (const attestation of attestations.data ?? []) {
      snapshots.set(attestation.id, {
        state: attestation.state,
        confirmedAt: attestation.confirmedAt,
      });
    }
    for (const attestation of recentAttestations.data ?? []) {
      snapshots.set(attestation.id, {
        state: attestation.state,
        confirmedAt: attestation.confirmedAt,
      });
    }
    return snapshots;
  }, [attestations.data, recentAttestations.data]);
  const selectedProjectAttestation = attestations.data?.find(
    (attestation) => attestation.id === selectedAttestationId,
  );
  const selectedRecentAttestation = selectedAttestationId
    ? recentAttestationById.get(selectedAttestationId)
    : undefined;
  const selectedAttestationSnapshot =
    selectedRecentAttestation ?? selectedProjectAttestation;
  const selectedAttestationSnapshotState = selectedAttestationSnapshot?.state;
  const selectedAttestationSnapshotConfirmedAt =
    selectedAttestationSnapshot?.confirmedAt;
  const selectedAttestationState =
    selectedAttestationSnapshotState ??
    selectedAttestation.data?.attestation.state;
  const selectedReceiptLinkId =
    receiptLinkIdOverride ??
    selectedAttestation.data?.attestation.verificationLinkId ??
    selectedAttestationSnapshot?.verificationLinkId ??
    null;
  const selectedAttestationIsActive = selectedAttestationState
    ? isActiveAttestationState(selectedAttestationState)
    : false;
  const selectedAttestationDetail = selectedAttestation.data?.attestation;
  const selectedReceiptBundlePending =
    selectedAttestationState === 'confirmed' &&
    Boolean(selectedAttestationDetail) &&
    (!selectedAttestationDetail?.receiptAvailable ||
      !selectedReceiptLinkId);
  const hasActiveAttestations =
    attestations.data?.some((attestation) =>
      isActiveAttestationState(attestation.state),
    ) ?? false;
  const visibleAttestations = useMemo(() => {
    const query = attestationSearch.trim().toLowerCase();
    const rows = (attestations.data ?? [])
      .map((attestation) => {
        const recent = recentAttestationById.get(attestation.id);
        return {
          ...attestation,
          state: recent?.state ?? attestation.state,
          confirmedAt: recent?.confirmedAt ?? attestation.confirmedAt,
        };
      })
      .filter((attestation) => {
        const batch = parseBatchDescription(attestation.description);
        const statusGroup = attestationStatusGroup(attestation.state);
        const matchesStatus =
          attestationStatusFilter === 'all' ||
          statusGroup === attestationStatusFilter;
        const matchesSearch =
          !query ||
          attestation.label.toLowerCase().includes(query) ||
          (batch?.name.toLowerCase().includes(query) ?? false) ||
          attestation.id.toLowerCase().includes(query) ||
          attestation.projectName.toLowerCase().includes(query) ||
          attestation.projectSlug.toLowerCase().includes(query) ||
          attestation.state.toLowerCase().includes(query);
        return matchesStatus && matchesSearch;
      });
    rows.sort((a, b) => compareAttestations(a, b, attestationSort));
    return rows;
  }, [
    attestationSearch,
    attestationSort,
    attestationStatusFilter,
    attestations.data,
    recentAttestationById,
  ]);
  const attestationPageCount = Math.max(
    1,
    Math.ceil(visibleAttestations.length / ATTESTATION_PAGE_SIZE),
  );
  const activeAttestationPage = Math.min(
    attestationPage,
    attestationPageCount,
  );
  const pagedAttestations = visibleAttestations.slice(
    (activeAttestationPage - 1) * ATTESTATION_PAGE_SIZE,
    activeAttestationPage * ATTESTATION_PAGE_SIZE,
  );
  const pendingAccessRequestCount =
    accessRequests.data?.filter((request) => request.status === 'pending')
      .length ?? 0;
  const auditEvents = audit.data?.events ?? [];
  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    const rows = (projects.data ?? []).filter((project) => {
      const status = project.archivedAt ? 'archived' : 'active';
      const matchesStatus =
        projectStatusFilter === 'all' || projectStatusFilter === status;
      const matchesSearch =
        !query ||
        project.name.toLowerCase().includes(query) ||
        project.visibility.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
    rows.sort((a, b) => compareProjects(a, b, projectSort));
    return rows;
  }, [projectSearch, projectSort, projectStatusFilter, projects.data]);
  const projectPageCount = Math.max(
    1,
    Math.ceil(visibleProjects.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeProjectPage = Math.min(projectPage, projectPageCount);
  const pagedProjects = visibleProjects.slice(
    (activeProjectPage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeProjectPage * STANDARD_TABLE_PAGE_SIZE,
  );
  const visibleWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    const rows = [...(session.data?.workspaces ?? [])].filter((workspace) => {
      const matchesSearch =
        !query ||
        workspace.name.toLowerCase().includes(query) ||
        workspace.slug.toLowerCase().includes(query) ||
        roleLabel(workspace.role).toLowerCase().includes(query);
      return matchesSearch;
    });
    rows.sort((a, b) =>
      compareWorkspaces(a, b, workspaceSort, session.data?.activeWorkspace.id),
    );
    return rows;
  }, [
    session.data?.activeWorkspace.id,
    session.data?.workspaces,
    workspaceSearch,
    workspaceSort,
  ]);
  const workspacePageCount = Math.max(
    1,
    Math.ceil(visibleWorkspaces.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeWorkspacePage = Math.min(workspacePage, workspacePageCount);
  const pagedWorkspaces = visibleWorkspaces.slice(
    (activeWorkspacePage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeWorkspacePage * STANDARD_TABLE_PAGE_SIZE,
  );
  const devicesByMemberId = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof workspaceDevices.data>>();
    for (const device of workspaceDevices.data ?? []) {
      const current = grouped.get(device.userId) ?? [];
      current.push(device);
      grouped.set(device.userId, current);
    }
    for (const memberDevices of grouped.values()) {
      memberDevices.sort((a, b) => b.pairedAt.localeCompare(a.pairedAt));
    }
    return grouped;
  }, [workspaceDevices.data]);
  const visibleMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    const activeWorkspace = session.data?.activeWorkspace;
    const rows: UserRosterRow[] = [
      ...(members.data ?? []).map(
        (member): UserRosterRow => ({
          ...member,
          kind: 'member',
          status: 'active',
        }),
      ),
      ...(invitations.data ?? []).map(
        (invitation): UserRosterRow => ({
          kind: 'invitation',
          id: invitation.id,
          userId: `invitation:${invitation.id}`,
          email: invitation.email,
          displayName: null,
          role: invitation.role,
          organizationRole: 'member',
          joinedAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
          status: 'pending',
          workspaces: activeWorkspace
            ? [
                {
                  id: activeWorkspace.id,
                  slug: activeWorkspace.slug,
                  name: activeWorkspace.name,
                  role: invitation.role,
                },
              ]
            : [],
        }),
      ),
    ].filter((member) => {
      const workspaceNames = (member.workspaces ?? [])
        .map((workspace) => workspace.name)
        .join(' ')
        .toLowerCase();
      const isOrgAdmin = member.organizationRole === 'organization_admin';
      const matchesRole =
        memberRoleFilter === 'all' ||
        member.role === memberRoleFilter ||
        (memberRoleFilter === 'organization_admin' && isOrgAdmin);
      const matchesSearch =
        !query ||
        member.email.toLowerCase().includes(query) ||
        (member.displayName ?? '').toLowerCase().includes(query) ||
        member.status.toLowerCase().includes(query) ||
        roleLabel(member.role).toLowerCase().includes(query) ||
        organizationRoleLabel(member.organizationRole)
          .toLowerCase()
          .includes(query) ||
        workspaceNames.includes(query);
      return matchesRole && matchesSearch;
    });
    rows.sort((a, b) => compareMembers(a, b, memberSort));
    return rows;
  }, [
    invitations.data,
    memberRoleFilter,
    memberSearch,
    memberSort,
    members.data,
    session.data?.activeWorkspace,
  ]);
  const memberPageCount = Math.max(
    1,
    Math.ceil(visibleMembers.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeMemberPage = Math.min(memberPage, memberPageCount);
  const pagedMembers = visibleMembers.slice(
    (activeMemberPage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeMemberPage * STANDARD_TABLE_PAGE_SIZE,
  );
  const selectedMemberDetail = useMemo(
    () =>
      selectedMemberDetailId
        ? visibleMembers.find(
            (member): member is MemberRosterRow =>
              member.kind === 'member' &&
              member.userId === selectedMemberDetailId,
          ) ?? null
        : null,
    [selectedMemberDetailId, visibleMembers],
  );
  const selectedMemberCurrentDevice =
    selectedMemberDetail?.kind === 'member'
      ? (devicesByMemberId.get(selectedMemberDetail.userId) ?? []).find(
          (device) => !device.revokedAt,
        ) ?? null
      : null;
  const visibleRequests = useMemo(() => {
    const query = requestSearch.trim().toLowerCase();
    const rows = (accessRequests.data ?? []).filter((request) => {
      const matchesStatus =
        requestStatusFilter === 'all' || request.status === requestStatusFilter;
      const matchesSearch =
        !query ||
        request.requestedByEmail.toLowerCase().includes(query) ||
        request.attestation.label.toLowerCase().includes(query) ||
        request.project.name.toLowerCase().includes(query) ||
        request.status.toLowerCase().includes(query) ||
        (request.message ?? '').toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
    rows.sort((a, b) => compareRequests(a, b, requestSort));
    return rows;
  }, [
    accessRequests.data,
    requestSearch,
    requestSort,
    requestStatusFilter,
  ]);
  const requestPageCount = Math.max(
    1,
    Math.ceil(visibleRequests.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeRequestPage = Math.min(requestPage, requestPageCount);
  const pagedRequests = visibleRequests.slice(
    (activeRequestPage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeRequestPage * STANDARD_TABLE_PAGE_SIZE,
  );
  const eventCategories = useMemo(
    () => Array.from(new Set(auditEvents.map((event) => event.category))).sort(),
    [auditEvents],
  );
  const visibleEvents = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();
    const rows = auditEvents.filter((event) => {
      const actor = auditActorLabel(event).toLowerCase();
      const target = `${event.targetType ?? ''} ${event.targetId ?? ''}`.toLowerCase();
      const matchesCategory =
        eventCategoryFilter === 'all' || event.category === eventCategoryFilter;
      const matchesSearch =
        !query ||
        auditActionLabel(event.action).toLowerCase().includes(query) ||
        event.action.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        actor.includes(query) ||
        target.includes(query);
      return matchesCategory && matchesSearch;
    });
    rows.sort((a, b) => compareEvents(a, b, eventSort));
    return rows;
  }, [auditEvents, eventCategoryFilter, eventSearch, eventSort]);
  const eventPageCount = Math.max(
    1,
    Math.ceil(visibleEvents.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeEventPage = Math.min(eventPage, eventPageCount);
  const pagedEvents = visibleEvents.slice(
    (activeEventPage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeEventPage * STANDARD_TABLE_PAGE_SIZE,
  );
  const visibleAccessGrants = useMemo(() => {
    const query = verifierSearch.trim().toLowerCase();
    const rows = (accessGrants.data ?? []).filter((grant) => {
      const status = grant.pending ? 'pending' : 'claimed';
      const matchesStatus =
        verifierStatusFilter === 'all' || verifierStatusFilter === status;
      const matchesSearch =
        !query ||
        grant.grantedToEmail.toLowerCase().includes(query) ||
        grant.id.toLowerCase().includes(query) ||
        status.includes(query);
      return matchesStatus && matchesSearch;
    });
    rows.sort((a, b) => compareVerifierGrants(a, b, verifierSort));
    return rows;
  }, [accessGrants.data, verifierSearch, verifierSort, verifierStatusFilter]);
  const verifierPageCount = Math.max(
    1,
    Math.ceil(visibleAccessGrants.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeVerifierPage = Math.min(verifierPage, verifierPageCount);
  const pagedAccessGrants = visibleAccessGrants.slice(
    (activeVerifierPage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeVerifierPage * STANDARD_TABLE_PAGE_SIZE,
  );
  const recentAttestationRows = recentAttestations.data ?? [];
  const activeRecentAttestationCount = recentAttestationRows.filter(
    (attestation) => isActiveAttestationState(attestation.state),
  ).length;
  const failedRecentAttestationCount = recentAttestationRows.filter(
    (attestation) => attestationStatusGroup(attestation.state) === 'failed',
  ).length;
  const confirmedRecentAttestationCount = recentAttestationRows.filter(
    (attestation) => attestation.state === 'confirmed',
  ).length;
  const recentVerifierActivity = auditEvents
    .filter((event) => isVerifierActivityAction(event.action))
    .slice(0, 5);
  const overviewAttentionItems = [
    ...(pendingAccessRequestCount > 0
      ? [
          {
            title: 'Verifier requests need review',
            body: `${pendingAccessRequestCount} verifier ${
              pendingAccessRequestCount === 1 ? 'request is' : 'requests are'
            } waiting for an approve or deny decision.`,
            action: 'Review verification requests',
            onClick: () => setActiveView('requests'),
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(activeRecentAttestationCount > 0
      ? [
          {
            title: 'Attestations are still processing',
            body: `${activeRecentAttestationCount} recent ${
              activeRecentAttestationCount === 1
                ? 'attestation has'
                : 'attestations have'
            } not reached confirmation yet.`,
            action: 'Open attestations',
            onClick: () => setActiveView('attestations'),
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(failedRecentAttestationCount > 0
      ? [
          {
            title: 'Recent attestation failure',
            body: `${failedRecentAttestationCount} recent ${
              failedRecentAttestationCount === 1
                ? 'attestation needs'
                : 'attestations need'
            } review before retrying.`,
            action: 'Review failures',
            onClick: () => setActiveView('attestations'),
            tone: 'danger' as const,
          },
        ]
      : []),
  ];
  const selectedAttestationAuditEvents = useMemo(
    () =>
      auditEvents.filter((event) => {
        if (!selectedAttestationId) return false;
        if (event.targetId === selectedAttestationId) return true;
        try {
          return JSON.stringify(event.payload).includes(selectedAttestationId);
        } catch {
          return false;
        }
      }),
    [auditEvents, selectedAttestationId],
  );
  const detailEventCategories = useMemo(
    () =>
      Array.from(
        new Set(selectedAttestationAuditEvents.map((event) => event.category)),
      ).sort(),
    [selectedAttestationAuditEvents],
  );
  const visibleDetailEvents = useMemo(() => {
    const query = detailEventSearch.trim().toLowerCase();
    const rows = selectedAttestationAuditEvents.filter((event) => {
      const actor = auditActorLabel(event).toLowerCase();
      const target = `${event.targetType ?? ''} ${event.targetId ?? ''}`.toLowerCase();
      const matchesCategory =
        detailEventCategoryFilter === 'all' ||
        event.category === detailEventCategoryFilter;
      const matchesSearch =
        !query ||
        auditActionLabel(event.action).toLowerCase().includes(query) ||
        event.action.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        actor.includes(query) ||
        target.includes(query);
      return matchesCategory && matchesSearch;
    });
    rows.sort((a, b) => compareEvents(a, b, detailEventSort));
    return rows;
  }, [
    detailEventCategoryFilter,
    detailEventSearch,
    detailEventSort,
    selectedAttestationAuditEvents,
  ]);
  const detailEventPageCount = Math.max(
    1,
    Math.ceil(visibleDetailEvents.length / STANDARD_TABLE_PAGE_SIZE),
  );
  const activeDetailEventPage = Math.min(
    detailEventPage,
    detailEventPageCount,
  );
  const pagedDetailEvents = visibleDetailEvents.slice(
    (activeDetailEventPage - 1) * STANDARD_TABLE_PAGE_SIZE,
    activeDetailEventPage * STANDARD_TABLE_PAGE_SIZE,
  );
  const activeProjects = useMemo(
    () => projects.data?.filter((project) => !project.archivedAt) ?? [],
    [projects.data],
  );
  const attestationProject = activeProjects.find(
    (project) => project.slug === attestationProjectSlug,
  );
  const projectCount = activeProjects.length;
  const archivedProjectCount =
    projects.data?.filter((project) => project.archivedAt).length ?? 0;
  const attestationCount = attestations.data?.length ?? 0;
  const hasProjects = projectCount > 0;
  const hasAttestations = attestationCount > 0;
  const resetNewProjectForm = (): void => {
    setProjectName('');
    setProjectSlug('');
    setProjectError(null);
  };
  const resetNewAttestationForm = (): void => {
    setHashMode('file');
    setAttestationLabel('');
    setAttestationFiles([]);
    setExternalHash('');
    setDriveFileReference('');
    setDriveFileName('');
    setDriveMimeType('');
    setDriveModifiedTime('');
    setDriveAccountEmail('');
    setAttestationError(null);
    setAttestationDropActive(false);
    setAttestationResults([]);
    setSubmittingAttestation(false);
    setHashing(false);
    setReceiptMessage(null);
    setVerifierLinkMessage(null);
    if (activeProjects[0]) {
      setAttestationProjectSlug(activeProjects[0].slug);
    }
  };
  const overviewNextActions = [
    ...(!hasProjects
      ? [
          {
            label: `Create the first ${projectNounLower}`,
            description: `${projectNounPlural} group evidence before attestations are made.`,
            onClick: () => {
              setActiveView('projects');
              resetNewProjectForm();
              setProjectViewMode('new');
            },
          },
        ]
      : []),
    ...(hasProjects && !hasAttestations
      ? [
          {
            label: 'Submit the first attestation',
            description: 'Hash a file locally or paste an external SHA-256.',
            onClick: () => {
              setActiveView('attestations');
              resetNewAttestationForm();
              setAttestationViewMode('new');
            },
          },
        ]
      : []),
    ...(pendingAccessRequestCount === 0
      ? [
          {
            label: 'Review verifier access',
            description: 'Open attestation details to grant or revoke lookup access.',
            onClick: () => setActiveView('attestations'),
          },
        ]
      : []),
    {
      label: 'Check audit trail',
      description: 'Review workspace activity and verifier decisions.',
      onClick: () => setActiveView('audit'),
    },
  ].slice(0, 4);
  const canSubmitAttestation =
    !hashing &&
    !attestationSubmissionLocked &&
    Boolean(attestationProjectSlug) &&
    (hashMode === 'file'
      ? fileAttestationsReady
      : hashMode === 'google_drive'
        ? fileAttestationsReady && Boolean(driveFileId)
        : hashMode === 'model_release'
          ? modelReleaseReady
          : isValidAttestationName(attestationLabel) && HEX64.test(submittedHash));
  const receiptPdfUrl = buildVerificationPdfUrl(
    session.data?.apiUrl,
    selectedReceiptLinkId,
  );
  const selectedReceiptAvailable =
    selectedAttestation.data?.attestation.receiptAvailable ?? false;
  const verifierLookupUrl = buildVerifierLookupUrl(
    session.data?.apiUrl,
    selectedAttestationId,
  );

  useEffect(() => {
    if (!SHOW_GOOGLE_SURFACES && hashMode === 'google_drive') {
      setHashMode('file');
    }
  }, [hashMode]);

  useEffect(() => {
    setSettingsProjectNoun(projectNoun);
    setSettingsMessage(null);
  }, [projectNoun]);

  useEffect(() => {
    if (!attestationProjectSlug && activeProjects[0]) {
      setAttestationProjectSlug(activeProjects[0].slug);
    }
    if (
      attestationProjectSlug &&
      !activeProjects.some((project) => project.slug === attestationProjectSlug)
    ) {
      setAttestationProjectSlug(activeProjects[0]?.slug ?? '');
      setSelectedAttestationId('');
    }
  }, [activeProjects, attestationProjectSlug]);

  useEffect(() => {
    if (!selectedAttestationId && attestations.data?.[0]) {
      setSelectedAttestationId(attestations.data[0].id);
    }
  }, [attestations.data, selectedAttestationId]);

  useEffect(() => {
    setReceiptLinkIdOverride(null);
    setResolvingReceiptBundle(false);
  }, [selectedAttestationId]);

  useEffect(() => {
    const linkId = selectedAttestation.data?.attestation.verificationLinkId;
    if (linkId) {
      setReceiptLinkIdOverride(linkId);
    }
  }, [selectedAttestation.data?.attestation.verificationLinkId]);

  useEffect(() => {
    if (
      !selectedAttestationId ||
      !selectedReceiptAvailable ||
      selectedReceiptLinkId ||
      resolvingReceiptBundle
    ) {
      return;
    }
    let canceled = false;
    setResolvingReceiptBundle(true);
    void rpc.attestations
      .receipt({ attestationId: selectedAttestationId })
      .then((result) => {
        if (canceled) return;
        if (result.ok && result.value.verificationLinkId) {
          setReceiptLinkIdOverride(result.value.verificationLinkId);
          setReceiptMessage(null);
        } else if (!result.ok) {
          setReceiptMessage(result.error.message);
        }
      })
      .finally(() => {
        if (!canceled) setResolvingReceiptBundle(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    resolvingReceiptBundle,
    selectedAttestationId,
    selectedReceiptAvailable,
    selectedReceiptLinkId,
  ]);

  useEffect(() => {
    setAttestationPage(1);
  }, [
    attestationProjectSlug,
    attestationSearch,
    attestationSort,
    attestationStatusFilter,
  ]);

  useEffect(() => {
    if (
      !selectedAttestationSnapshotState ||
      !selectedAttestation.data ||
      selectedAttestation.isFetching
    ) {
      return;
    }
    if (
      selectedAttestation.data.attestation.state !==
        selectedAttestationSnapshotState ||
      selectedAttestation.data.attestation.confirmedAt !==
        selectedAttestationSnapshotConfirmedAt
    ) {
      void selectedAttestation.refetch();
    }
  }, [
    selectedAttestation,
    selectedAttestation.data?.attestation.confirmedAt,
    selectedAttestation.data?.attestation.state,
    selectedAttestation.isFetching,
    selectedAttestationSnapshotConfirmedAt,
    selectedAttestationSnapshotState,
  ]);

  useEffect(() => {
    if (
      !selectedAttestationIsActive &&
      !selectedReceiptBundlePending &&
      !hasActiveAttestations
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void selectedAttestation.refetch();
      void attestations.refetch();
      void recentAttestations.refetch();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [
    attestations,
    hasActiveAttestations,
    recentAttestations,
    selectedAttestation,
    selectedAttestationIsActive,
    selectedReceiptBundlePending,
  ]);

  useEffect(() => {
    if (submittedAttestationSnapshotById.size === 0) return;
    setAttestationFiles((files) => {
      let changed = false;
      const nextFiles = files.map((file) => {
        if (!file.result?.ok) return file;
        const snapshot = submittedAttestationSnapshotById.get(
          file.result.attestationId,
        );
        if (!snapshot) return file;
        if (
          file.result.state === snapshot.state &&
          file.result.confirmedAt === snapshot.confirmedAt
        ) {
          return file;
        }
        changed = true;
        return {
          ...file,
          result: {
            ...file.result,
            state: snapshot.state,
            confirmedAt: snapshot.confirmedAt,
          },
        };
      });
      return changed ? nextFiles : files;
    });
    setAttestationResults((results) => {
      let changed = false;
      const nextResults = results.map((result) => {
        if (!result.ok) return result;
        const snapshot = submittedAttestationSnapshotById.get(
          result.attestationId,
        );
        if (!snapshot) return result;
        if (
          result.state === snapshot.state &&
          result.confirmedAt === snapshot.confirmedAt
        ) {
          return result;
        }
        changed = true;
        return {
          ...result,
          state: snapshot.state,
          confirmedAt: snapshot.confirmedAt,
        };
      });
      return changed ? nextResults : results;
    });
  }, [submittedAttestationSnapshotById]);

  useEffect(() => {
    if (attestationViewMode !== 'new') return;
    if (submittedSuccessResults.length === 0) return;
    if (submittedSuccessResults.length !== expectedSubmissionCount) return;
    if (submittedConfirmedResults.length !== submittedSuccessResults.length) {
      return;
    }
    const confirmedResult = submittedConfirmedResults[0];
    if (!confirmedResult) return;
    setSelectedAttestationId(confirmedResult.attestationId);
    setAttestationViewMode('detail');
    setAttestationDetailTab('records');
    resetNewAttestationForm();
  }, [
    attestationViewMode,
    expectedSubmissionCount,
    submittedConfirmedResults,
    submittedSuccessResults,
  ]);

  const signOut = async (): Promise<void> => {
    await rpc.auth.signOut();
    setLocation('/sign-in');
  };

  const switchWorkspace = async (workspaceId: string): Promise<void> => {
    if (!session.data || workspaceId === session.data.activeWorkspace.id) return;
    if (switchingWorkspace) return;
    setWorkspaceMenuOpen(false);
    setSwitchingWorkspace(true);
    setWorkspaceSwitchError(null);
    const result = await rpc.auth.switchWorkspace({ workspaceId });
    setSwitchingWorkspace(false);
    if (!result.ok) {
      setWorkspaceSwitchError(result.error.message);
      return;
    }
    queryClient.setQueryData(['session'], {
      ...session.data,
      activeWorkspace: result.value.activeWorkspace,
      organizations: result.value.organizations,
      workspaces: result.value.workspaces,
    });
    setProjectViewMode('list');
    setAttestationViewMode('list');
    setAttestationDetailTab('records');
    resetNewProjectForm();
    resetNewAttestationForm();
    setSelectedAttestationId('');
    setAttestationProjectSlug('');
    await queryClient.invalidateQueries();
  };

  const createWorkspace = async (
    e: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!session.data || creatingWorkspace) return;
    const name = workspaceCreateName.trim();
    if (!name) {
      setWorkspaceCreateError('Enter a workspace name.');
      return;
    }
    setCreatingWorkspace(true);
    setWorkspaceCreateError(null);
    const result = await rpc.tenant.workspaces.create({ name });
    setCreatingWorkspace(false);
    if (!result.ok) {
      setWorkspaceCreateError(result.error.message);
      return;
    }
    const nextWorkspace = result.value.tenant;
    const nextWorkspaces = [
      ...session.data.workspaces.filter(
        (workspace) => workspace.id !== nextWorkspace.id,
      ),
      nextWorkspace,
    ];
    const userId = session.data.user.id;
    queryClient.setQueryData(['session'], {
      ...session.data,
      activeWorkspace: nextWorkspace,
      workspaces: nextWorkspaces,
    });
    queryClient.setQueryData<TenantMemberCacheEntry[] | undefined>(
      ['tenant-members'],
      (currentMembers) =>
        currentMembers?.map((member) =>
          member.userId === userId
            ? {
                ...member,
                workspaces: [
                  ...(member.workspaces ?? []).filter(
                    (workspace) => workspace.id !== nextWorkspace.id,
                  ),
                  {
                    id: nextWorkspace.id,
                    slug: nextWorkspace.slug,
                    name: nextWorkspace.name,
                    role: nextWorkspace.role,
                  },
                ],
              }
            : member,
        ),
    );
    setWorkspaceCreateName('');
    setWorkspaceCreateOpen(false);
    setWorkspaceMenuOpen(false);
    setProjectViewMode('list');
    setAttestationViewMode('list');
    setAttestationDetailTab('records');
    resetNewProjectForm();
    resetNewAttestationForm();
    setSelectedAttestationId('');
    setAttestationProjectSlug('');
    await queryClient.invalidateQueries();
  };

  const updateGlobalSettings = async (
    e: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!session.data || savingSettings) return;
    setSavingSettings(true);
    setSettingsMessage(null);
    const result = await rpc.tenant.organizationSettings.update({
      projectNoun: settingsProjectNoun,
    });
    setSavingSettings(false);
    if (!result.ok) {
      setSettingsMessage(result.error.message);
      return;
    }
    queryClient.setQueryData(['session'], {
      ...session.data,
      activeWorkspace: result.value.tenant,
      organizations: session.data.organizations.map((organization) =>
        organization.id === result.value.organization.id
          ? result.value.organization
          : organization,
      ),
      workspaces: session.data.workspaces.map((workspace) =>
        workspace.organizationId === result.value.organization.id
          ? { ...workspace, projectNoun: result.value.organization.projectNoun }
          : workspace,
      ),
    });
    setSettingsMessage('Settings saved.');
    await queryClient.invalidateQueries();
  };

  const updateWorkspaceArchivedState = async (
    workspaceId: string,
    archived: boolean,
  ): Promise<void> => {
    if (!session.data) return;
    if (updatingWorkspaceId) return;
    setWorkspaceSwitchError(null);
    setUpdatingWorkspaceId(workspaceId);
    const result = archived
      ? await rpc.tenant.workspaces.restore({ workspaceId })
      : await rpc.tenant.workspaces.archive({ workspaceId });
    setUpdatingWorkspaceId(null);
    if (!result.ok) {
      setWorkspaceSwitchError(result.error.message);
      return;
    }
    const nextWorkspace = result.value.tenant;
    queryClient.setQueryData(['session'], {
      ...session.data,
      workspaces: [
        ...(session.data?.workspaces ?? []).filter(
          (workspace) => workspace.id !== nextWorkspace.id,
        ),
        nextWorkspace,
      ],
    });
    await queryClient.invalidateQueries();
  };

  const revokeDevice = async (
    deviceId: string,
    isCurrent: boolean,
  ): Promise<void> => {
    if (revokingDeviceId) return;
    setDeviceMessage(null);
    if (isCurrent) {
      await signOut();
      return;
    }
    setRevokingDeviceId(deviceId);
    const result = await rpc.devices.revoke({ deviceId });
    setRevokingDeviceId(null);
    if (!result.ok) {
      setDeviceMessage(result.error.message);
      return;
    }
    setDeviceMessage('Device revoked.');
    await devices.refetch();
    if (canManageWorkspace) await workspaceDevices.refetch();
  };

  const revokeWorkspaceDevice = async (deviceId: string): Promise<void> => {
    if (revokingDeviceId) return;
    if (deviceId === session.data?.deviceId) {
      setDeviceMessage('Use Settings to sign out of this desktop.');
      return;
    }
    setDeviceMessage(null);
    setRevokingDeviceId(deviceId);
    const result = await rpc.devices.revokeForWorkspace({ deviceId });
    setRevokingDeviceId(null);
    if (!result.ok) {
      setDeviceMessage(result.error.message);
      return;
    }
    setDeviceMessage('Trusted device revoked.');
    await devices.refetch();
    await workspaceDevices.refetch();
  };

  const disconnectExternalIdentity = async (
    identityId: string,
  ): Promise<void> => {
    if (disconnectingIdentityId) return;
    setIdentityMessage(null);
    setDisconnectingIdentityId(identityId);
    const result = await rpc.externalIdentities.disconnect({ identityId });
    setDisconnectingIdentityId(null);
    if (!result.ok) {
      setIdentityMessage(result.error.message);
      return;
    }
    setIdentityMessage('Sign-in method disconnected.');
    await externalIdentities.refetch();
  };

  const connectExternalIdentity = async (provider: string): Promise<void> => {
    if (connectingIdentityProvider) return;
    setIdentityMessage(null);
    setConnectingIdentityProvider(provider);
    const result = await rpc.externalIdentities.connect({ provider });
    setConnectingIdentityProvider(null);
    if (!result.ok) {
      setIdentityMessage(result.error.message);
      return;
    }
    setIdentityMessage('Sign-in method connected.');
    await externalIdentities.refetch();
  };

  const createInvitation = async (
    e: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (inviting) return;
    setInviting(true);
    setInviteMessage(null);
    const result = await rpc.tenant.invitations.create({
      email: inviteEmail.trim(),
      role: inviteRole,
    });
    setInviting(false);
    if (!result.ok) {
      setInviteMessage(result.error.message);
      return;
    }
    setInviteEmail('');
    setInviteRole('producer');
    setInviteFormOpen(false);
    setInviteMessage('Invitation created.');
    await invitations.refetch();
  };

  const revokeInvitation = async (invitationId: string): Promise<void> => {
    if (revokingInvitationId) return;
    setInviteMessage(null);
    setRevokingInvitationId(invitationId);
    const result = await rpc.tenant.invitations.revoke({ invitationId });
    setRevokingInvitationId(null);
    if (!result.ok) {
      setInviteMessage(result.error.message);
      return;
    }
    setInviteMessage('Invitation revoked.');
    await invitations.refetch();
  };

  const exportEvents = async (format: 'json' | 'csv'): Promise<void> => {
    if (exportingEventsFormat) return;
    setEventExportMessage(null);
    setExportingEventsFormat(format);
    const result = await rpc.tenant.audit.export({
      format,
      scope:
        eventExportScope === 'organization' && canExportOrganizationEvents
          ? 'organization'
          : 'workspace',
      category:
        eventCategoryFilter === 'all' ? undefined : eventCategoryFilter,
      projectId:
        eventProjectExportFilter === 'all'
          ? undefined
          : eventProjectExportFilter,
      actorUserId:
        eventActorExportFilter === 'all' ? undefined : eventActorExportFilter,
      from: eventExportFrom || undefined,
      to: eventExportTo || undefined,
    });
    setExportingEventsFormat(null);
    if (!result.ok) {
      setEventExportMessage(result.error.message);
      return;
    }
    downloadTextFile(
      result.value.filename,
      result.value.body,
      result.value.contentType,
    );
    setEventExportMessage(
      `${eventExportScope === 'organization' && canExportOrganizationEvents ? 'Organization' : 'Workspace'} ${format.toUpperCase()} export downloaded.`,
    );
    await audit.refetch();
  };

  const createEvidenceExportJob = async (): Promise<void> => {
    if (exportingEvidenceManifest) return;
    setEventExportMessage(null);
    setExportingEvidenceManifest(true);
    const result = await rpc.tenant.evidenceExport.createJob({
      includeEvents: true,
      projectId:
        eventProjectExportFilter === 'all'
          ? undefined
          : eventProjectExportFilter,
      actorUserId:
        eventActorExportFilter === 'all' ? undefined : eventActorExportFilter,
    });
    setExportingEvidenceManifest(false);
    if (!result.ok) {
      setEventExportMessage(result.error.message);
      return;
    }
    downloadTextFile(
      result.value.filename,
      result.value.body,
      result.value.contentType,
    );
    setEventExportMessage(
      `Evidence export ${result.value.job.id} created. Manifest downloaded.`,
    );
    await audit.refetch();
    await evidenceExportJobs.refetch();
  };

  const downloadEvidenceExportJob = async (jobId: string): Promise<void> => {
    if (downloadingEvidenceExportJobId) return;
    setEventExportMessage(null);
    setDownloadingEvidenceExportJobId(jobId);
    const result = await rpc.tenant.evidenceExport.getJob({ id: jobId });
    setDownloadingEvidenceExportJobId(null);
    if (!result.ok) {
      setEventExportMessage(result.error.message);
      return;
    }
    downloadTextFile(
      result.value.filename,
      result.value.body,
      result.value.contentType,
    );
    setEventExportMessage(`Evidence export ${result.value.job.id} downloaded.`);
  };

  const downloadEvidenceExportBundle = async (jobId: string): Promise<void> => {
    if (downloadingEvidenceBundleJobId) return;
    setEventExportMessage(null);
    setDownloadingEvidenceBundleJobId(jobId);
    const result = await rpc.tenant.evidenceExport.bundle({ id: jobId });
    setDownloadingEvidenceBundleJobId(null);
    if (!result.ok) {
      setEventExportMessage(result.error.message);
      return;
    }
    downloadTextFile(
      result.value.filename,
      result.value.body,
      result.value.contentType,
    );
    setEventExportMessage(`Evidence export ${result.value.jobId} bundle downloaded.`);
  };

  const removeMember = async (userId: string): Promise<void> => {
    if (removingMemberId) return;
    setInviteMessage(null);
    setRemovingMemberId(userId);
    const result = await rpc.tenant.members.remove({ userId });
    setRemovingMemberId(null);
    if (!result.ok) {
      setInviteMessage(result.error.message);
      return;
    }
    setInviteMessage('Member removed.');
    await members.refetch();
  };

  const openUserDetail = (member: {
    userId: string;
    role: string;
    organizationRole: string;
    workspaces?: Array<{ id: string }>;
  }): void => {
    const fallbackWorkspaceIds = session.data?.activeWorkspace.id
      ? [session.data.activeWorkspace.id]
      : [];
    setSelectedMemberDetailId(member.userId);
    setEditingMemberId(member.userId);
    setMemberEditDrafts((current) => ({
      ...current,
      [member.userId]: {
        role: member.role === 'tenant_admin' ? 'tenant_admin' : 'producer',
        organizationAdmin: member.organizationRole === 'organization_admin',
        workspaceIds:
          member.workspaces && member.workspaces.length > 0
            ? member.workspaces.map((workspace) => workspace.id)
            : fallbackWorkspaceIds,
      },
    }));
  };

  const closeMemberEditor = (userId: string): void => {
    setEditingMemberId(null);
    setSelectedMemberDetailId(null);
    setMemberEditDrafts((current) => {
      const { [userId]: _removed, ...rest } = current;
      return rest;
    });
  };

  const updateMemberDraft = (
    userId: string,
    patch: Partial<MemberEditDraft>,
  ): void => {
    const fallbackWorkspaceIds = session.data?.activeWorkspace.id
      ? [session.data.activeWorkspace.id]
      : [];
    setMemberEditDrafts((current) => ({
      ...current,
      [userId]: {
        role: current[userId]?.role ?? 'producer',
        organizationAdmin: current[userId]?.organizationAdmin ?? false,
        workspaceIds:
          current[userId]?.workspaceIds ?? fallbackWorkspaceIds,
        ...patch,
      },
    }));
  };

  const updateMemberAccess = async (
    e: FormEvent<HTMLFormElement>,
    userId: string,
  ): Promise<void> => {
    e.preventDefault();
    if (savingMemberAccessId) return;
    const draft = memberEditDrafts[userId];
    if (!draft) {
      setInviteMessage('Open the user row and make a change before saving.');
      return;
    }
    const role = draft.role;
    const organizationRole: OrganizationRole =
      draft.organizationAdmin
        ? 'organization_admin'
        : 'member';
    const workspaceAccessMode: WorkspaceAccessMode = 'selected_workspaces';
    const workspaceIds = draft.workspaceIds;
    if (workspaceIds.length === 0) {
      setInviteMessage('Select at least one workspace.');
      return;
    }
    setInviteMessage(null);
    setSavingMemberAccessId(userId);
    const result = await rpc.tenant.members.updateAccess({
      userId,
      role,
      organizationRole,
      workspaceAccessMode,
      workspaceIds,
    });
    setSavingMemberAccessId(null);
    if (!result.ok) {
      setInviteMessage(result.error.message);
      return;
    }
    setInviteMessage('Member access updated.');
    closeMemberEditor(userId);
    await members.refetch();
  };

  const createProject = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setCreatingProject(true);
    setProjectError(null);
    const result = await rpc.projects.create({
      name: projectName.trim(),
      slug: projectSlug.trim() || slugify(projectName),
    });
    setCreatingProject(false);
    if (!result.ok) {
      setProjectError(result.error.message);
      return;
    }
    resetNewProjectForm();
    setProjectViewMode('list');
    await projects.refetch();
  };

  const updateProjectArchivedState = async (
    projectSlug: string,
    archived: boolean,
  ): Promise<void> => {
    if (updatingProjectSlug) return;
    setProjectError(null);
    setUpdatingProjectSlug(projectSlug);
    const result = archived
      ? await rpc.projects.restore({ projectSlug })
      : await rpc.projects.archive({ projectSlug });
    setUpdatingProjectSlug(null);
    if (!result.ok) {
      setProjectError(result.error.message);
      return;
    }
    await projects.refetch();
    await audit.refetch();
  };

  const updateProjectName = (value: string): void => {
    setProjectName(value);
    setProjectSlug(slugify(value));
  };

  const updateAttestationFileLabel = (id: string, label: string): void => {
    setAttestationFiles((files) =>
      files.map((file) =>
        file.id === id
          ? {
              ...file,
              label,
              result: file.result ? { ...file.result, label } : undefined,
            }
          : file,
      ),
    );
  };

  const removeAttestationFile = (id: string): void => {
    setAttestationFiles((files) => files.filter((file) => file.id !== id));
  };

  const selectAttestationFiles = async (
    fileList: FileList | null,
  ): Promise<void> => {
    const selectedFiles = Array.from(fileList ?? []);
    const files =
      hashMode === 'google_drive' ? selectedFiles.slice(0, 1) : selectedFiles;
    const batchBaseName =
      attestationLabel || files[0]?.name
        ? defaultAttestationNameFromFileName(attestationLabel || files[0]!.name)
        : 'Attestation';
    const labelForFile = (file: File, index: number): string =>
      files.length > 1
        ? numberedAttestationName(batchBaseName, index + 1)
        : index === 0 && attestationLabel
          ? sanitizeAttestationName(attestationLabel)
          : defaultAttestationNameFromFileName(file.name);
    setAttestationFiles(
      files.map((file, index) => ({
        id: attestationFileInputId(file, index),
        file,
        label: labelForFile(file, index),
        hash: '',
        contentProofError: null,
        exactImageProof: undefined,
        error: null,
        result: undefined,
      })),
    );
    setAttestationResults([]);
    setAttestationError(null);
    if (files.length === 0) return;
    const firstFile = files[0];
    if (firstFile && !attestationLabel) {
      setAttestationLabel(batchBaseName);
    }
    setHashing(true);
    const hashedFiles = await Promise.all(
      files.map(async (file, index): Promise<AttestationFileInput> => {
        const label = labelForFile(file, index);
        try {
          const hash = await sha256FileHex(file);
          let contentProof: PlainTextContentProof | undefined;
          let contentProofError: string | null = null;
          const exactImageProof = buildExactImageProof(file);
          if (canGenerateContentProof) {
            try {
              contentProof = await buildContentProof(file);
            } catch (err) {
              contentProofError = contentProofErrorMessage(err);
            }
          }
          return {
            id: attestationFileInputId(file, index),
            file,
            label,
            hash,
            contentProof,
            contentProofError,
            exactImageProof,
            error: null,
            result: undefined,
          };
        } catch (err) {
          return {
            id: attestationFileInputId(file, index),
            file,
            label,
            hash: '',
            contentProofError: null,
            exactImageProof: undefined,
            error:
              err instanceof Error ? err.message : 'Could not hash the file.',
            result: undefined,
          };
        }
      }),
    );
    setAttestationFiles(hashedFiles);
    if (hashedFiles.some((file) => file.error)) {
      setAttestationError(
        'One or more files could not be hashed. Remove failed files before submitting.',
      );
    }
    setHashing(false);
  };

  const handleAttestationDragOver = (
    e: DragEvent<HTMLLabelElement>,
  ): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setAttestationDropActive(true);
  };

  const handleAttestationDrop = (
    e: DragEvent<HTMLLabelElement>,
  ): void => {
    e.preventDefault();
    setAttestationDropActive(false);
    void selectAttestationFiles(e.dataTransfer.files);
  };

  const buildGoogleDriveSourceMetadata = (
    file: AttestationFileInput,
  ):
    | {
        provider: 'google_drive';
        fileId: string;
        fileName: string;
        mimeType?: string;
        modifiedTime?: string;
        googleAccountEmail?: string;
      }
    | undefined => {
    if (hashMode !== 'google_drive' || !driveFileId) return undefined;
    const trimmedAccountEmail =
      driveAccountEmail.trim() || connectedGoogleIdentity?.email || '';
    return {
      provider: 'google_drive',
      fileId: driveFileId,
      fileName: driveFileName.trim() || file.file.name,
      ...(driveMimeType.trim()
        ? { mimeType: driveMimeType.trim() }
        : file.file.type
          ? { mimeType: file.file.type }
          : {}),
      ...(driveModifiedTime.trim()
        ? { modifiedTime: driveModifiedTime.trim() }
        : {}),
      ...(trimmedAccountEmail
        ? { googleAccountEmail: trimmedAccountEmail.toLowerCase() }
        : {}),
    };
  };

  const updateModelReleaseField = (
    field: keyof ModelReleaseFormState,
    value: string,
  ): void => {
    setModelReleaseForm((current) => ({ ...current, [field]: value }));
  };

  const generateModelReleaseHashes = async (): Promise<void> => {
    const seed = stableCanonicalJson({
      record_type: 'model_release_hash_seed',
      model_name: modelReleaseForm.modelName.trim() || 'model',
      model_version: modelReleaseForm.modelVersion.trim() || 'version',
      claim_type: modelReleaseForm.claimType,
      subject_identifier:
        modelReleaseForm.subjectIdentifier.trim() || 'subject',
    });
    const [
      subjectHash,
      artifactManifestHash,
      modelCardHash,
      datasetManifestHash,
      evaluationReportHash,
      riskReviewHash,
    ] = await Promise.all([
      sha256TextHex(`${seed}:subject`),
      sha256TextHex(`${seed}:artifact-manifest`),
      sha256TextHex(`${seed}:model-card`),
      sha256TextHex(`${seed}:dataset-manifest`),
      sha256TextHex(`${seed}:evaluation-report`),
      sha256TextHex(`${seed}:risk-review`),
    ]);
    setModelReleaseForm((current) => ({
      ...current,
      subjectHash,
      artifactManifestHash,
      modelCardHash,
      datasetManifestHash,
      evaluationReportHash,
      riskReviewHash,
    }));
  };

  const buildModelReleaseSourceMetadata = (): ModelReleaseSourceMetadata => ({
    provider: 'model_release',
    recordType: 'model_provenance_record',
    schemaVersion: modelReleaseRecord.schema_version,
    canonicalHash: modelReleaseHash,
    modelName: modelReleaseForm.modelName.trim(),
    modelVersion: modelReleaseForm.modelVersion.trim(),
    modelType: modelReleaseForm.modelType,
    releaseStage: modelReleaseForm.releaseStage,
    claimType: modelReleaseForm.claimType,
    claimText: modelReleaseForm.claimText.trim(),
    claimScope: modelReleaseForm.claimScope,
    subjectType: modelReleaseForm.subjectType,
    subjectIdentifier: modelReleaseForm.subjectIdentifier.trim(),
    subjectHash: modelReleaseForm.subjectHash.trim().toLowerCase(),
    artifactManifestHash:
      modelReleaseForm.artifactManifestHash.trim().toLowerCase(),
    modelCardHash: modelReleaseForm.modelCardHash.trim().toLowerCase(),
    datasetManifestHash:
      modelReleaseForm.datasetManifestHash.trim().toLowerCase(),
    evaluationReportHash:
      modelReleaseForm.evaluationReportHash.trim().toLowerCase(),
    ...(modelReleaseForm.riskReviewHash.trim()
      ? { riskReviewHash: modelReleaseForm.riskReviewHash.trim().toLowerCase() }
      : {}),
    policyId: modelReleaseForm.policyId.trim(),
    policyVersion: modelReleaseForm.policyVersion.trim(),
    policyDecision: modelReleaseForm.policyDecision,
    finalApprover: modelReleaseForm.finalApprover.trim(),
    finalApprovalTimestamp: modelReleaseForm.finalApprovalTimestamp.trim(),
    disclosureMode: modelReleaseForm.disclosureMode,
    verificationPolicy: modelReleaseForm.verificationPolicy,
    ...(modelReleaseForm.retentionPeriod.trim()
      ? { retentionPeriod: modelReleaseForm.retentionPeriod.trim() }
      : {}),
    ...(modelReleaseForm.knownLimitations.trim()
      ? { knownLimitations: modelReleaseForm.knownLimitations.trim() }
      : {}),
  });

  const submitAttestation = async (
    e: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!canSubmitAttestation) return;
    const invalidFileLabel =
      hashMode === 'file' || hashMode === 'google_drive'
        ? attestationFiles.find(
            (file) => !isValidAttestationName(file.label),
          )
        : null;
    const invalidExternalLabel =
      (hashMode === 'external' || hashMode === 'model_release') &&
      !isValidAttestationName(attestationLabel);
    if (invalidFileLabel || invalidExternalLabel) {
      setAttestationError(ATTESTATION_NAME_HELP);
      return;
    }
    setSubmittingAttestation(true);
    setAttestationError(null);
    setAttestationResults([]);
    if (hashMode === 'file' || hashMode === 'google_drive') {
      setAttestationFiles((files) =>
        files.map((file) => ({ ...file, result: undefined })),
      );
    }
    const submissions =
      hashMode === 'file' || hashMode === 'google_drive'
        ? attestationFiles.map((file, index) => ({
            clientId: file.id,
            label: file.label.trim(),
            description:
              attestationFiles.length > 1
                ? batchDescription(
                    sanitizeAttestationName(attestationLabel || file.label),
                    index + 1,
                    attestationFiles.length,
                  )
                : undefined,
            fileName: file.file.name,
            fileSize: file.file.size,
            sha256Hex: file.hash,
            contentProof: file.contentProof,
            exactImageProof: file.exactImageProof,
            sourceMetadata: buildGoogleDriveSourceMetadata(file),
          }))
        : hashMode === 'model_release'
          ? [
              {
                clientId: `model-release-${modelReleaseHash.slice(0, 12)}`,
                label: attestationLabel.trim(),
                description: `Model release provenance claim for ${modelReleaseForm.modelName.trim()} ${modelReleaseForm.modelVersion.trim()}.`,
                fileName: `model-release-${slugify(
                  modelReleaseForm.modelName || 'model',
                )}-${slugify(modelReleaseForm.modelVersion || 'version')}.json`,
                fileSize: new TextEncoder().encode(
                  stableCanonicalJson(modelReleaseRecord),
                ).byteLength,
                sha256Hex: modelReleaseHash,
                contentProof: undefined,
                exactImageProof: undefined,
                sourceMetadata: buildModelReleaseSourceMetadata(),
              },
            ]
        : [
            {
              clientId: `external-${submittedHash.slice(0, 12)}`,
              label: attestationLabel.trim(),
              description: undefined,
              fileName: `external-sha256-${submittedHash.slice(0, 12)}`,
              fileSize: 0,
              sha256Hex: submittedHash,
              contentProof: undefined,
              exactImageProof: undefined,
              sourceMetadata: undefined,
            },
          ];
    const results: AttestationSubmitResult[] = [];
    for (const submission of submissions) {
      const result = await rpc.attestations.createWholeFile({
        projectSlug: attestationProjectSlug,
        label: submission.label,
        description: submission.description,
        fileName: submission.fileName,
        fileSize: submission.fileSize,
        sha256Hex: submission.sha256Hex,
        ...buildContentProofRpcPayload(submission.contentProof),
        ...buildExactImageProofRpcPayload(submission.exactImageProof),
        ...(submission.sourceMetadata
          ? { sourceMetadata: submission.sourceMetadata }
          : {}),
      });
      const submissionResult: AttestationSubmitResult = result.ok
        ? {
          clientId: submission.clientId,
          label: submission.label,
          ok: true,
          attestationId: result.value.attestationId,
          state: result.value.state,
          merkleRoot: result.value.merkleRoot,
          submittedHash: result.value.submittedHash,
          shingleCount: result.value.shingleCount,
          componentCount: result.value.componentCount,
          confirmedAt: null,
        }
        : {
          clientId: submission.clientId,
          label: submission.label,
          ok: false,
          error: result.error.message,
        };
      results.push(submissionResult);
      if (hashMode === 'file' || hashMode === 'google_drive') {
        setAttestationFiles((files) =>
          files.map((file) =>
            file.id === submission.clientId
              ? { ...file, result: submissionResult }
              : file,
          ),
        );
      } else {
        setAttestationResults([...results]);
      }
    }
    setSubmittingAttestation(false);
    const firstSuccess = results.find((result) => result.ok);
    if (!firstSuccess) {
      setAttestationError('No attestations were submitted successfully.');
      return;
    }
    setSelectedAttestationId(firstSuccess.attestationId);
    setReceiptJson(null);
    setReceiptSummary(null);
    setReceiptLinkMessage(null);
    await attestations.refetch();
    await recentAttestations.refetch();
  };

  const loadReceipt = async (): Promise<void> => {
    if (!selectedAttestationId) return;
    if (checkingReceipt) return;
    setReceiptMessage(null);
    setReceiptJson(null);
    setReceiptSummary(null);
    setReceiptLinkMessage(null);
    setCheckingReceipt(true);
    const result = await rpc.attestations.receipt({
      attestationId: selectedAttestationId,
    });
    setCheckingReceipt(false);
    if (!result.ok) {
      setReceiptMessage(result.error.message);
      return;
    }
    setReceiptMessage('Receipt loaded.');
    setReceiptJson(JSON.stringify(result.value.receipt, null, 2));
    setReceiptSummary(toReceiptSummary(result.value.receipt));
    if (result.value.verificationLinkId) {
      setReceiptLinkIdOverride(result.value.verificationLinkId);
    }
  };

  const downloadReceiptJson = (): void => {
    if (!receiptJson || !selectedAttestationId) return;
    const blob = new Blob([`${receiptJson}\n`], {
      type: 'application/json',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${selectedAttestationId}-receipt.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const copyReceiptPdfLink = async (): Promise<void> => {
    if (!receiptPdfUrl) return;
    setReceiptLinkMessage(null);
    try {
      await navigator.clipboard.writeText(receiptPdfUrl);
      setReceiptLinkMessage('Receipt PDF link copied.');
    } catch {
      setReceiptLinkMessage('Could not copy the receipt PDF link.');
    }
  };

  const copyVerifierLookupLink = async (): Promise<void> => {
    if (!verifierLookupUrl) return;
    setVerifierLinkMessage(null);
    try {
      await navigator.clipboard.writeText(verifierLookupUrl);
      setVerifierLinkMessage('Private verifier lookup link copied.');
    } catch {
      setVerifierLinkMessage('Could not copy the private verifier lookup link.');
    }
  };

  const buildVerifierGrantMessage = (recipientOverride?: string): string => {
    if (!verifierLookupUrl || !selectedAttestation.data) return '';
    const recipient =
      recipientOverride?.trim() ||
      grantEmail.trim() ||
      'the email granted access';
    const lines = [
      'You have been granted access to verify a Proveria attestation.',
      '',
      `Workspace: ${session.data?.activeWorkspace.name ?? 'Proveria workspace'}`,
      `Attestation: ${selectedAttestation.data.attestation.label}`,
      `Verifier account: ${recipient}`,
      '',
      `Private verifier lookup: ${verifierLookupUrl}`,
      '',
      'Sign in with the verifier account above. This private lookup checks one attestation; it is not the public receipt page. You can hash a local file in the browser or paste a SHA-256 hash. Proveria does not receive the file.',
    ].filter((line): line is string => line !== null);
    return lines.join('\n');
  };

  const toggleVerifierForm = (): void => {
    if (verifierFormOpen) {
      setVerifierFormOpen(false);
      return;
    }
    setGrantNote(buildVerifierGrantMessage());
    setGrantNoteEdited(false);
    setVerifierFormOpen(true);
  };

  const refreshAttestationStatus = async (): Promise<void> => {
    await Promise.all([
      selectedAttestation.refetch(),
      attestations.refetch(),
      recentAttestations.refetch(),
    ]);
  };

  const sortAttestationsBy = (key: AttestationSortKey): void => {
    setAttestationSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const createAccessGrant = async (
    e: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!selectedAttestationId) return;
    if (grantingAccess) return;
    setGrantMessage(null);
    setGrantingAccess(true);
    const result = await rpc.attestations.accessGrants.create({
      attestationId: selectedAttestationId,
      email: grantEmail.trim(),
      message: grantNote.trim() || undefined,
    });
    setGrantingAccess(false);
    if (!result.ok) {
      setGrantMessage(result.error.message);
      return;
    }
    setGrantEmail(DEFAULT_GRANT_EMAIL);
    setGrantNote('');
    setGrantNoteEdited(false);
    setVerifierFormOpen(false);
    setGrantMessage(
      result.value.grant.pending
        ? 'Access grant created. Recipient must claim it by email before using the private verifier lookup.'
        : 'Access granted. The verifier can sign in and use the private verifier lookup.',
    );
    await accessGrants.refetch();
  };

  const revokeAccessGrant = async (grantId: string): Promise<void> => {
    if (!selectedAttestationId) return;
    if (revokingGrantId) return;
    setGrantMessage(null);
    setRevokingGrantId(grantId);
    const result = await rpc.attestations.accessGrants.revoke({
      attestationId: selectedAttestationId,
      grantId,
    });
    setRevokingGrantId(null);
    if (!result.ok) {
      setGrantMessage(result.error.message);
      return;
    }
    setGrantMessage('Access grant revoked.');
    await accessGrants.refetch();
  };

  const approveAccessRequest = async (requestId: string): Promise<void> => {
    if (resolvingAccessRequestId) return;
    const reason = accessRequestDecisionReasons[requestId]?.trim() ?? '';
    if (reason.length < 3) {
      setAccessRequestMessage('Enter a reason before approving access.');
      return;
    }
    setAccessRequestMessage(null);
    setResolvingAccessRequestId(requestId);
    const result = await rpc.attestations.accessRequests.approve({
      requestId,
      reason,
    });
    setResolvingAccessRequestId(null);
    if (!result.ok) {
      setAccessRequestMessage(result.error.message);
      return;
    }
    setAccessRequestMessage('Verifier access approved.');
    setAccessRequestDecisionReasons((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    await Promise.all([
      accessRequests.refetch(),
      accessGrants.refetch(),
      audit.refetch(),
    ]);
  };

  const denyAccessRequest = async (requestId: string): Promise<void> => {
    if (resolvingAccessRequestId) return;
    const reason = accessRequestDecisionReasons[requestId]?.trim() ?? '';
    if (reason.length < 3) {
      setAccessRequestMessage('Enter a reason before denying access.');
      return;
    }
    setAccessRequestMessage(null);
    setResolvingAccessRequestId(requestId);
    const result = await rpc.attestations.accessRequests.deny({
      requestId,
      reason,
    });
    setResolvingAccessRequestId(null);
    if (!result.ok) {
      setAccessRequestMessage(result.error.message);
      return;
    }
    setAccessRequestMessage('Verifier access request denied.');
    setAccessRequestDecisionReasons((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    await Promise.all([accessRequests.refetch(), audit.refetch()]);
  };

  const openRecentAttestation = (
    attestationId: string,
    projectSlug: string,
  ): void => {
    setAttestationProjectSlug(projectSlug);
    setSelectedAttestationId(attestationId);
    setAttestationViewMode('detail');
    setAttestationDetailTab('records');
    setReceiptMessage(null);
    setReceiptJson(null);
    setGrantMessage(null);
    setVerifierLinkMessage(null);
    setVerifierFormOpen(false);
    setVerifierSearch('');
    setVerifierStatusFilter('all');
    setVerifierPage(1);
    setDetailEventSearch('');
    setDetailEventCategoryFilter('all');
    setDetailEventPage(1);
    setExpandedDetailEventIds(new Set());
    setActiveView('attestations');
  };

  const openAttestationDetail = (attestationId: string): void => {
    setSelectedAttestationId(attestationId);
    setAttestationViewMode('detail');
    setAttestationDetailTab('records');
    setReceiptMessage(null);
    setReceiptJson(null);
    setGrantMessage(null);
    setVerifierLinkMessage(null);
    setVerifierFormOpen(false);
    setVerifierSearch('');
    setVerifierStatusFilter('all');
    setVerifierPage(1);
    setDetailEventSearch('');
    setDetailEventCategoryFilter('all');
    setDetailEventPage(1);
    setExpandedDetailEventIds(new Set());
  };

  const resizeAttestationColumn = (
    key: AttestationColumnKey,
    deltaX: number,
  ): void => {
    resizeTableColumn(
      setAttestationColumnWidths,
      ATTESTATION_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const resizeProjectColumn = (key: ProjectColumnKey, deltaX: number): void => {
    resizeTableColumn(
      setProjectColumnWidths,
      PROJECT_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const resizeRequestColumn = (key: RequestColumnKey, deltaX: number): void => {
    resizeTableColumn(
      setRequestColumnWidths,
      REQUEST_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const resizeMemberColumn = (key: MemberColumnKey, deltaX: number): void => {
    resizeTableColumn(
      setMemberColumnWidths,
      MEMBER_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const resizeWorkspaceColumn = (
    key: WorkspaceColumnKey,
    deltaX: number,
  ): void => {
    resizeTableColumn(
      setWorkspaceColumnWidths,
      WORKSPACE_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const resizeEventColumn = (key: EventColumnKey, deltaX: number): void => {
    resizeTableColumn(
      setEventColumnWidths,
      EVENT_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const resizeVerifierColumn = (key: VerifierColumnKey, deltaX: number): void => {
    resizeTableColumn(
      setVerifierColumnWidths,
      VERIFIER_COLUMN_MIN_WIDTHS,
      key,
      deltaX,
    );
  };

  const sortProjectsBy = (key: ProjectSortKey): void => {
    setProjectSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortRequestsBy = (key: RequestSortKey): void => {
    setRequestSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortMembersBy = (key: MemberSortKey): void => {
    setMemberSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortWorkspacesBy = (key: WorkspaceSortKey): void => {
    setWorkspaceSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortEventsBy = (key: EventSortKey): void => {
    setEventSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortDetailEventsBy = (key: EventSortKey): void => {
    setDetailEventSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const toggleDetailEvent = (eventId: string): void => {
    setExpandedDetailEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const sortVerifiersBy = (key: VerifierSortKey): void => {
    setVerifierSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  if (session.isLoading) {
    return (
      <main className="px-6 py-16">
        <LoadingState label="Loading workspace session..." />
      </main>
    );
  }

  if (session.isError || !session.data) {
    return (
      <div className="px-6 py-16">
        <p className="text-[14px] text-neutral-500">You are not signed in.</p>
        <button
          onClick={() => setLocation('/sign-in')}
          className="mt-4 text-[14px] text-[var(--color-accent)] hover:underline"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  const currentUserId = session.data.user.id;
  const allWorkspaceOptions = session.data.workspaces;
  const workspaceOptions = allWorkspaceOptions.filter(
    (workspace) => !workspace.archivedAt,
  );
  const canCreateWorkspace = session.data.organizations.some(
    (organization) => organization.role === 'organization_admin',
  );
  const currentUserLabel =
    session.data.user.displayName?.trim() || session.data.user.email;
  const homeViewLabel = (view: HomeView): string =>
    view === 'projects'
      ? projectNounPlural
      : HOME_VIEWS.find((item) => item.id === view)?.label ?? 'Overview';
  const activeViewLabel =
    activeView === 'profile'
      ? 'Profile'
      : homeViewLabel(activeView);
  const pageTitle =
    activeView === 'attestations'
      ? attestationViewMode === 'new'
        ? 'New Attestation'
        : attestationViewMode === 'detail'
          ? 'Attestation Detail'
          : 'Attestations'
      : activeView === 'projects'
        ? projectViewMode === 'new'
          ? `New ${projectNoun}`
          : projectNounPlural
      : activeView === 'workspaces'
        ? 'Workspaces'
      : activeViewLabel;

  return (
    <main
      className={`grid min-h-screen ${
        sidebarCollapsed ? 'grid-cols-[48px_1fr]' : 'grid-cols-[260px_1fr]'
      }`}
    >
      <aside className="border-r border-[var(--color-border)] bg-[var(--color-sidebar)] py-6">
        <div
          className={
            sidebarCollapsed
              ? 'flex justify-center px-2'
              : 'flex items-center justify-between gap-3 px-5'
          }
        >
          <div className={sidebarCollapsed ? 'sr-only' : 'text-[15px] font-medium'}>
            Proveria
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            className="grid h-8 w-8 shrink-0 place-items-center border border-[var(--color-border)] bg-white text-neutral-700 hover:border-neutral-700"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <SidebarToggleIcon collapsed={sidebarCollapsed} />
          </button>
        </div>
        <div
          className={
            sidebarCollapsed
              ? 'sr-only'
              : 'mt-5 border-t border-[var(--color-border)] px-5 pt-5'
          }
        >
          <div className="min-w-0">
            <div className="relative">
              <div className="text-[12px] font-medium uppercase text-neutral-500">
                Workspace
              </div>
              <div className="mt-1 flex items-start justify-between gap-3">
                <div
                  className="min-w-0 truncate text-[14px] font-medium text-neutral-900"
                  aria-label="Active workspace"
                  title={session.data.activeWorkspace.name}
                >
                  {session.data.activeWorkspace.name}
                </div>
                <button
                  type="button"
                  onClick={() => setWorkspaceMenuOpen((open) => !open)}
                  disabled={switchingWorkspace}
                  className="shrink-0 text-[12px] font-medium text-[var(--color-accent)] hover:underline disabled:text-neutral-400 disabled:no-underline"
                  aria-expanded={workspaceMenuOpen}
                  aria-haspopup="listbox"
                  aria-label="Change workspace"
                  title="Change workspace"
                >
                  Change
                </button>
              </div>
              {workspaceMenuOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto border border-[var(--color-border)] bg-white shadow-sm"
                >
                  {workspaceOptions.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      role="option"
                      aria-selected={
                        workspace.id === activeWorkspaceId
                      }
                      onClick={() => void switchWorkspace(workspace.id)}
                      className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-neutral-50 ${
                        workspace.id === activeWorkspaceId
                          ? 'font-medium text-neutral-950'
                          : 'text-neutral-700'
                      }`}
                    >
                      {workspace.name}
                    </button>
                  ))}
                  {canCreateWorkspace && (
                    <div className="border-t border-[var(--color-border)] p-3">
                      {workspaceCreateOpen ? (
                        <form onSubmit={createWorkspace} className="grid gap-2">
                          <label className="grid gap-1 text-[12px] text-neutral-600">
                            New workspace
                            <input
                              aria-label="New workspace name"
                              value={workspaceCreateName}
                              onChange={(event) => {
                                setWorkspaceCreateName(event.target.value);
                                setWorkspaceCreateError(null);
                              }}
                              className="border border-[var(--color-border)] px-2 py-1.5 text-[13px] text-neutral-900 focus:border-neutral-700 focus:outline-none"
                              autoFocus
                            />
                          </label>
                          {workspaceCreateError && (
                            <p className="text-[12px] text-[#B91C1C]">
                              {workspaceCreateError}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={creatingWorkspace}
                              className="bg-neutral-900 px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                            >
                              {creatingWorkspace ? 'Creating...' : 'Create'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setWorkspaceCreateOpen(false);
                                setWorkspaceCreateName('');
                                setWorkspaceCreateError(null);
                              }}
                              className="border border-[var(--color-border)] px-2.5 py-1.5 text-[12px] hover:border-neutral-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setWorkspaceCreateOpen(true)}
                          className="text-left text-[12px] font-medium text-[var(--color-accent)] hover:underline"
                        >
                          New workspace
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {workspaceSwitchError && (
              <p className="mt-2 text-[12px] text-[#B91C1C]">
                {workspaceSwitchError}
              </p>
            )}
          </div>
        </div>
        <nav className={sidebarCollapsed ? 'hidden' : 'mt-8 grid gap-1 px-5 text-[14px]'}>
          {HOME_VIEWS.filter(
            (view) =>
              (view.id !== 'users' || canManageWorkspace) &&
              (view.id !== 'workspaces' || canCreateWorkspace) &&
              (view.id !== 'settings' || canManageWorkspace),
          ).map((view) => (
            <button
              key={view.id}
              type="button"
              aria-label={homeViewLabel(view.id)}
              title={homeViewLabel(view.id)}
              onClick={() => {
                setActiveView(view.id);
                if (view.id === 'projects') {
                  if (projectViewMode === 'new') {
                    resetNewProjectForm();
                  }
                  setProjectViewMode('list');
                }
                if (view.id === 'attestations') {
                  if (attestationViewMode === 'new') {
                    resetNewAttestationForm();
                  }
                  setAttestationViewMode('list');
                }
              }}
              className={`rounded-[6px] px-3 py-2 text-left ${
                activeView === view.id
                  ? 'bg-white font-medium shadow-sm'
                  : 'text-neutral-500 hover:bg-white/60 hover:text-neutral-800'
              }`}
            >
              <span className="flex items-center justify-between gap-3">
                <span>{homeViewLabel(view.id)}</span>
                {view.id === 'requests' && pendingAccessRequestCount > 0 && (
                  <span className="min-w-5 rounded-full bg-neutral-900 px-1.5 py-0.5 text-center text-[11px] font-medium text-white">
                    {pendingAccessRequestCount}
                  </span>
                )}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="px-8 py-7">
        <header className="flex items-start justify-between gap-6 border-b border-[var(--color-border)] pb-6">
          <div>
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-500"
            >
              <button
                type="button"
                onClick={() => setActiveView('overview')}
                className="hover:text-neutral-900 hover:underline"
              >
                {session.data.activeWorkspace.name}
              </button>
              <span>/</span>
              {activeView === 'projects' && projectViewMode === 'new' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      resetNewProjectForm();
                      setProjectViewMode('list');
                    }}
                    className="hover:text-neutral-900 hover:underline"
                  >
                    {projectNounPlural}
                  </button>
                  <span>/</span>
                  <span className="font-medium text-neutral-700">
                    New {projectNounLower}
                  </span>
                </>
              ) : activeView === 'attestations' && attestationViewMode !== 'list' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      resetNewAttestationForm();
                      setAttestationViewMode('list');
                    }}
                    className="hover:text-neutral-900 hover:underline"
                  >
                    Attestations
                  </button>
                  <span>/</span>
                  <span className="font-medium text-neutral-700">
                    {attestationViewMode === 'new'
                      ? 'New attestation'
                      : 'Attestation record'}
                  </span>
                </>
              ) : (
                <span className="font-medium text-neutral-700">
                  {activeViewLabel}
                </span>
              )}
            </nav>
            <h1 className="mt-2 text-[28px] font-medium leading-tight">
              {pageTitle}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="min-w-0 text-right">
              <button
                type="button"
                onClick={() => setActiveView('profile')}
                className="max-w-[220px] truncate text-[14px] font-medium hover:underline"
              >
                {currentUserLabel}
              </button>
              <div className="mt-0.5 text-[12px] text-neutral-500">
                {roleLabel(workspaceRole)}
              </div>
            </div>
            <button
              onClick={signOut}
              className="shrink-0 border border-[var(--color-border)] px-3 py-2 text-[14px] hover:border-neutral-700"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="mt-8 grid max-w-[1180px] gap-6">
          {activeView === 'overview' && (
            <>
              <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Metric
                  label="Pending validations"
                  value={
                    activeRecentAttestationCount > 0
                      ? String(activeRecentAttestationCount)
                      : 'None'
                  }
                />
                <Metric
                  label="Approval requests"
                  value={
                    pendingAccessRequestCount > 0
                      ? `${pendingAccessRequestCount} pending`
                      : 'None pending'
                  }
                />
                <Metric
                  label="Confirmed recent"
                  value={String(confirmedRecentAttestationCount)}
                />
                <Metric
                  label="Verifier activity"
                  value={
                    recentVerifierActivity.length > 0
                      ? String(recentVerifierActivity.length)
                      : 'None recent'
                  }
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                <div className="border border-[var(--color-border)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-[16px] font-medium">
                        Needs attention
                      </h2>
                      <p className="mt-1 text-[13px] text-neutral-500">
                        Items most likely to block verification or evidence
                        delivery.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void Promise.all([
                          recentAttestations.refetch(),
                          accessRequests.refetch(),
                          audit.refetch(),
                        ]);
                      }}
                      disabled={
                        recentAttestations.isFetching ||
                        accessRequests.isFetching ||
                        audit.isFetching
                      }
                      aria-label="Refresh overview"
                      title="Refresh overview"
                      className="border border-[var(--color-border)] p-2 hover:border-neutral-700 disabled:opacity-50"
                    >
                      <RefreshIcon />
                    </button>
                  </div>

                  {overviewAttentionItems.length > 0 ? (
                    <div className="mt-5 grid gap-3">
                      {overviewAttentionItems.map((item) => (
                        <OverviewAttentionItem
                          key={item.title}
                          item={item}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 border border-[#15803D] bg-[#F0FDF4] p-4">
                      <h3 className="text-[15px] font-medium text-[#166534]">
                        Clear for now
                      </h3>
                      <p className="mt-1 text-[13px] text-[#166534]">
                        No pending verifier requests, recent failures, or active
                        validations need attention.
                      </p>
                    </div>
                  )}
                </div>

                <div className="border border-[var(--color-border)] p-5">
                  <h2 className="text-[16px] font-medium">Next actions</h2>
                  <div className="mt-4 grid gap-2">
                    {overviewNextActions.map((action) => (
                      <OverviewNextAction
                        key={action.label}
                        action={action}
                      />
                    ))}
                  </div>
                </div>
              </section>

              <section className="border border-[var(--color-border)] p-5">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <h2 className="text-[16px] font-medium">Start here</h2>
                    <p className="mt-2 max-w-[620px] text-[14px] leading-6 text-neutral-600">
                      Create a {projectNounLower} for the evidence set, then submit a
                      whole-file attestation. Proveria stores the cryptographic
                      record; the file bytes stay on this desktop.
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('projects');
                        resetNewProjectForm();
                        setProjectViewMode('new');
                      }}
                      className="border border-[var(--color-border)] px-3 py-2 text-[14px] hover:border-neutral-700"
                    >
                      Create {projectNounLower}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('attestations');
                        resetNewAttestationForm();
                        setAttestationViewMode('new');
                      }}
                      disabled={!hasProjects}
                      className="bg-neutral-900 px-3 py-2 text-[14px] font-medium text-white disabled:opacity-40"
                    >
                      Submit attestation
                    </button>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-[13px]">
                  <WorkflowStep
                    index="1"
                    label={projectNoun}
                    value={hasProjects ? `${projectCount} ready` : 'Create one'}
                  />
                  <WorkflowStep
                    index="2"
                    label="Attestation"
                    value={
                      hasAttestations ? `${attestationCount} recorded` : 'Submit one'
                    }
                  />
                  <WorkflowStep
                    index="3"
                    label="Verifier"
                    value="Grant access when ready"
                  />
                </div>
              </section>

              <section className="border border-[var(--color-border)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-[16px] font-medium">
                      Recent local attestations
                    </h2>
                    <p className="mt-1 text-[13px] text-neutral-500">
                      Records created from this trusted desktop.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void recentAttestations.refetch()}
                    disabled={recentAttestations.isFetching}
                    aria-label="Refresh recent attestations"
                    title="Refresh recent attestations"
                    className="border border-[var(--color-border)] p-2 hover:border-neutral-700 disabled:opacity-50"
                  >
                    <RefreshIcon />
                  </button>
                </div>

                {recentAttestations.isLoading ? (
                  <LoadingState label="Loading recent local attestations..." />
                ) : recentAttestations.isError ? (
                  <ErrorState
                    message={errorMessage(
                      recentAttestations.error,
                      'Could not load recent local attestations.',
                    )}
                    onRetry={() => void recentAttestations.refetch()}
                  />
                ) : recentAttestations.data &&
                  recentAttestations.data.length > 0 ? (
                  <div className="mt-5 grid gap-3">
                    {recentAttestations.data.map((attestation) => (
                      <button
                        key={attestation.id}
                        type="button"
                        onClick={() =>
                          openRecentAttestation(
                            attestation.id,
                            attestation.projectSlug,
                          )
                        }
                        className="border border-[var(--color-border)] px-4 py-3 text-left hover:border-neutral-700"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-[15px] font-medium">
                              {attestation.label}
                            </div>
                            <div className="mt-1 text-[13px] text-neutral-500">
                              {attestation.projectName}
                            </div>
                          </div>
                          <StatusPill state={attestation.state} />
                        </div>
                        <div className="mt-3 text-[13px] text-neutral-500">
                          {attestation.confirmedAt
                            ? `Confirmed ${formatDate(attestation.confirmedAt)}`
                            : attestation.failedAt
                              ? `Failed ${formatDate(attestation.failedAt)}`
                              : `Created ${formatDate(attestation.createdAt)}`}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No local attestations yet"
                    body="Submit an attestation from this desktop and it will appear here."
                  />
                )}
              </section>

              <section className="border border-[var(--color-border)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-[16px] font-medium">
                      Recent verifier activity
                    </h2>
                    <p className="mt-1 text-[13px] text-neutral-500">
                      Lookup checks and access decisions from the workspace audit
                      trail.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView('audit')}
                    className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700"
                  >
                    Open audit
                  </button>
                </div>

                {audit.isLoading ? (
                  <LoadingState label="Loading recent verifier activity..." />
                ) : audit.isError ? (
                  <ErrorState
                    message={errorMessage(
                      audit.error,
                      'Could not load recent verifier activity.',
                    )}
                    onRetry={() => void audit.refetch()}
                  />
                ) : recentVerifierActivity.length > 0 ? (
                  <div className="mt-5 grid gap-3">
                    {recentVerifierActivity.map((event) => (
                      <AuditEventCard
                        key={event.id}
                        event={event}
                        compact
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No verifier activity yet"
                    body="Verifier lookups and access decisions will appear here once they happen."
                  />
                )}
              </section>

              <section className="border border-[var(--color-border)] p-5">
                <h2 className="text-[16px] font-medium">Workspace session</h2>
                <dl className="mt-5 grid grid-cols-[140px_1fr] gap-x-6 gap-y-3 text-[14px]">
                  <dt className="text-neutral-500">Workspace</dt>
                  <dd>{session.data.activeWorkspace.name}</dd>
                  <dt className="text-neutral-500">Workspace id</dt>
                  <dd className="break-all font-mono">
                    {session.data.activeWorkspace.id}
                  </dd>
                  <dt className="text-neutral-500">User</dt>
                  <dd className="font-mono">{session.data.user.email}</dd>
                  <dt className="text-neutral-500">Role</dt>
                  <dd>{roleLabel(workspaceRole)}</dd>
                  <dt className="text-neutral-500">User id</dt>
                  <dd className="break-all font-mono">{session.data.user.id}</dd>
                  <dt className="text-neutral-500">Device id</dt>
                  <dd className="break-all font-mono">{session.data.deviceId}</dd>
                  <dt className="text-neutral-500">API URL</dt>
                  <dd className="break-all font-mono">{session.data.apiUrl}</dd>
                </dl>
              </section>
            </>
          )}

          {activeView === 'requests' && (
            <>
            <section className="border border-[var(--color-border)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-medium">
                    Verifier approval requests
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    Fallback requests from verifiers who received a lookup link
                    before access was granted.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void accessRequests.refetch()}
                  disabled={accessRequests.isFetching}
                  className="grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                  aria-label="Refresh verifier approval requests"
                  title="Refresh verifier approval requests"
                >
                  <RefreshIcon />
                </button>
              </div>
              {accessRequests.isLoading ? (
                <LoadingState label="Loading verifier requests..." />
              ) : accessRequests.isError ? (
                <ErrorState
                  message={errorMessage(
                    accessRequests.error,
                    'Could not load verifier requests.',
                  )}
                  onRetry={() => void accessRequests.refetch()}
                />
              ) : accessRequests.data && accessRequests.data.length > 0 ? (
                <>
                  <div className="mt-5 grid grid-cols-[minmax(160px,260px)_160px] gap-3">
                    <label
                      htmlFor="requestSearch"
                      className="grid gap-1 text-[13px] text-neutral-600"
                    >
                      Search
                      <input
                        id="requestSearch"
                        value={requestSearch}
                        onChange={(e) => {
                          setRequestSearch(e.target.value);
                          setRequestPage(1);
                        }}
                        placeholder={`Verifier, attestation, ${projectNounLower}...`}
                        className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                    <label
                      htmlFor="requestStatusFilter"
                      className="grid gap-1 text-[13px] text-neutral-600"
                    >
                      Status
                      <select
                        id="requestStatusFilter"
                        value={requestStatusFilter}
                        onChange={(e) => {
                          setRequestStatusFilter(
                            e.target.value as RequestStatusFilter,
                          );
                          setRequestPage(1);
                        }}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="denied">Denied</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 border border-[var(--color-border)]">
                    <div className="border-b border-[var(--color-border)] bg-neutral-50 px-3 py-2 text-[12px] font-medium uppercase text-neutral-500">
                      Approval request records
                    </div>
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left text-[13px]"
                        style={{
                          minWidth:
                            Object.values(requestColumnWidths).reduce(
                              (sum, width) => sum + width,
                              0,
                            ) + 1,
                        }}
                      >
                        <colgroup>
                          <col style={{ width: requestColumnWidths.verifier }} />
                          <col style={{ width: requestColumnWidths.attestation }} />
                          <col style={{ width: requestColumnWidths.project }} />
                          <col style={{ width: requestColumnWidths.status }} />
                          <col style={{ width: requestColumnWidths.createdAt }} />
                          <col style={{ width: requestColumnWidths.reason }} />
                          <col style={{ width: requestColumnWidths.actions }} />
                        </colgroup>
                        <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                          <tr>
                            <StandardSortableTableHeader
                              label="Verifier"
                              columnKey="verifier"
                              sortKey="verifier"
                              sort={requestSort}
                              onSort={sortRequestsBy}
                              onResize={resizeRequestColumn}
                            />
                            <StandardSortableTableHeader
                              label="Attestation"
                              columnKey="attestation"
                              sortKey="attestation"
                              sort={requestSort}
                              onSort={sortRequestsBy}
                              onResize={resizeRequestColumn}
                            />
                            <StandardSortableTableHeader
                              label={projectNoun}
                              columnKey="project"
                              sortKey="project"
                              sort={requestSort}
                              onSort={sortRequestsBy}
                              onResize={resizeRequestColumn}
                            />
                            <StandardSortableTableHeader
                              label="Status"
                              columnKey="status"
                              sortKey="status"
                              sort={requestSort}
                              onSort={sortRequestsBy}
                              onResize={resizeRequestColumn}
                            />
                            <StandardSortableTableHeader
                              label="Requested"
                              columnKey="createdAt"
                              sortKey="createdAt"
                              sort={requestSort}
                              onSort={sortRequestsBy}
                              onResize={resizeRequestColumn}
                            />
                            <StandardResizableTableHeader
                              label="Decision reason"
                              columnKey="reason"
                              onResize={resizeRequestColumn}
                            />
                            <StandardResizableTableHeader
                              label="Actions"
                              columnKey="actions"
                              onResize={resizeRequestColumn}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {pagedRequests.map((request) => (
                            <tr
                              key={request.id}
                              className="border-t border-[var(--color-border)] align-top hover:bg-neutral-50"
                            >
                              <td className="px-3 py-3">
                                <div className="break-all font-mono">
                                  {request.requestedByEmail}
                                </div>
                                {request.message && (
                                  <div className="mt-1 text-[12px] text-neutral-500">
                                    {request.message}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {request.attestation.label}
                              </td>
                              <td className="px-3 py-3">{request.project.name}</td>
                              <td className="px-3 py-3">
                                <StatusPill state={request.status} />
                              </td>
                              <td className="px-3 py-3 text-neutral-500">
                                {formatDate(request.createdAt)}
                              </td>
                              <td className="px-3 py-3">
                                {request.status === 'pending' ? (
                                  <textarea
                                    id={`requestReason-${request.id}`}
                                    value={
                                      accessRequestDecisionReasons[request.id] ?? ''
                                    }
                                    onChange={(e) =>
                                      setAccessRequestDecisionReasons((current) => ({
                                        ...current,
                                        [request.id]: e.target.value,
                                      }))
                                    }
                                    rows={2}
                                    placeholder="Reason for approval or denial"
                                    className="w-full border border-[var(--color-border)] px-2 py-1.5 text-[13px] focus:border-neutral-700 focus:outline-none"
                                  />
                                ) : (
                                  <div className="text-[13px] text-neutral-600">
                                    {request.resolutionReason ??
                                      'Resolved request. Create a new request to reconsider.'}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {request.status === 'pending' ? (
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void approveAccessRequest(request.id)
                                      }
                                      disabled={Boolean(resolvingAccessRequestId)}
                                      className="bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void denyAccessRequest(request.id)
                                      }
                                      disabled={Boolean(resolvingAccessRequestId)}
                                      className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                                    >
                                      Deny
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[13px] text-neutral-500">
                                    Closed
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {pagedRequests.length === 0 && (
                      <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                        No approval requests match the current filters.
                      </div>
                    )}
                  </div>
                  <TablePager
                    count={pagedRequests.length}
                    total={visibleRequests.length}
                    noun="requests"
                    page={activeRequestPage}
                    pageCount={requestPageCount}
                    onPrevious={() => setRequestPage((page) => Math.max(1, page - 1))}
                    onNext={() =>
                      setRequestPage((page) => Math.min(requestPageCount, page + 1))
                    }
                  />
                </>
              ) : (
                <EmptyState
                  title="No pending approval requests"
                  body="The normal path is to grant verifier access from an attestation detail before sending the lookup link."
                />
              )}
              {accessRequestMessage && (
                <p className="mt-4 text-[13px] text-neutral-600">
                  {accessRequestMessage}
                </p>
              )}
            </section>
            </>
          )}

          {activeView === 'profile' && (
            <>
            <section className="border border-[var(--color-border)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-medium">Profile</h2>
                <p className="mt-1 text-[13px] text-neutral-500">
                  {session.data.user.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void devices.refetch();
                  void externalIdentities.refetch();
                }}
                disabled={devices.isFetching || externalIdentities.isFetching}
                className="grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                aria-label="Refresh profile"
                title="Refresh profile"
              >
                <RefreshIcon />
              </button>
            </div>
            <div className="mt-5 border-t border-[var(--color-border)] pt-5">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-[15px] font-medium">Sign-in methods</h3>
                {visibleProfileOidcProviders.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {visibleProfileOidcProviders.map((provider) => {
                      const connected = externalIdentities.data?.some(
                        (identity) =>
                          identity.providerSlug === provider.slug &&
                          !identity.disconnectedAt,
                      );
                      return (
                        <button
                          key={provider.slug}
                          type="button"
                          onClick={() =>
                            void connectExternalIdentity(provider.slug)
                          }
                          disabled={
                            connected || Boolean(connectingIdentityProvider)
                          }
                          className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                        >
                          {connectingIdentityProvider === provider.slug
                            ? 'Connecting...'
                            : connected
                              ? 'Connected'
                              : `Connect ${provider.displayName}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {externalIdentities.isLoading ? (
                <LoadingState label="Loading sign-in methods..." />
              ) : externalIdentities.isError ? (
                <ErrorState
                  message={errorMessage(
                    externalIdentities.error,
                    'Could not load sign-in methods.',
                  )}
                  onRetry={() => void externalIdentities.refetch()}
                />
              ) : (
                <div className="mt-5 grid gap-3">
                  {visibleExternalIdentities.length > 0 ? (
                    visibleExternalIdentities.map((identity) => (
                      <article
                        key={identity.id}
                        className="border border-[var(--color-border)] px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-[15px] font-medium">
                              {identity.providerDisplayName}
                            </h3>
                            <p className="mt-1 text-[13px] text-neutral-500">
                              {identity.email}
                            </p>
                            <p className="mt-2 text-[13px] text-neutral-500">
                              Connected {formatDate(identity.linkedAt)}
                              {identity.lastSeenAt
                                ? ` · Last used ${formatDate(identity.lastSeenAt)}`
                                : ''}
                            </p>
                          </div>
                          <div className="grid justify-items-end gap-2">
                            <StatusPill
                              state={
                                identity.disconnectedAt
                                  ? 'disconnected'
                                  : 'connected'
                              }
                            />
                            {!identity.disconnectedAt && (
                              <button
                                type="button"
                                onClick={() =>
                                  void disconnectExternalIdentity(identity.id)
                                }
                                disabled={Boolean(disconnectingIdentityId)}
                                className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                              >
                                Disconnect
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyState
                      title="No connected sign-in methods"
                      body="Password sign-in is available. OIDC providers appear here after they are connected."
                    />
                  )}
                </div>
              )}
              {identityMessage && (
                <p className="mt-4 text-[13px] text-neutral-600">
                  {identityMessage}
                </p>
              )}
            </div>
            <div className="mt-5 border-t border-[var(--color-border)] pt-5">
              <h3 className="text-[15px] font-medium">Trusted devices</h3>

            {devices.isLoading ? (
              <LoadingState label="Loading trusted devices..." />
            ) : devices.isError ? (
              <ErrorState
                message={errorMessage(
                  devices.error,
                  'Could not load trusted devices.',
                )}
                onRetry={() => void devices.refetch()}
              />
            ) : (
              <div className="mt-5 grid gap-3">
                {devices.data && devices.data.length > 0 ? devices.data.map((device) => (
                  <article
                    key={device.id}
                    className="border border-[var(--color-border)] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-medium">
                            {device.name}
                          </h3>
                          {device.isCurrent && (
                            <span className="border border-[#15803D] bg-[#F0FDF4] px-2 py-0.5 text-[11px] text-[#166534]">
                              This desktop
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[12px] text-neutral-500">
                          {device.id}
                        </p>
                        <p className="mt-2 text-[13px] text-neutral-500">
                          {device.platform} · {device.tenantName} · Paired{' '}
                          {formatDate(device.pairedAt)}
                        </p>
                      </div>
                      <div className="grid justify-items-end gap-2">
                        <StatusPill
                          state={device.revokedAt ? 'revoked' : 'active'}
                        />
                        {!device.revokedAt && (
                          <button
                            type="button"
                            onClick={() =>
                              void revokeDevice(device.id, device.isCurrent)
                            }
                            disabled={Boolean(revokingDeviceId)}
                            className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                          >
                            {device.isCurrent ? 'Sign out' : 'Revoke'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                )) : (
                  <EmptyState
                    title="No trusted devices"
                    body="This workspace has no active desktop devices yet."
                  />
                )}
              </div>
            )}
            </div>
            {deviceMessage && (
              <p className="mt-4 text-[13px] text-neutral-600">
                {deviceMessage}
              </p>
            )}
            </section>
            <section className="border border-[var(--color-border)] p-5">
              <h2 className="text-[16px] font-medium">Workspace access</h2>
              <p className="mt-3 text-[14px] leading-6 text-neutral-600">
                {canManageWorkspace
                  ? `You can manage this workspace, including ${projectNounPluralLower}, attestations, verifier access, users, and trusted devices.`
                  : `You can create ${projectNounPluralLower}, submit attestations, manage verifier access for your own records, and revoke your own trusted devices.`}
              </p>
            </section>
            </>
          )}

          {activeView === 'users' && canManageWorkspace && (
            <section className="grid gap-6">
              <div className="border border-[var(--color-border)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-[16px] font-medium">Users</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInviteFormOpen(true)}
                      className="bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white"
                    >
                      New member
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void members.refetch();
                        void invitations.refetch();
                        void workspaceDevices.refetch();
                      }}
                      disabled={
                        members.isFetching ||
                        invitations.isFetching ||
                        workspaceDevices.isFetching
                      }
                      className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                {inviteFormOpen && (
                  <form
                    onSubmit={createInvitation}
                    className="mt-5 border border-[var(--color-border)] bg-neutral-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-[15px] font-medium">
                          Invite member
                        </h3>
                        <p className="mt-1 text-[13px] text-neutral-500">
                          Send an invitation and choose the starting workspace
                          role.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInviteFormOpen(false)}
                        className="text-[13px] text-neutral-500 hover:text-neutral-900"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(220px,1fr)_180px_auto] md:items-end">
                      <ProjectField label="Email" htmlFor="inviteEmail">
                        <input
                          id="inviteEmail"
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField label="Role" htmlFor="inviteRole">
                        <select
                          id="inviteRole"
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(
                              e.target.value as 'tenant_admin' | 'producer',
                            )
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="producer">Workspace member</option>
                          <option value="tenant_admin">Workspace admin</option>
                        </select>
                      </ProjectField>
                      <p className="text-[12px] leading-5 text-neutral-500 md:col-span-3">
                        Verifiers are managed through {projectNounLower} or attestation
                        verification access, not workspace membership.
                      </p>
                      <button
                        type="submit"
                        disabled={inviting}
                        className="bg-neutral-900 px-4 py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
                      >
                        {inviting ? 'Sending...' : 'Send invite'}
                      </button>
                    </div>
                  </form>
                )}
                {members.isLoading || invitations.isLoading ? (
                  <LoadingState label="Loading users..." />
                ) : members.isError || invitations.isError ? (
                  <ErrorState
                    message={errorMessage(
                      members.error ?? invitations.error,
                      'Could not load users.',
                    )}
                    onRetry={() => {
                      void members.refetch();
                      void invitations.refetch();
                    }}
                  />
                ) : selectedMemberDetail ? (
                  <UserDetailPanel
                    member={selectedMemberDetail}
                    draft={
                      memberEditDrafts[selectedMemberDetail.userId] ?? {
                        role:
                          selectedMemberDetail.role === 'tenant_admin'
                            ? 'tenant_admin'
                            : 'producer',
                        organizationAdmin:
                          selectedMemberDetail.organizationRole ===
                          'organization_admin',
                        workspaceIds:
                          selectedMemberDetail.workspaces &&
                          selectedMemberDetail.workspaces.length > 0
                            ? selectedMemberDetail.workspaces.map(
                                (workspace) => workspace.id,
                              )
                            : session.data?.activeWorkspace.id
                              ? [session.data.activeWorkspace.id]
                              : [],
                      }
                    }
                    currentUserId={currentUserId}
                    currentDevice={selectedMemberCurrentDevice}
                    currentDeviceId={session.data?.deviceId ?? null}
                    currentDeviceLoading={workspaceDevices.isLoading}
                    currentDeviceError={workspaceDevices.error}
                    currentDeviceIsError={workspaceDevices.isError}
                    memberChanged={
                      (() => {
                        const draft =
                          memberEditDrafts[selectedMemberDetail.userId] ?? {
                            role:
                              selectedMemberDetail.role === 'tenant_admin'
                                ? 'tenant_admin'
                                : 'producer',
                            organizationAdmin:
                              selectedMemberDetail.organizationRole ===
                              'organization_admin',
                            workspaceIds:
                              selectedMemberDetail.workspaces &&
                              selectedMemberDetail.workspaces.length > 0
                                ? selectedMemberDetail.workspaces.map(
                                    (workspace) => workspace.id,
                                  )
                                : session.data?.activeWorkspace.id
                                  ? [session.data.activeWorkspace.id]
                                  : [],
                          };
                        const memberWorkspaceIds =
                          selectedMemberDetail.workspaces &&
                          selectedMemberDetail.workspaces.length > 0
                            ? selectedMemberDetail.workspaces.map(
                                (workspace) => workspace.id,
                              )
                            : session.data?.activeWorkspace.id
                              ? [session.data.activeWorkspace.id]
                              : [];
                        return (
                          draft.role !== selectedMemberDetail.role ||
                          draft.organizationAdmin !==
                            (selectedMemberDetail.organizationRole ===
                              'organization_admin') ||
                          !sameStringSet(draft.workspaceIds, memberWorkspaceIds)
                        );
                      })()
                    }
                    projectNounLower={projectNounLower}
                    projectNounPluralLower={projectNounPluralLower}
                    removingMemberId={removingMemberId}
                    savingMemberAccessId={savingMemberAccessId}
                    workspaceOptions={workspaceOptions}
                    onBack={() => closeMemberEditor(selectedMemberDetail.userId)}
                    onUpdateDraft={(patch) =>
                      updateMemberDraft(selectedMemberDetail.userId, patch)
                    }
                    onRemove={() =>
                      void removeMember(selectedMemberDetail.userId)
                    }
                    onRetryDevices={() => void workspaceDevices.refetch()}
                    onSubmit={(event) =>
                      void updateMemberAccess(
                        event,
                        selectedMemberDetail.userId,
                      )
                    }
                  />
                ) : visibleMembers.length > 0 ? (
                  <>
                  <div className="mt-5 grid grid-cols-[minmax(180px,1fr)_180px] gap-3">
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Search
                      <input
                        value={memberSearch}
                        onChange={(e) => {
                          setMemberSearch(e.target.value);
                          setMemberPage(1);
                        }}
                        placeholder="Name, email, role, workspace..."
                        className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Role
                      <select
                        value={memberRoleFilter}
                        onChange={(e) => {
                          setMemberRoleFilter(
                            e.target.value as MemberRoleFilter,
                          );
                          setMemberPage(1);
                        }}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All</option>
                        <option value="tenant_admin">Workspace admin</option>
                        <option value="producer">Workspace member</option>
                        <option value="organization_admin">
                          Organization admin
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 overflow-x-auto border border-[var(--color-border)]">
                    <table
                      className="w-full border-collapse text-left text-[13px]"
                      style={{
                        minWidth:
                          Object.values(memberColumnWidths).reduce(
                            (sum, width) => sum + width,
                            0,
                          ) + 1,
                      }}
                    >
                      <colgroup>
                        <col style={{ width: memberColumnWidths.user }} />
                        <col style={{ width: memberColumnWidths.status }} />
                        <col style={{ width: memberColumnWidths.role }} />
                        <col style={{ width: memberColumnWidths.workspaces }} />
                        <col style={{ width: memberColumnWidths.orgRole }} />
                        <col style={{ width: memberColumnWidths.joinedAt }} />
                      </colgroup>
                      <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                        <tr>
                          <StandardSortableTableHeader
                            label="User"
                            columnKey="user"
                            sortKey="user"
                            sort={memberSort}
                            onSort={sortMembersBy}
                            onResize={resizeMemberColumn}
                          />
                          <StandardSortableTableHeader
                            label="Status"
                            columnKey="status"
                            sortKey="status"
                            sort={memberSort}
                            onSort={sortMembersBy}
                            onResize={resizeMemberColumn}
                          />
                          <StandardSortableTableHeader
                            label="Workspace role"
                            columnKey="role"
                            sortKey="role"
                            sort={memberSort}
                            onSort={sortMembersBy}
                            onResize={resizeMemberColumn}
                          />
                          <StandardSortableTableHeader
                            label="Workspaces"
                            columnKey="workspaces"
                            sortKey="workspaces"
                            sort={memberSort}
                            onSort={sortMembersBy}
                            onResize={resizeMemberColumn}
                          />
                          <StandardSortableTableHeader
                            label="Org role"
                            columnKey="orgRole"
                            sortKey="orgRole"
                            sort={memberSort}
                            onSort={sortMembersBy}
                            onResize={resizeMemberColumn}
                          />
                          <StandardSortableTableHeader
                            label="Joined"
                            columnKey="joinedAt"
                            sortKey="joinedAt"
                            sort={memberSort}
                            onSort={sortMembersBy}
                            onResize={resizeMemberColumn}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {pagedMembers.map((member) => {
                          const isMember = member.kind === 'member';
                          return (
                            <Fragment key={member.userId}>
                              <tr
                                className={`border-t border-[var(--color-border)] align-top hover:bg-neutral-50 ${
                                  isMember ? 'cursor-pointer' : ''
                                }`}
                                role={isMember ? 'button' : undefined}
                                tabIndex={isMember ? 0 : undefined}
                                aria-label={
                                  isMember
                                    ? `Open user detail for ${member.email}`
                                    : undefined
                                }
                                onClick={() => {
                                  if (isMember) openUserDetail(member);
                                }}
                                onKeyDown={(event) => {
                                  if (isMember && (
                                    event.key === 'Enter' ||
                                    event.key === ' '
                                  )) {
                                    event.preventDefault();
                                    openUserDetail(member);
                                  }
                                }}
                              >
                                <td className="px-3 py-3">
                                  <div className="font-medium">
                                    {member.displayName ?? member.email}
                                  </div>
                                  <div className="mt-1 font-mono text-[12px] text-neutral-500">
                                    {member.email}
                                  </div>
                                  {member.kind === 'invitation' && (
                                    <div className="mt-1 text-[12px] text-neutral-500">
                                      Expires {formatDate(member.expiresAt)}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <div className="grid justify-items-start gap-2">
                                    <StatusPill state={member.status} />
                                    {member.kind === 'invitation' && (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void revokeInvitation(member.id);
                                        }}
                                        disabled={Boolean(revokingInvitationId)}
                                        className="text-[12px] text-[var(--color-accent)] hover:underline disabled:opacity-50"
                                      >
                                        Revoke invite
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  {roleLabel(member.role)}
                                </td>
                                <td className="px-3 py-3 text-neutral-600">
                                  {workspaceMembershipLabel(member.workspaces)}
                                </td>
                                <td className="px-3 py-3">
                                  {member.kind === 'invitation'
                                    ? 'Invited'
                                    : organizationRoleLabel(
                                        member.organizationRole,
                                      )}
                                </td>
                                <td className="px-3 py-3 text-neutral-500">
                                  {member.kind === 'invitation'
                                    ? `Invited ${formatDate(member.joinedAt)}`
                                    : formatDate(member.joinedAt)}
                                </td>
                              </tr>
                            </Fragment>
                          );
                        })}
                        {pagedMembers.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="border-t border-[var(--color-border)] px-3 py-6 text-center text-[13px] text-neutral-500"
                            >
                              No users match the current filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <TablePager
                    count={pagedMembers.length}
                    total={visibleMembers.length}
                    noun="users"
                    page={activeMemberPage}
                    pageCount={memberPageCount}
                    onPrevious={() =>
                      setMemberPage((page) => Math.max(1, page - 1))
                    }
                    onNext={() =>
                      setMemberPage((page) =>
                        Math.min(memberPageCount, page + 1),
                      )
                    }
                  />
                  </>
                ) : (
                  <EmptyState
                    title="No users yet"
                    body="Invite a workspace admin or member to give them workspace access."
                  />
                )}
                {inviteMessage && (
                  <p className="mt-4 text-[13px] text-neutral-600">
                    {inviteMessage}
                  </p>
                )}
              </div>
            </section>
          )}

          {activeView === 'workspaces' && canCreateWorkspace && (
            <section className="grid gap-6">
              <div className="border border-[var(--color-border)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-[16px] font-medium">Workspaces</h2>
                    <p className="mt-1 text-[13px] text-neutral-500">
                      Manage organization workspaces and switch operational scope.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceCreateOpen(true)}
                    className="bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white"
                  >
                    New workspace
                  </button>
                </div>

                {workspaceCreateOpen && (
                  <form
                    onSubmit={createWorkspace}
                    className="mt-5 grid gap-3 border border-[var(--color-border)] bg-neutral-50 p-4"
                  >
                    <label className="grid max-w-xl gap-1 text-[13px] text-neutral-600">
                      Name
                      <input
                        aria-label="New workspace name"
                        value={workspaceCreateName}
                        onChange={(event) => {
                          setWorkspaceCreateName(event.target.value);
                          setWorkspaceCreateError(null);
                        }}
                        className="border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] text-neutral-900 focus:border-neutral-700 focus:outline-none"
                        autoFocus
                      />
                    </label>
                    {workspaceCreateError && (
                      <p className="text-[13px] text-[#B91C1C]">
                        {workspaceCreateError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={creatingWorkspace}
                        className="bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                      >
                        {creatingWorkspace ? 'Creating...' : 'Create workspace'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceCreateOpen(false);
                          setWorkspaceCreateName('');
                          setWorkspaceCreateError(null);
                        }}
                        className="border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] hover:border-neutral-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                <div className="mt-5 grid max-w-sm gap-1 text-[13px] text-neutral-600">
                  Search
                  <input
                    value={workspaceSearch}
                    onChange={(event) => {
                      setWorkspaceSearch(event.target.value);
                      setWorkspacePage(1);
                    }}
                    placeholder="Name, slug, role..."
                    className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                  />
                </div>

                <div className="mt-4 overflow-x-auto border border-[var(--color-border)]">
                  <table
                    className="w-full border-collapse text-left text-[13px]"
                    style={{
                      minWidth:
                        Object.values(workspaceColumnWidths).reduce(
                          (sum, width) => sum + width,
                          0,
                        ) + 1,
                    }}
                  >
                    <colgroup>
                      <col style={{ width: workspaceColumnWidths.name }} />
                      <col style={{ width: workspaceColumnWidths.role }} />
                      <col style={{ width: workspaceColumnWidths.status }} />
                      <col style={{ width: workspaceColumnWidths.actions }} />
                    </colgroup>
                    <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                      <tr>
                        <StandardSortableTableHeader
                          label="Workspace"
                          columnKey="name"
                          sortKey="name"
                          sort={workspaceSort}
                          onSort={sortWorkspacesBy}
                          onResize={resizeWorkspaceColumn}
                        />
                        <StandardSortableTableHeader
                          label="Your role"
                          columnKey="role"
                          sortKey="role"
                          sort={workspaceSort}
                          onSort={sortWorkspacesBy}
                          onResize={resizeWorkspaceColumn}
                        />
                        <StandardSortableTableHeader
                          label="Status"
                          columnKey="status"
                          sortKey="status"
                          sort={workspaceSort}
                          onSort={sortWorkspacesBy}
                          onResize={resizeWorkspaceColumn}
                        />
                        <StandardResizableTableHeader
                          label="Actions"
                          columnKey="actions"
                          onResize={resizeWorkspaceColumn}
                          align="right"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedWorkspaces.map((workspace) => {
                        const isActive = workspace.id === activeWorkspaceId;
                        const isArchived = Boolean(workspace.archivedAt);
                        return (
                          <tr
                            key={workspace.id}
                            className="border-t border-[var(--color-border)] align-top hover:bg-neutral-50"
                          >
                            <td className="px-3 py-3">
                              <div className="font-medium">{workspace.name}</div>
                              <div className="mt-1 font-mono text-[12px] text-neutral-500">
                                {workspace.slug}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {roleLabel(workspace.role)}
                            </td>
                            <td className="px-3 py-3">
                              <StatusPill
                                state={
                                  isArchived
                                    ? 'archived'
                                    : isActive
                                      ? 'active'
                                      : 'available'
                                }
                              />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex justify-end gap-2">
                              {isActive && !isArchived ? (
                                <span className="px-3 py-1.5 text-[13px] text-neutral-500">
                                  Current
                                </span>
                              ) : !isArchived ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void switchWorkspace(workspace.id)
                                  }
                                  disabled={switchingWorkspace}
                                  className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                                >
                                  Switch
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  void updateWorkspaceArchivedState(
                                    workspace.id,
                                    isArchived,
                                  )
                                }
                                disabled={
                                  Boolean(updatingWorkspaceId) ||
                                  (isActive && !isArchived)
                                }
                                className="inline-grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                                aria-label={
                                  isArchived
                                    ? `Restore ${workspace.name}`
                                    : `Archive ${workspace.name}`
                                }
                                title={
                                  isArchived
                                    ? 'Restore workspace'
                                    : isActive
                                      ? 'Switch away before archiving'
                                      : 'Archive workspace'
                                }
                              >
                                {isArchived ? <RestoreIcon /> : <ArchiveIcon />}
                              </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {pagedWorkspaces.length === 0 && (
                    <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                      No workspaces match the current search.
                    </div>
                  )}
                </div>
                <TablePager
                  count={pagedWorkspaces.length}
                  total={visibleWorkspaces.length}
                  noun="workspaces"
                  page={activeWorkspacePage}
                  pageCount={workspacePageCount}
                  onPrevious={() =>
                    setWorkspacePage((page) => Math.max(1, page - 1))
                  }
                  onNext={() =>
                    setWorkspacePage((page) =>
                      Math.min(workspacePageCount, page + 1),
                    )
                  }
                />
              </div>
            </section>
          )}

          {activeView === 'settings' && (
            <section className="grid gap-6">
              <form
                onSubmit={updateGlobalSettings}
                className="border border-[var(--color-border)] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[16px] font-medium">
                      Global settings
                    </h2>
                    <p className="mt-1 max-w-[620px] text-[13px] leading-6 text-neutral-500">
                      Set the organization-wide grouping language. All
                      workspaces inherit this label.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={savingSettings || settingsProjectNoun === projectNoun}
                    className="bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
                  >
                    {savingSettings ? 'Saving...' : 'Save global settings'}
                  </button>
                </div>

                <div className="mt-5 max-w-[360px]">
                  <ProjectField
                    label="Grouping language"
                    htmlFor="settingsProjectNoun"
                  >
                    <select
                      id="settingsProjectNoun"
                      value={settingsProjectNoun}
                      onChange={(e) => setSettingsProjectNoun(e.target.value)}
                      className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                    >
                      {PROJECT_NOUN_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[12px] leading-5 text-neutral-500">
                      This changes labels like {projectNounPlural}, New{' '}
                      {projectNounLower}, and {projectNoun} filters for this
                      organization.
                    </p>
                  </ProjectField>
                </div>

                {settingsMessage && (
                  <p className="mt-4 text-[13px] text-neutral-600">
                    {settingsMessage}
                  </p>
                )}
              </form>
            </section>
          )}

          {activeView === 'projects' && (
            <section className="grid gap-6">
            {projectViewMode === 'list' && (
            <div className="border border-[var(--color-border)] p-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-[16px] font-medium">{projectNounPlural}</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetNewProjectForm();
                      setProjectViewMode('new');
                    }}
                    className="bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white"
                  >
                    New {projectNounLower}
                  </button>
                  <button
                    type="button"
                    onClick={() => void projects.refetch()}
                    disabled={projects.isFetching}
                    className="grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                    aria-label={`Refresh ${projectNounPluralLower}`}
                    title={`Refresh ${projectNounPluralLower}`}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>

              {projects.isLoading ? (
                <LoadingState label={`Loading ${projectNounPluralLower}...`} />
              ) : projects.isError ? (
                <ErrorState
                  message={errorMessage(
                    projects.error,
                    `Could not load ${projectNounPluralLower}.`,
                  )}
                  onRetry={() => void projects.refetch()}
                />
              ) : projects.data && projects.data.length > 0 ? (
                <>
                  <div className="mt-5 grid grid-cols-[minmax(180px,1fr)_160px] gap-3">
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Search
                      <input
                        value={projectSearch}
                        onChange={(e) => {
                          setProjectSearch(e.target.value);
                          setProjectPage(1);
                        }}
                        placeholder="Name..."
                        className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Status
                      <select
                        value={projectStatusFilter}
                        onChange={(e) => {
                          setProjectStatusFilter(
                            e.target.value as ProjectStatusFilter,
                          );
                          setProjectPage(1);
                        }}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All</option>
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 border border-[var(--color-border)]">
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-neutral-50 px-3 py-2">
                      <div className="text-[12px] font-medium uppercase text-neutral-500">
                        {projectNoun} records
                      </div>
                      <div className="text-[12px] text-neutral-500">
                        {projectCount} active
                        {canManageWorkspace && archivedProjectCount > 0
                          ? ` · ${archivedProjectCount} archived`
                          : ''}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left text-[13px]"
                        style={{
                          minWidth:
                            Object.values(projectColumnWidths).reduce(
                              (sum, width) => sum + width,
                              0,
                            ) + 1,
                        }}
                      >
                        <colgroup>
                          <col style={{ width: projectColumnWidths.name }} />
                          <col style={{ width: projectColumnWidths.status }} />
                          <col style={{ width: projectColumnWidths.actions }} />
                        </colgroup>
                        <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                          <tr>
                            <StandardSortableTableHeader
                              label="Name"
                              columnKey="name"
                              sortKey="name"
                              sort={projectSort}
                              onSort={sortProjectsBy}
                              onResize={resizeProjectColumn}
                            />
                            <StandardSortableTableHeader
                              label="Status"
                              columnKey="status"
                              sortKey="status"
                              sort={projectSort}
                              onSort={sortProjectsBy}
                              onResize={resizeProjectColumn}
                            />
                            <StandardResizableTableHeader
                              label="Actions"
                              columnKey="actions"
                              onResize={resizeProjectColumn}
                              align="right"
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {pagedProjects.map((project) => (
                            <tr
                              key={project.id}
                              className="border-t border-[var(--color-border)] align-top hover:bg-neutral-50"
                            >
                              <td className="px-3 py-3 font-medium">
                                {project.name}
                              </td>
                              <td className="px-3 py-3">
                                <StatusPill
                                  state={project.archivedAt ? 'archived' : 'active'}
                                />
                                {project.archivedAt && (
                                  <div className="mt-1 text-[12px] text-neutral-500">
                                    {formatDate(project.archivedAt)}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right">
                                {canManageWorkspace && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void updateProjectArchivedState(
                                        project.slug,
                                        Boolean(project.archivedAt),
                                      )
                                    }
                                    disabled={Boolean(updatingProjectSlug)}
                                    className="inline-grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                                    aria-label={
                                      project.archivedAt
                                        ? `Restore ${project.name}`
                                        : `Archive ${project.name}`
                                    }
                                    title={
                                      project.archivedAt
                                        ? `Restore ${projectNounLower}`
                                        : `Archive ${projectNounLower}`
                                    }
                                  >
                                    {project.archivedAt ? (
                                      <RestoreIcon />
                                    ) : (
                                      <ArchiveIcon />
                                    )}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {pagedProjects.length === 0 && (
                      <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                        No {projectNounPluralLower} match the current filters.
                      </div>
                    )}
                  </div>
                  <TablePager
                    count={pagedProjects.length}
                    total={visibleProjects.length}
                    noun={projectNounPluralLower}
                    page={activeProjectPage}
                    pageCount={projectPageCount}
                    onPrevious={() => setProjectPage((page) => Math.max(1, page - 1))}
                    onNext={() =>
                      setProjectPage((page) => Math.min(projectPageCount, page + 1))
                    }
                  />
                </>
              ) : (
                <EmptyState
                  title={`No ${projectNounPluralLower} yet`}
                  body={`Create your first ${projectNounLower} to group related attestations and verifier access.`}
                  actionLabel={`Create your first ${projectNounLower}`}
                  onAction={() => {
                    resetNewProjectForm();
                    setProjectViewMode('new');
                  }}
                />
              )}
            </div>
            )}

            {projectViewMode === 'new' && (
            <form
              onSubmit={createProject}
              className="border border-[var(--color-border)] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-medium">New {projectNounLower}</h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    Create a {projectNounLower} to group related attestations and verifier access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetNewProjectForm();
                    setProjectViewMode('list');
                  }}
                  className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700"
                >
                  Back to {projectNounPluralLower}
                </button>
              </div>
              <div className="mt-5 grid gap-4">
                <ProjectField label="Name" htmlFor="projectName">
                  <input
                    id="projectName"
                    value={projectName}
                    onChange={(e) => updateProjectName(e.target.value)}
                    required
                    className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                  />
                </ProjectField>
                {projectError && (
                  <p className="text-[13px] text-[#B91C1C]">{projectError}</p>
                )}

                <button
                  type="submit"
                  disabled={creatingProject}
                  className="bg-neutral-900 px-4 py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
                >
                  {creatingProject ? 'Creating...' : `Create ${projectNounLower}`}
                </button>
              </div>
            </form>
            )}
            </section>
          )}

          {activeView === 'audit' && (
            <section className="border border-[var(--color-border)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-medium">Events</h2>
                  {audit.data && (
                    <p className="mt-1 text-[13px] text-neutral-500">
                      {audit.data.scope === 'full'
                        ? 'Full workspace audit'
                        : 'Limited producer audit'}
                    </p>
                  )}
                </div>
                {eventsTab === 'records' && (
                  <button
                    type="button"
                    onClick={() => void audit.refetch()}
                    disabled={audit.isFetching}
                    className="grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                    aria-label="Refresh events"
                    title="Refresh events"
                  >
                    <RefreshIcon />
                  </button>
                )}
              </div>
              <div
                className="mt-5 flex overflow-x-auto border-b border-[var(--color-border)]"
                role="tablist"
                aria-label="Event sections"
              >
                <AttestationDetailTabButton
                  label="Records"
                  active={eventsTab === 'records'}
                  onClick={() => setEventsTab('records')}
                >
                  Records
                </AttestationDetailTabButton>
                <AttestationDetailTabButton
                  label="Exports"
                  active={eventsTab === 'exports'}
                  onClick={() => setEventsTab('exports')}
                >
                  Exports
                </AttestationDetailTabButton>
              </div>

              {eventsTab === 'exports' && canManageWorkspace && (
                <div className="mt-5 grid gap-3 border border-[var(--color-border)] bg-neutral-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[13px] font-medium">
                        Export filters
                      </h3>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        Event exports can cover this workspace or the full
                        organization. Evidence exports remain workspace-scoped.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void exportEvents('json')}
                        disabled={Boolean(exportingEventsFormat)}
                        className="border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                      >
                        {exportingEventsFormat === 'json'
                          ? 'Exporting...'
                          : 'Export JSON'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportEvents('csv')}
                        disabled={Boolean(exportingEventsFormat)}
                        className="border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                      >
                        {exportingEventsFormat === 'csv'
                          ? 'Exporting...'
                          : 'Export CSV'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void createEvidenceExportJob()}
                        disabled={exportingEvidenceManifest}
                        className="border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] hover:border-neutral-700 disabled:opacity-50"
                      >
                        {exportingEvidenceManifest
                          ? 'Exporting...'
                          : 'Create evidence export'}
                      </button>
                    </div>
                  </div>
                  {eventExportMessage && (
                    <p className="text-[13px] text-neutral-600">
                      {eventExportMessage}
                    </p>
                  )}
                  <div className="grid gap-3 md:grid-cols-[minmax(150px,0.9fr)_minmax(160px,1fr)_minmax(160px,1fr)_140px_140px]">
                    <label className="grid gap-1 text-[12px] text-neutral-600">
                      Scope
                      <select
                        value={eventExportScope}
                        onChange={(e) =>
                          setEventExportScope(
                            e.target.value === 'organization' &&
                              canExportOrganizationEvents
                              ? 'organization'
                              : 'workspace',
                          )
                        }
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="workspace">This workspace</option>
                        {canExportOrganizationEvents && (
                          <option value="organization">
                            All organization workspaces
                          </option>
                        )}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[12px] text-neutral-600">
                      {projectNoun}
                      <select
                        value={eventProjectExportFilter}
                        onChange={(e) =>
                          setEventProjectExportFilter(e.target.value)
                        }
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All {projectNounPluralLower}</option>
                        {(projects.data ?? []).map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[12px] text-neutral-600">
                      Actor
                      <select
                        value={eventActorExportFilter}
                        onChange={(e) =>
                          setEventActorExportFilter(e.target.value)
                        }
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All actors</option>
                        {(members.data ?? []).map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[12px] text-neutral-600">
                      From
                      <input
                        type="date"
                        value={eventExportFrom}
                        onChange={(e) => setEventExportFrom(e.target.value)}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                    <label className="grid gap-1 text-[12px] text-neutral-600">
                      To
                      <input
                        type="date"
                        value={eventExportTo}
                        onChange={(e) => setEventExportTo(e.target.value)}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="border-t border-[var(--color-border)] pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[13px] font-medium">
                        Recent evidence exports
                      </h3>
                      <button
                        type="button"
                        onClick={() => void evidenceExportJobs.refetch()}
                        disabled={evidenceExportJobs.isFetching}
                        className="grid h-7 w-7 place-items-center border border-[var(--color-border)] bg-white text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                        aria-label="Refresh evidence exports"
                        title="Refresh evidence exports"
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                    {evidenceExportJobs.isLoading ? (
                      <p className="mt-2 text-[12px] text-neutral-500">
                        Loading exports...
                      </p>
                    ) : evidenceExportJobs.isError ? (
                      <p className="mt-2 text-[12px] text-[#B91C1C]">
                        {errorMessage(
                          evidenceExportJobs.error,
                          'Could not load evidence exports.',
                        )}
                      </p>
                    ) : (evidenceExportJobs.data ?? []).length > 0 ? (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full border-collapse text-left text-[12px]">
                          <thead className="text-neutral-500">
                            <tr>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Created
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Status
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Progress
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Retries
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Expires
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Artifacts
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Records
                              </th>
                              <th className="border-b border-[var(--color-border)] py-2 pr-3 font-medium">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(evidenceExportJobs.data ?? []).map((job) => (
                              <tr key={job.id}>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {formatDate(job.createdAt)}
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {job.status}
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {job.progressPercent}%
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {job.retryCount}/{job.maxRetries}
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {job.expiresAt ? formatDate(job.expiresAt) : 'Never'}
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {job.artifactCount}
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  {job.rowCount}
                                </td>
                                <td className="border-b border-[var(--color-border)] py-2 pr-3">
                                  <div className="flex flex-wrap gap-3">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void downloadEvidenceExportJob(job.id)
                                      }
                                      disabled={
                                        downloadingEvidenceExportJobId === job.id
                                      }
                                      className="text-[12px] text-[#00798C] underline decoration-dotted underline-offset-4 disabled:text-neutral-400"
                                    >
                                      {downloadingEvidenceExportJobId === job.id
                                        ? 'Downloading...'
                                        : 'Download manifest'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void downloadEvidenceExportBundle(job.id)
                                      }
                                      disabled={
                                        downloadingEvidenceBundleJobId === job.id ||
                                        !job.resultObjectKey
                                      }
                                      className="text-[12px] text-[#00798C] underline decoration-dotted underline-offset-4 disabled:text-neutral-400"
                                    >
                                      {downloadingEvidenceBundleJobId === job.id
                                        ? 'Downloading...'
                                        : 'Download bundle'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-neutral-500">
                        No evidence exports yet.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {eventsTab === 'exports' && !canManageWorkspace && (
                <div className="mt-5">
                  <EmptyState
                    title="Exports are admin only"
                    body="Workspace admins can export event logs and evidence manifests from this tab."
                  />
                </div>
              )}

              {eventsTab === 'records' && (
              audit.isLoading ? (
                <LoadingState label="Loading events..." />
              ) : audit.isError ? (
                <ErrorState
                  message={errorMessage(
                    audit.error,
                    'Could not load events.',
                  )}
                  onRetry={() => void audit.refetch()}
                />
              ) : auditEvents.length > 0 ? (
                <>
                  <div className="mt-5 grid grid-cols-[minmax(180px,1fr)_180px] gap-3">
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Search
                      <input
                        value={eventSearch}
                        onChange={(e) => {
                          setEventSearch(e.target.value);
                          setEventPage(1);
                        }}
                        placeholder="Action, actor, target..."
                        className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Category
                      <select
                        value={eventCategoryFilter}
                        onChange={(e) => {
                          setEventCategoryFilter(e.target.value);
                          setEventPage(1);
                        }}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All</option>
                        {eventCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 border border-[var(--color-border)]">
                    <div className="border-b border-[var(--color-border)] bg-neutral-50 px-3 py-2 text-[12px] font-medium uppercase text-neutral-500">
                      Event records
                    </div>
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left text-[13px]"
                        style={{
                          minWidth:
                            Object.values(eventColumnWidths).reduce(
                              (sum, width) => sum + width,
                              0,
                            ) + 1,
                        }}
                      >
                        <colgroup>
                          <col style={{ width: eventColumnWidths.action }} />
                          <col style={{ width: eventColumnWidths.category }} />
                          <col style={{ width: eventColumnWidths.actor }} />
                          <col style={{ width: eventColumnWidths.target }} />
                          <col style={{ width: eventColumnWidths.createdAt }} />
                        </colgroup>
                        <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                          <tr>
                            <StandardSortableTableHeader
                              label="Action"
                              columnKey="action"
                              sortKey="action"
                              sort={eventSort}
                              onSort={sortEventsBy}
                              onResize={resizeEventColumn}
                            />
                            <StandardSortableTableHeader
                              label="Category"
                              columnKey="category"
                              sortKey="category"
                              sort={eventSort}
                              onSort={sortEventsBy}
                              onResize={resizeEventColumn}
                            />
                            <StandardSortableTableHeader
                              label="Actor"
                              columnKey="actor"
                              sortKey="actor"
                              sort={eventSort}
                              onSort={sortEventsBy}
                              onResize={resizeEventColumn}
                            />
                            <StandardSortableTableHeader
                              label="Target"
                              columnKey="target"
                              sortKey="target"
                              sort={eventSort}
                              onSort={sortEventsBy}
                              onResize={resizeEventColumn}
                            />
                            <StandardSortableTableHeader
                              label="Created"
                              columnKey="createdAt"
                              sortKey="createdAt"
                              sort={eventSort}
                              onSort={sortEventsBy}
                              onResize={resizeEventColumn}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {pagedEvents.map((event) => (
                            <tr
                              key={event.id}
                              className="border-t border-[var(--color-border)] align-top hover:bg-neutral-50"
                            >
                              <td className="px-3 py-3 font-medium">
                                {auditActionLabel(event.action)}
                              </td>
                              <td className="px-3 py-3 text-neutral-600">
                                {event.category}
                              </td>
                              <td className="px-3 py-3 break-all font-mono text-[12px]">
                                {auditActorLabel(event)}
                              </td>
                              <td className="px-3 py-3">
                                {event.targetType && (
                                  <div className="text-neutral-700">
                                    {event.targetType}
                                  </div>
                                )}
                                {event.targetId && (
                                  <div className="mt-1 font-mono text-[12px] text-neutral-500">
                                    <CopyableValue
                                      value={event.targetId}
                                      label="Target id"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-neutral-500">
                                {formatDate(event.createdAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {pagedEvents.length === 0 && (
                      <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                        No events match the current filters.
                      </div>
                    )}
                  </div>
                  <TablePager
                    count={pagedEvents.length}
                    total={visibleEvents.length}
                    noun="events"
                    page={activeEventPage}
                    pageCount={eventPageCount}
                    onPrevious={() => setEventPage((page) => Math.max(1, page - 1))}
                    onNext={() =>
                      setEventPage((page) => Math.min(eventPageCount, page + 1))
                    }
                  />
                </>
              ) : (
                <EmptyState
                  title="No events yet"
                  body={`Workspace events will appear here as members, devices, ${projectNounPluralLower}, attestations, and verifier access change.`}
                />
              ))}
            </section>
          )}

          {activeView === 'attestations' && (
            <>
              {!hasProjects && (
                <EmptyState
                  title={`Create a ${projectNounLower} first`}
                  body={`Attestations belong to ${projectNounPluralLower}. Create a ${projectNounLower}, then come back here to submit the first file hash.`}
                  actionLabel={`Go to ${projectNounPluralLower}`}
                  onAction={() => setActiveView('projects')}
                />
              )}
              {attestationViewMode === 'new' && (
              <form
                onSubmit={submitAttestation}
                className="grid gap-5"
              >
            <section className="border border-[var(--color-border)] p-5">
              <div>
                <h2 className="text-[16px] font-medium">New attestation</h2>
                <p className="mt-1 text-[13px] text-neutral-500">
                  File bytes stay local. Proveria stores the cryptographic
                  record.
                </p>
              </div>

              <div className="mt-5 grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('file');
                      setDriveFileReference('');
                      setDriveFileName('');
                      setDriveMimeType('');
                      setDriveModifiedTime('');
                    }}
                    className={`border p-4 text-left ${
                      hashMode === 'file'
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-[var(--color-border)] hover:border-neutral-700'
                    }`}
                  >
                    <span className="block text-[14px] font-medium">
                      File + content proof
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
                      Hash local files in the browser. Plain text and native PDF
                      text also get local text shingles when extractable.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('external');
                      setAttestationFiles([]);
                      setAttestationDropActive(false);
                      setAttestationResults([]);
                    }}
                    className={`border p-4 text-left ${
                      hashMode === 'external'
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-[var(--color-border)] hover:border-neutral-700'
                    }`}
                  >
                    <span className="block text-[14px] font-medium">
                      External SHA-256 only
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
                      Commit a hash produced outside Proveria. This records
                      whole-file coverage only and does not add content shingles.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('model_release');
                      setAttestationFiles([]);
                      setExternalHash('');
                      setAttestationDropActive(false);
                      setAttestationResults([]);
                    }}
                    className={`border p-4 text-left ${
                      hashMode === 'model_release'
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-[var(--color-border)] hover:border-neutral-700'
                    }`}
                  >
                    <span className="block text-[14px] font-medium">
                      Model release receipt
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
                      Build a claim-backed provenance record for a model
                      version, hash it locally, and generate a verifiable
                      receipt.
                    </span>
                  </button>
                  {SHOW_GOOGLE_SURFACES && (
                    <button
                      type="button"
                      onClick={() => {
                        setHashMode('google_drive');
                        setExternalHash('');
                        setAttestationResults([]);
                        setAttestationFiles((files) => files.slice(0, 1));
                        if (
                          !driveAccountEmail &&
                          connectedGoogleIdentity?.email
                        ) {
                          setDriveAccountEmail(connectedGoogleIdentity.email);
                        }
                      }}
                      className={`border p-4 text-left ${
                        hashMode === 'google_drive'
                          ? 'border-neutral-900 bg-neutral-50'
                          : 'border-[var(--color-border)] hover:border-neutral-700'
                      }`}
                    >
                      <span className="block text-[14px] font-medium">
                        Google Drive
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
                        Select a downloaded Drive file, hash it locally, and
                        attach Drive source metadata to the record.
                      </span>
                    </button>
                  )}
                </div>

                <ProjectField label="Name" htmlFor="attestationLabel">
                  <input
                    id="attestationLabel"
                    value={attestationLabel}
                    onChange={(e) => {
                      const nextLabel = e.target.value;
                      setAttestationLabel(nextLabel);
                      if (
                        (hashMode === 'file' ||
                          hashMode === 'google_drive') &&
                        attestationFiles.length > 0
                      ) {
                        if (attestationFiles.length === 1) {
                          const [file] = attestationFiles;
                          if (!file) return;
                          updateAttestationFileLabel(file.id, nextLabel);
                          return;
                        }
                        const batchBaseName =
                          sanitizeAttestationName(nextLabel);
                        setAttestationFiles((files) =>
                          files.map((file, index) => ({
                            ...file,
                            label: numberedAttestationName(
                              batchBaseName,
                              index + 1,
                            ),
                            result: file.result
                              ? {
                                  ...file.result,
                                  label: numberedAttestationName(
                                    batchBaseName,
                                    index + 1,
                                  ),
                                }
                              : undefined,
                          })),
                        );
                      }
                    }}
                    required
                    maxLength={128}
                    className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                  />
                  {attestationLabel.trim() &&
                    !isValidAttestationName(attestationLabel) && (
                    <p className="mt-1 text-[12px] text-[#B91C1C]">
                      {ATTESTATION_NAME_HELP}
                    </p>
                  )}
                </ProjectField>

                <ProjectField label={projectNoun} htmlFor="attestationProject">
                  <select
                    id="attestationProject"
                    value={attestationProjectSlug}
                    onChange={(e) => {
                      setAttestationProjectSlug(e.target.value);
                      setSelectedAttestationId('');
                      setReceiptMessage(null);
                      setVerifierLinkMessage(null);
                    }}
                    disabled={!activeProjects.length}
                    className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none disabled:bg-neutral-50"
                  >
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.slug}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </ProjectField>

                {hashMode === 'file' || hashMode === 'google_drive' ? (
                  <>
                  {hashMode === 'google_drive' && (
                    <div className="grid gap-3 border border-[var(--color-border)] bg-neutral-50 p-3 md:grid-cols-2">
                      <ProjectField
                        label="Drive file link or ID"
                        htmlFor="driveFileReference"
                      >
                        <input
                          id="driveFileReference"
                          value={driveFileReference}
                          onChange={(e) =>
                            setDriveFileReference(e.target.value)
                          }
                          placeholder="https://drive.google.com/file/d/... or file ID"
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Google account"
                        htmlFor="driveAccountEmail"
                      >
                        <input
                          id="driveAccountEmail"
                          type="email"
                          value={driveAccountEmail}
                          onChange={(e) =>
                            setDriveAccountEmail(e.target.value)
                          }
                          placeholder={
                            connectedGoogleIdentity?.email ??
                            'name@example.com'
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Drive file name"
                        htmlFor="driveFileName"
                      >
                        <input
                          id="driveFileName"
                          value={driveFileName}
                          onChange={(e) => setDriveFileName(e.target.value)}
                          placeholder="Defaults to selected local file name"
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Modified time"
                        htmlFor="driveModifiedTime"
                      >
                        <input
                          id="driveModifiedTime"
                          value={driveModifiedTime}
                          onChange={(e) =>
                            setDriveModifiedTime(e.target.value)
                          }
                          placeholder="Optional ISO timestamp"
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <div className="md:col-span-2">
                        <p className="text-[12px] leading-5 text-neutral-500">
                          Proveria does not receive a Google Drive access token
                          in this flow. Choose or download the Drive file
                          yourself, then Proveria hashes the local bytes and
                          records the Drive file reference.
                        </p>
                        {driveFileReference && !driveFileId && (
                          <p className="mt-2 text-[12px] text-[#B91C1C]">
                            Enter a Google Drive file URL or raw file ID.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <ProjectField label="File" htmlFor="attestationFile">
                    <label
                      htmlFor="attestationFile"
                      data-testid="attestation-dropzone"
                      onDragEnter={handleAttestationDragOver}
                      onDragOver={handleAttestationDragOver}
                      onDragLeave={() => setAttestationDropActive(false)}
                      onDrop={handleAttestationDrop}
                      className={`block cursor-pointer border border-dashed px-4 py-5 text-[14px] transition-colors ${
                        attestationDropActive
                          ? 'border-neutral-900 bg-neutral-100'
                          : 'border-[var(--color-border)] bg-neutral-50 hover:border-neutral-700'
                      }`}
                    >
                      <input
                        id="attestationFile"
                        type="file"
                        multiple={hashMode !== 'google_drive'}
                        onChange={(e) =>
                          void selectAttestationFiles(e.currentTarget.files)
                        }
                        className="sr-only"
                      />
                      <span className="block font-medium text-neutral-900">
                        Drop files here or choose files
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
                        {hashMode === 'google_drive'
                          ? 'Choose the downloaded Drive file that matches the Drive link above.'
                          : 'Multiple files are supported. Hashing and content proof generation still happen locally before submission.'}
                      </span>
                    </label>
                  </ProjectField>
                  </>
                ) : hashMode === 'model_release' ? (
                  <div className="grid gap-4 border border-[var(--color-border)] bg-neutral-50 p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <ProjectField label="Model name" htmlFor="modelName">
                        <input
                          id="modelName"
                          value={modelReleaseForm.modelName}
                          onChange={(e) =>
                            updateModelReleaseField('modelName', e.target.value)
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField label="Model version" htmlFor="modelVersion">
                        <input
                          id="modelVersion"
                          value={modelReleaseForm.modelVersion}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'modelVersion',
                              e.target.value,
                            )
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField label="Model type" htmlFor="modelType">
                        <select
                          id="modelType"
                          value={modelReleaseForm.modelType}
                          onChange={(e) =>
                            updateModelReleaseField('modelType', e.target.value)
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option>LLM</option>
                          <option>Classifier</option>
                          <option>Recommender</option>
                          <option>Embedding model</option>
                          <option>Vision model</option>
                          <option>Speech model</option>
                          <option>Multimodal model</option>
                          <option>Other</option>
                        </select>
                      </ProjectField>
                      <ProjectField label="Release stage" htmlFor="releaseStage">
                        <select
                          id="releaseStage"
                          value={modelReleaseForm.releaseStage}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'releaseStage',
                              e.target.value,
                            )
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="draft">Draft</option>
                          <option value="internal_test">Internal test</option>
                          <option value="staging">Staging</option>
                          <option value="production">Production</option>
                          <option value="deprecated">Deprecated</option>
                          <option value="retired">Retired</option>
                        </select>
                      </ProjectField>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <ProjectField label="Claim type" htmlFor="claimType">
                        <select
                          id="claimType"
                          value={modelReleaseForm.claimType}
                          onChange={(e) =>
                            updateModelReleaseField('claimType', e.target.value)
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="model_release_approved">
                            Model release approved
                          </option>
                          <option value="trained_on_dataset">
                            Trained on dataset
                          </option>
                          <option value="not_trained_on_dataset">
                            Not trained on dataset
                          </option>
                          <option value="evaluated_against_benchmark">
                            Evaluated against benchmark
                          </option>
                          <option value="approved_under_policy">
                            Approved under policy
                          </option>
                          <option value="risk_review_completed">
                            Risk review completed
                          </option>
                          <option value="model_card_complete">
                            Model card complete
                          </option>
                          <option value="deployment_authorized">
                            Deployment authorized
                          </option>
                        </select>
                      </ProjectField>
                      <ProjectField label="Claim scope" htmlFor="claimScope">
                        <select
                          id="claimScope"
                          value={modelReleaseForm.claimScope}
                          onChange={(e) =>
                            updateModelReleaseField('claimScope', e.target.value)
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="model_version">Model version</option>
                          <option value="dataset">Dataset</option>
                          <option value="training_run">Training run</option>
                          <option value="evaluation">Evaluation</option>
                          <option value="approval">Approval</option>
                          <option value="deployment">Deployment</option>
                          <option value="full_release_package">
                            Full release package
                          </option>
                        </select>
                      </ProjectField>
                      <ProjectField label="Subject type" htmlFor="subjectType">
                        <select
                          id="subjectType"
                          value={modelReleaseForm.subjectType}
                          onChange={(e) =>
                            updateModelReleaseField('subjectType', e.target.value)
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="model_artifact">Model artifact</option>
                          <option value="dataset_manifest">
                            Dataset manifest
                          </option>
                          <option value="training_run">Training run</option>
                          <option value="evaluation_report">
                            Evaluation report
                          </option>
                          <option value="approval_record">
                            Approval record
                          </option>
                          <option value="deployment_package">
                            Deployment package
                          </option>
                        </select>
                      </ProjectField>
                    </div>

                    <ProjectField label="Claim text" htmlFor="claimText">
                      <textarea
                        id="claimText"
                        value={modelReleaseForm.claimText}
                        onChange={(e) =>
                          updateModelReleaseField('claimText', e.target.value)
                        }
                        required
                        rows={3}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    </ProjectField>

                    <div className="grid gap-3 md:grid-cols-2">
                      <ProjectField
                        label="Subject identifier"
                        htmlFor="subjectIdentifier"
                      >
                        <input
                          id="subjectIdentifier"
                          value={modelReleaseForm.subjectIdentifier}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'subjectIdentifier',
                              e.target.value,
                            )
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField label="Subject hash" htmlFor="subjectHash">
                        <input
                          id="subjectHash"
                          value={modelReleaseForm.subjectHash}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'subjectHash',
                              e.target.value.trim().toLowerCase(),
                            )
                          }
                          required
                          placeholder="64 lowercase hex characters"
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-[13px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                    </div>

                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-medium uppercase text-neutral-500">
                            Evidence hashes
                          </div>
                          <p className="mt-1 text-[12px] text-neutral-500">
                            Generate QA hashes from the model and claim context,
                            or replace them with real artifact hashes.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void generateModelReleaseHashes()}
                          className="border border-[var(--color-border)] bg-white px-3 py-2 text-[12px] font-medium hover:border-neutral-700"
                        >
                          Generate hashes
                        </button>
                      </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {([
                        ['artifactManifestHash', 'Artifact manifest hash'],
                        ['modelCardHash', 'Model card hash'],
                        ['datasetManifestHash', 'Dataset manifest hash'],
                        ['evaluationReportHash', 'Evaluation report hash'],
                        ['riskReviewHash', 'Risk review hash'],
                      ] satisfies Array<[keyof ModelReleaseFormState, string]>).map(([field, label]) => (
                        <ProjectField
                          key={field}
                          label={label}
                          htmlFor={field}
                        >
                          <input
                            id={field}
                            value={
                              modelReleaseForm[
                                field as keyof ModelReleaseFormState
                              ]
                            }
                            onChange={(e) =>
                              updateModelReleaseField(
                                field as keyof ModelReleaseFormState,
                                e.target.value.trim().toLowerCase(),
                              )
                            }
                            required={field !== 'riskReviewHash'}
                            placeholder="64 lowercase hex characters"
                            className="w-full border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-[13px] focus:border-neutral-700 focus:outline-none"
                          />
                        </ProjectField>
                      ))}
                    </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                      <ProjectField label="Policy ID" htmlFor="policyId">
                        <input
                          id="policyId"
                          value={modelReleaseForm.policyId}
                          onChange={(e) =>
                            updateModelReleaseField('policyId', e.target.value)
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Policy version"
                        htmlFor="policyVersion"
                      >
                        <input
                          id="policyVersion"
                          value={modelReleaseForm.policyVersion}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'policyVersion',
                              e.target.value,
                            )
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Policy decision"
                        htmlFor="policyDecision"
                      >
                        <select
                          id="policyDecision"
                          value={modelReleaseForm.policyDecision}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'policyDecision',
                              e.target.value,
                            )
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                          <option value="approved_with_exception">
                            Approved with exception
                          </option>
                          <option value="needs_more_review">
                            Needs more review
                          </option>
                        </select>
                      </ProjectField>
                      <ProjectField
                        label="Final approver"
                        htmlFor="finalApprover"
                      >
                        <input
                          id="finalApprover"
                          value={modelReleaseForm.finalApprover}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'finalApprover',
                              e.target.value,
                            )
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <ProjectField
                        label="Final approval time"
                        htmlFor="finalApprovalTimestamp"
                      >
                        <input
                          id="finalApprovalTimestamp"
                          type="datetime-local"
                          value={modelReleaseForm.finalApprovalTimestamp}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'finalApprovalTimestamp',
                              e.target.value,
                            )
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Disclosure mode"
                        htmlFor="disclosureMode"
                      >
                        <select
                          id="disclosureMode"
                          value={modelReleaseForm.disclosureMode}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'disclosureMode',
                              e.target.value,
                            )
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        >
                          <option value="public_receipt_public_evidence">
                            Public receipt, public evidence
                          </option>
                          <option value="public_receipt_private_evidence">
                            Public receipt, private evidence
                          </option>
                          <option value="private_receipt_private_evidence">
                            Private receipt, private evidence
                          </option>
                          <option value="auditor_only">Auditor only</option>
                          <option value="request_based">Request based</option>
                          <option value="internal_only">Internal only</option>
                        </select>
                      </ProjectField>
                      <ProjectField
                        label="Verification policy"
                        htmlFor="verificationPolicy"
                      >
                        <input
                          id="verificationPolicy"
                          value={modelReleaseForm.verificationPolicy}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'verificationPolicy',
                              e.target.value,
                            )
                          }
                          required
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <ProjectField
                        label="Retention period"
                        htmlFor="retentionPeriod"
                      >
                        <input
                          id="retentionPeriod"
                          value={modelReleaseForm.retentionPeriod}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'retentionPeriod',
                              e.target.value,
                            )
                          }
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                      <ProjectField
                        label="Known limitations"
                        htmlFor="knownLimitations"
                      >
                        <textarea
                          id="knownLimitations"
                          value={modelReleaseForm.knownLimitations}
                          onChange={(e) =>
                            updateModelReleaseField(
                              'knownLimitations',
                              e.target.value,
                            )
                          }
                          rows={2}
                          className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                        />
                      </ProjectField>
                    </div>

                    <div>
                      <div className="text-[12px] font-medium uppercase text-neutral-500">
                        Model release record SHA-256
                      </div>
                      <div className="mt-1 break-all font-mono text-[12px] text-neutral-700">
                        {modelReleaseHash || 'Computing...'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <ProjectField label="External SHA-256" htmlFor="externalHash">
                    <input
                      id="externalHash"
                      value={externalHash}
                      onChange={(e) =>
                        setExternalHash(e.target.value.trim().toLowerCase())
                      }
                      placeholder="64 lowercase hex characters"
                      className="w-full border border-[var(--color-border)] px-3 py-2 font-mono text-[13px] focus:border-neutral-700 focus:outline-none"
                    />
                  </ProjectField>
                )}

                <div className="border border-[var(--color-border)] bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-medium uppercase text-neutral-500">
                      Coverage preview
                    </div>
                    {hashing && (
                      <span className="text-[12px] text-neutral-500">
                        Hashing...
                      </span>
                    )}
                  </div>
                  <div className="mt-2 break-all font-mono text-[12px] text-neutral-700">
                    {hashMode === 'file' || hashMode === 'google_drive'
                      ? attestationFiles.length > 0
                        ? `${attestationFiles.length} file${
                            attestationFiles.length === 1 ? '' : 's'
                          } selected. Review file hashes, content proof, and source details below.`
                        : 'Select one or more files to compute SHA-256 and extract content proof when possible.'
                      : hashMode === 'model_release'
                        ? submittedHash ||
                          'Complete the model release fields to compute the canonical record hash.'
                        : submittedHash ||
                          'Paste a SHA-256 digest above. External hashes create whole-file coverage only.'}
                  </div>
                  {hashMode === 'external' &&
                    submittedHash &&
                    !HEX64.test(submittedHash) && (
                    <p className="mt-2 text-[12px] text-[#B91C1C]">
                      SHA-256 must be exactly 64 hexadecimal characters.
                    </p>
                  )}
                </div>

                {submissionProgress.visible && (
                  <SubmissionProgressBar
                    progress={submissionProgress}
                    summary={submissionBatchSummary}
                  />
                )}

                {(hashMode === 'file' || hashMode === 'google_drive') &&
                  attestationFiles.length > 0 && (
                  <div className="grid gap-2">
                    {attestationFiles.map((file) => (
                      <div
                        key={file.id}
                        className="grid gap-3 border border-[var(--color-border)] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-neutral-900">
                              {file.file.name}
                            </div>
                            <div className="mt-1 text-[12px] text-neutral-500">
                              {formatFileSize(file.file.size)}
                              {hashMode === 'google_drive'
                                ? ' · Google Drive source'
                                : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAttestationFile(file.id)}
                            className="border border-[var(--color-border)] px-2 py-1 text-[12px] hover:border-neutral-700"
                          >
                            Remove
                          </button>
                        </div>
                        <ProjectField label="Name" htmlFor={`label-${file.id}`}>
                          <input
                            id={`label-${file.id}`}
                            value={file.label}
                            onChange={(e) =>
                              updateAttestationFileLabel(file.id, e.target.value)
                            }
                            required
                            maxLength={128}
                            className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                          />
                          {file.label.trim() &&
                            !isValidAttestationName(file.label) && (
                            <p className="mt-1 text-[12px] text-[#B91C1C]">
                              {ATTESTATION_NAME_HELP}
                            </p>
                          )}
                        </ProjectField>
                        <div>
                          <div className="text-[12px] font-medium uppercase text-neutral-500">
                            SHA-256
                          </div>
                          <div className="mt-1 break-all font-mono text-[12px] text-neutral-700">
                            {file.error || file.hash || 'Hashing...'}
                          </div>
                        </div>
                        {file.contentProof && (
                          <div className="border border-[#15803D] bg-[#F0FDF4] p-3">
                            <div className="text-[12px] font-medium uppercase text-[#166534]/70">
                              Content proof
                            </div>
                            <dl className="mt-2 grid gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
                              <SuccessDetail
                                label="Extraction"
                                value={contentProofLabel(file.contentProof)}
                              />
                              <SuccessDetail
                                label="Preset"
                                value={file.contentProof.preset}
                              />
                              <SuccessDetail
                                label="Normalized tokens"
                                value={String(
                                  file.contentProof.normalizedTokenCount,
                                )}
                              />
                              <SuccessDetail
                                label="Text shingles"
                                value={String(file.contentProof.shingleCount)}
                              />
                              {file.contentProof.ocrSummary && (
                                <>
                                  <SuccessDetail
                                    label="OCR pages"
                                    value={String(
                                      file.contentProof.ocrSummary.ocrPageCount,
                                    )}
                                  />
                                  <SuccessDetail
                                    label="OCR confidence"
                                    value={
                                      file.contentProof.ocrSummary
                                        .meanConfidence === null
                                        ? 'Unknown'
                                        : `${file.contentProof.ocrSummary.meanConfidence}%`
                                    }
                                  />
                                  {file.contentProof.ocrSummary
                                    .lowConfidencePageCount > 0 && (
                                    <SuccessDetail
                                      label="Low confidence pages"
                                      value={String(
                                        file.contentProof.ocrSummary
                                          .lowConfidencePageCount,
                                      )}
                                    />
                                  )}
                                </>
                              )}
                            </dl>
                            <p className="mt-2 text-[12px] text-[#166534]">
                              This attestation will cover both the whole-file
                              SHA-256 and locally generated text-content hashes.
                            </p>
                          </div>
                        )}
                        {file.exactImageProof && (
                          <div className="border border-[#0F766E] bg-[#F0FDFA] p-3">
                            <div className="text-[12px] font-medium text-[#115E59]/80">
                              Exact image proof
                            </div>
                            <dl className="mt-2 grid gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
                              <SuccessDetail
                                label="Method"
                                value="Exact image SHA-256"
                              />
                              <SuccessDetail
                                label="Format"
                                value={imageMediaTypeLabel(
                                  file.exactImageProof.mediaType,
                                )}
                              />
                            </dl>
                            <p className="mt-2 text-[12px] text-[#115E59]">
                              This attestation will also commit an exact image
                              proof for PNG/JPEG byte-for-byte verification.
                            </p>
                          </div>
                        )}
                        {!file.contentProof && file.contentProofError && (
                          <p className="text-[12px] text-neutral-500">
                            {file.contentProofError}
                          </p>
                        )}
                        {file.result && (
                          <div
                            className={`border p-3 text-[13px] ${
                              file.result.ok
                                ? 'border-[#15803D] bg-[#F0FDF4] text-[#166534]'
                                : 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">
                                  {file.result.ok
                                    ? `Attestation status: ${file.result.state}`
                                    : 'Attestation failed'}
                                </div>
                                {!file.result.ok && (
                                  <div className="mt-1 opacity-80">
                                    {file.result.error}
                                  </div>
                                )}
                              </div>
                              {file.result.ok && (
                                <StatusPill state={file.result.state} />
                              )}
                            </div>
                            {file.result.ok && (
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <SuccessDetail
                                  label="Attestation id"
                                  value={file.result.attestationId}
                                />
                                <SuccessDetail
                                  label="Submitted SHA-256"
                                  value={file.result.submittedHash}
                                />
                                {file.result.shingleCount > 0 && (
                                  <SuccessDetail
                                    label="Content proof"
                                    value={`${file.result.shingleCount} text shingles`}
                                  />
                                )}
                                {file.result.componentCount > 0 && (
                                  <SuccessDetail
                                    label="Image proof"
                                    value={`${file.result.componentCount} exact image hash${
                                      file.result.componentCount === 1
                                        ? ''
                                        : 'es'
                                    }`}
                                  />
                                )}
                                <SuccessDetail
                                  label="Merkle root"
                                  value={file.result.merkleRoot}
                                  wide
                                />
                                {file.result.confirmedAt && (
                                  <SuccessDetail
                                    label="Confirmed"
                                    value={formatDate(file.result.confirmedAt)}
                                  />
                                )}
                              </div>
                            )}
                            {(() => {
                                  const result = file.result;
                                  if (
                                    !result?.ok ||
                                    result.state !== 'confirmed'
                                  ) {
                                    return null;
                                  }
                              return (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openAttestationDetail(result.attestationId)
                                  }
                                  className="mt-3 border border-[#15803D] px-3 py-2 text-[13px] font-medium hover:bg-[#DCFCE7]"
                                >
                                  View details
                                </button>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {(hashMode === 'file' || hashMode === 'google_drive') &&
                  attestationError && (
                  <p className="text-[13px] text-[#B91C1C]">
                    {attestationError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!canSubmitAttestation}
                  className="w-fit bg-neutral-900 px-4 py-2.5 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:opacity-60"
                >
                  {submittingAttestation
                    ? 'Submitting...'
                    : attestationSubmissionLocked
                      ? 'Submitted'
                      : 'Submit attestation'}
                </button>
              </div>
            </section>

            {(hashMode === 'external' || hashMode === 'model_release') && (
            <section className="border border-[var(--color-border)] p-5">
              <h2 className="text-[16px] font-medium">Results</h2>

              {attestationError && (
                <p className="mt-4 text-[13px] text-[#B91C1C]">
                  {attestationError}
                </p>
              )}

              {attestationResults.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {attestationResults.map((result) => (
                    <div
                      key={result.clientId}
                      className={`border p-4 text-[13px] ${
                        result.ok
                          ? 'border-[#15803D] bg-[#F0FDF4] text-[#166534]'
                          : 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{result.label}</div>
                          <div className="mt-1 opacity-80">
                            {result.ok
                              ? `Attestation status: ${result.state}`
                              : result.error}
                          </div>
                        </div>
                        {result.ok && <StatusPill state={result.state} />}
                      </div>
                      {result.ok && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <SuccessDetail
                            label="Attestation id"
                            value={result.attestationId}
                          />
                          <SuccessDetail
                            label="Submitted SHA-256"
                            value={result.submittedHash}
                          />
                          {result.shingleCount > 0 && (
                            <SuccessDetail
                              label="Content proof"
                              value={`${result.shingleCount} text shingles`}
                            />
                          )}
                            <SuccessDetail
                              label="Merkle root"
                              value={result.merkleRoot}
                              wide
                            />
                            {result.confirmedAt && (
                              <SuccessDetail
                                label="Confirmed"
                                value={formatDate(result.confirmedAt)}
                              />
                            )}
                          </div>
                      )}
                      {result.ok && result.state === 'confirmed' && (
                        <button
                          type="button"
                          onClick={() => openAttestationDetail(result.attestationId)}
                          className="mt-3 border border-[#15803D] px-3 py-2 text-[13px] font-medium hover:bg-[#DCFCE7]"
                        >
                          View details
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : !attestationError ? (
                <p className="mt-4 text-[13px] text-neutral-500">
                  Submission results will appear here.
                </p>
              ) : null}
            </section>
            )}
              </form>
              )}

              <section className="grid gap-6">
              {attestationViewMode === 'list' && (
            <div className="border border-[var(--color-border)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-medium">Attestations</h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    {attestationProject
                      ? attestationProject.name
                      : `Select a ${projectNounLower} above`}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetNewAttestationForm();
                      setAttestationViewMode('new');
                    }}
                    disabled={!hasProjects}
                    className="bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  >
                    New attestation
                  </button>
                </div>
              </div>

              {attestations.isLoading ? (
                <LoadingState label="Loading attestations..." />
              ) : attestations.isError ? (
                <ErrorState
                  message={errorMessage(
                    attestations.error,
                    'Could not load attestations.',
                  )}
                  onRetry={() => void attestations.refetch()}
                />
              ) : attestations.data ? (
                <div className="mt-5">
                  <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_180px]">
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Search
                      <input
                        type="search"
                        value={attestationSearch}
                        onChange={(e) => setAttestationSearch(e.target.value)}
                        placeholder="Label, id, or status"
                        className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    </label>
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      {projectNoun}
                      <select
                        value={attestationProjectSlug}
                        onChange={(e) => {
                          setAttestationProjectSlug(e.target.value);
                          setSelectedAttestationId('');
                          setAttestationViewMode('list');
                          setReceiptMessage(null);
                          setReceiptJson(null);
                          setVerifierLinkMessage(null);
                        }}
                        disabled={!activeProjects.length}
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none disabled:bg-neutral-50"
                      >
                        {activeProjects.map((project) => (
                          <option key={project.id} value={project.slug}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[13px] text-neutral-600">
                      Status
                      <select
                        value={attestationStatusFilter}
                        onChange={(e) =>
                          setAttestationStatusFilter(
                            e.target.value as AttestationStatusFilter,
                          )
                        }
                        className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      >
                        <option value="all">All</option>
                        <option value="active">Active</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="failed">Failed</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 border border-[var(--color-border)]">
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-neutral-50 px-3 py-2">
                      <div className="text-[12px] font-medium uppercase text-neutral-500">
                        Attestation records
                      </div>
                      <button
                        type="button"
                        onClick={() => void attestations.refetch()}
                        disabled={attestations.isFetching}
                        aria-label="Refresh attestations"
                        title="Refresh attestations"
                        className="grid h-8 w-8 place-items-center border border-[var(--color-border)] bg-white text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left text-[13px]"
                        style={{
                          minWidth:
                            Object.values(attestationColumnWidths).reduce(
                              (sum, width) => sum + width,
                              0,
                            ) + 1,
                        }}
                      >
                        <colgroup>
                          <col style={{ width: attestationColumnWidths.label }} />
                          <col
                            style={{ width: attestationColumnWidths.project }}
                          />
                          <col
                            style={{ width: attestationColumnWidths.createdAt }}
                          />
                          <col
                            style={{
                              width: attestationColumnWidths.confirmedAt,
                            }}
                          />
                          <col style={{ width: attestationColumnWidths.state }} />
                        </colgroup>
                        <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                          <tr>
                            <AttestationTableHeader
                              label="Label"
                              columnKey="label"
                              sortKey="label"
                              sort={attestationSort}
                              onSort={sortAttestationsBy}
                              onResize={resizeAttestationColumn}
                            />
                            <ResizableTableHeader
                              label={projectNoun}
                              columnKey="project"
                              onResize={resizeAttestationColumn}
                            />
                            <AttestationTableHeader
                              label="Created"
                              columnKey="createdAt"
                              sortKey="createdAt"
                              sort={attestationSort}
                              onSort={sortAttestationsBy}
                              onResize={resizeAttestationColumn}
                            />
                            <AttestationTableHeader
                              label="Confirmed"
                              columnKey="confirmedAt"
                              sortKey="confirmedAt"
                              sort={attestationSort}
                              onSort={sortAttestationsBy}
                              onResize={resizeAttestationColumn}
                            />
                            <AttestationTableHeader
                              label="Status"
                              columnKey="state"
                              sortKey="state"
                              sort={attestationSort}
                              onSort={sortAttestationsBy}
                              onResize={resizeAttestationColumn}
                              align="right"
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {pagedAttestations.map((attestation) => {
                            const batch = parseBatchDescription(
                              attestation.description,
                            );
                            return (
                              <tr
                                key={attestation.id}
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  openAttestationDetail(attestation.id)
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === 'Enter' ||
                                    event.key === ' '
                                  ) {
                                    event.preventDefault();
                                    openAttestationDetail(attestation.id);
                                  }
                                }}
                                className={`cursor-pointer border-t border-[var(--color-border)] hover:bg-neutral-50 ${
                                  selectedAttestationId === attestation.id
                                    ? 'bg-neutral-50'
                                    : ''
                                }`}
                              >
                                <td className="px-3 py-3 align-top">
                                  <div className="font-medium text-neutral-900">
                                    {attestation.label}
                                  </div>
                                  {batch && (
                                    <div className="mt-1 inline-flex max-w-full items-center gap-1.5 border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[11px] text-neutral-600">
                                      <span className="truncate">
                                        Batch: {batch.name}
                                      </span>
                                      <span className="shrink-0 font-mono">
                                        {batch.index}/{batch.total}
                                      </span>
                                    </div>
                                  )}
                                  <div className="mt-1 break-all font-mono text-[12px] text-neutral-500">
                                    {attestation.id}
                                  </div>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <div className="font-medium text-neutral-800">
                                    {attestation.projectName}
                                  </div>
                                </td>
                                <td className="px-3 py-3 align-top text-neutral-600">
                                  {formatDate(attestation.createdAt)}
                                </td>
                                <td className="px-3 py-3 align-top text-neutral-600">
                                  {attestation.confirmedAt
                                    ? formatDate(attestation.confirmedAt)
                                    : 'Pending'}
                                </td>
                                <td className="px-3 py-3 text-right align-top">
                                  <StatusPill state={attestation.state} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {pagedAttestations.length === 0 && (
                      <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                        {attestations.data.length === 0
                          ? `No attestations for this ${projectNounLower} yet.`
                          : 'No attestations match the current filters.'}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-neutral-600">
                    <div>
                      Showing {pagedAttestations.length} of{' '}
                      {visibleAttestations.length} matching attestations
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setAttestationPage((page) => Math.max(1, page - 1))
                        }
                        disabled={activeAttestationPage <= 1}
                        className="border border-[var(--color-border)] px-3 py-1.5 hover:border-neutral-700 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span>
                        Page {activeAttestationPage} of {attestationPageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttestationPage((page) =>
                            Math.min(attestationPageCount, page + 1),
                          )
                        }
                        disabled={activeAttestationPage >= attestationPageCount}
                        className="border border-[var(--color-border)] px-3 py-1.5 hover:border-neutral-700 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={`No attestations for this ${projectNounLower}`}
                  body="Create a new attestation when you are ready to submit a file hash."
                />
              )}
            </div>
              )}

              {attestationViewMode === 'detail' && (
            <div className="border border-[var(--color-border)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-medium">
                    {selectedAttestation.data?.attestation.label ??
                      'Attestation record'}
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    Full record with receipt proof, verifier access, attempts,
                    and events for this attestation.
                  </p>
                </div>
                <div className="grid justify-items-end gap-2">
                  {selectedAttestation.data && (
                    <StatusPill
                      state={
                        selectedAttestationState ??
                        selectedAttestation.data.attestation.state
                      }
                    />
                  )}
                  {selectedAttestationId && (
                    <button
                      type="button"
                      onClick={() => void refreshAttestationStatus()}
                      disabled={
                        selectedAttestation.isFetching ||
                        attestations.isFetching ||
                        recentAttestations.isFetching
                      }
                      aria-label="Refresh attestation status"
                      title="Refresh attestation status"
                      className="grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                    >
                      <RefreshIcon />
                    </button>
                  )}
                </div>
              </div>
              {selectedAttestation.isLoading ? (
                <LoadingState label="Loading attestation status..." />
              ) : selectedAttestation.isError ? (
                <ErrorState
                  message={errorMessage(
                    selectedAttestation.error,
                    'Could not load attestation.',
                  )}
                  onRetry={() => void selectedAttestation.refetch()}
                />
              ) : selectedAttestation.data ? (
                <div className="mt-5 grid gap-4 text-[13px]">
                  <section className="grid gap-3 border-b border-[var(--color-border)] pb-4">
                    <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-3 text-[13px]">
                      <CompactFact
                        label="Status"
                        value={
                          selectedAttestationState ??
                          selectedAttestation.data.attestation.state
                        }
                      />
                      <CompactFact
                        label="Receipt"
                        value={
                          selectedAttestation.data.attestation.receiptAvailable
                            ? 'Available'
                            : 'Pending'
                        }
                      />
                      <CompactFact
                        label="Access grants"
                        value={
                          accessGrants.isLoading
                            ? 'Loading'
                            : String(accessGrants.data?.length ?? 0)
                        }
                      />
                      <CompactFact
                        label="Coverage"
                        value={coverageLabel(
                          selectedAttestation.data.attestation.coverageType,
                        )}
                      />
                      <CompactFact
                        label="Source"
                        value={attestationSourceLabel(
                          primaryAttestationSource(
                            selectedAttestation.data.attempts,
                          ),
                        )}
                      />
                      <CompactFact
                        label="Content proof"
                        value={contentProofAvailabilityLabel(
                          selectedAttestation.data.attestation.coverageType,
                          selectedAttestation.data.attestation
                            .extractionMethods,
                        )}
                      />
                      <CompactFact
                        label="Confirmed"
                        value={
                          selectedAttestation.data.attestation.confirmedAt
                            ? formatDate(
                                selectedAttestation.data.attestation.confirmedAt,
                              )
                            : 'Pending'
                        }
                      />
                      <CompactFact
                        label="Events"
                        value={String(selectedAttestationAuditEvents.length)}
                      />
                      <CompactFact
                        label="Attempts"
                        value={String(selectedAttestation.data.attempts.length)}
                      />
                    </dl>
                  </section>

                  <div
                    className="flex overflow-x-auto border-b border-[var(--color-border)]"
                    role="tablist"
                    aria-label="Attestation detail sections"
                  >
                    <AttestationDetailTabButton
                      label="Records"
                      help={labelHelp('Records')}
                      active={attestationDetailTab === 'records'}
                      onClick={() => setAttestationDetailTab('records')}
                    >
                      Records
                    </AttestationDetailTabButton>
                    <AttestationDetailTabButton
                      label="Verifications"
                      help={labelHelp('Verifications')}
                      active={attestationDetailTab === 'verifications'}
                      onClick={() => setAttestationDetailTab('verifications')}
                    >
                      Verifications
                    </AttestationDetailTabButton>
                    <AttestationDetailTabButton
                      label="Events"
                      help={labelHelp('Events')}
                      active={attestationDetailTab === 'events'}
                      onClick={() => setAttestationDetailTab('events')}
                    >
                      Events
                    </AttestationDetailTabButton>
                  </div>

                  {attestationDetailTab === 'records' && (
                    <section
                      className="border border-[var(--color-border)] bg-white p-4"
                      role="tabpanel"
                      aria-label={labelHelp('Records')}
                    >
                    <div className="grid gap-3">
                      {selectedAttestation.data.attestation
                        .receiptAvailable && (
                        <div className="border-b border-[var(--color-border)] pb-3">
                          <HelpLabel
                            label="Receipt bundle"
                            className="mb-2 text-[11px] font-medium text-neutral-500"
                          />
                          <div className="border-y border-[var(--color-border)]">
                            {receiptPdfUrl ? (
                              <ReceiptLinkRow
                                label="PDF"
                                href={receiptPdfUrl}
                                onCopy={() => void copyReceiptPdfLink()}
                              />
                            ) : (
                              <ReceiptPendingRow
                                label="PDF"
                                value={
                                  resolvingReceiptBundle
                                    ? 'Resolving receipt PDF...'
                                    : 'Receipt PDF pending'
                                }
                              />
                            )}
                          </div>
                          {receiptLinkMessage && (
                            <p className="mt-2 text-[12px] text-neutral-600">
                              {receiptLinkMessage}
                            </p>
                          )}
                          <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                            <HelpLabel
                              label="Technical receipt data"
                              className="text-[13px] font-medium text-neutral-700"
                            />
                            <div className="mt-3 grid gap-2">
                              <details
                                className="group border border-[var(--color-border)] bg-neutral-50"
                                onToggle={(event) => {
                                  if (
                                    event.currentTarget.open &&
                                    !receiptSummary &&
                                    !receiptJson &&
                                    !checkingReceipt &&
                                    selectedAttestation.data.attestation
                                      .receiptAvailable
                                  ) {
                                    void loadReceipt();
                                  }
                                }}
                              >
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
                                  <span>
                                    <HelpLabel
                                      label="Receipt evidence summary"
                                      className="block text-[13px] font-medium"
                                    />
                                    <span className="mt-0.5 block text-[12px] text-neutral-500">
                                      Package, Merkle root, manifest hash, and
                                      producer device signature.
                                    </span>
                                  </span>
                                  <span
                                    className="text-[12px] font-medium text-neutral-500 group-open:hidden"
                                    title="Show receipt evidence summary"
                                  >
                                    Expand
                                  </span>
                                  <span
                                    className="hidden text-[12px] font-medium text-neutral-500 group-open:inline"
                                    title="Hide receipt evidence summary"
                                  >
                                    Collapse
                                  </span>
                                </summary>
                                <div className="grid gap-3 border-t border-[var(--color-border)] p-3">
                                  {checkingReceipt && (
                                    <p className="text-[13px] text-neutral-600">
                                      Loading receipt data...
                                    </p>
                                  )}
                                  {!checkingReceipt && receiptMessage && (
                                    <p className="text-[13px] text-neutral-600">
                                      {receiptMessage}
                                    </p>
                                  )}
                                  {!checkingReceipt && receiptSummary && (
                                    <>
                                      <DetailRow
                                        label="Receipt package"
                                        value={receiptSummary.package_id}
                                      />
                                      <DetailRow
                                        label="Receipt Merkle root"
                                        value={receiptSummary.merkle_root}
                                      />
                                      <DetailRow
                                        label="Manifest SHA-256"
                                        value={
                                          receiptSummary.manifest_canonical_sha256
                                        }
                                      />
                                      <DetailRow
                                        label="Receipt confirmed"
                                        value={formatDateTime(
                                          receiptSummary.confirmed_at,
                                        )}
                                      />
                                      <DetailRow
                                        label="Receipt issued"
                                        value={formatDateTime(
                                          receiptSummary.issued_at,
                                        )}
                                      />
                                      {receiptSummary.device_signature && (
                                        <DetailRow
                                          label="Device signature"
                                          value={`${receiptSummary.device_signature.algorithm} · key ${receiptSummary.device_signature.key_id} · ${
                                            receiptSummary.device_signature
                                              .verified
                                              ? 'verified'
                                              : 'not verified'
                                          }`}
                                        />
                                      )}
                                    </>
                                  )}
                                  {!checkingReceipt &&
                                    !receiptSummary &&
                                    !receiptMessage && (
                                      <p className="text-[13px] text-neutral-600">
                                        Receipt evidence is not available yet.
                                      </p>
                                    )}
                                </div>
                              </details>
                              <details
                                className="group border border-[var(--color-border)] bg-neutral-50"
                                onToggle={(event) => {
                                  if (
                                    event.currentTarget.open &&
                                    !receiptSummary &&
                                    !receiptJson &&
                                    !checkingReceipt &&
                                    selectedAttestation.data.attestation
                                      .receiptAvailable
                                  ) {
                                    void loadReceipt();
                                  }
                                }}
                              >
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
                                  <span>
                                    <HelpLabel
                                      label="Receipt JSON"
                                      className="block text-[13px] font-medium"
                                    />
                                    <span className="mt-0.5 block text-[12px] text-neutral-500">
                                      Full receipt payload for inspection or
                                      download.
                                    </span>
                                  </span>
                                  <span
                                    className="text-[12px] font-medium text-neutral-500 group-open:hidden"
                                    title="Show receipt JSON"
                                  >
                                    Expand
                                  </span>
                                  <span
                                    className="hidden text-[12px] font-medium text-neutral-500 group-open:inline"
                                    title="Hide receipt JSON"
                                  >
                                    Collapse
                                  </span>
                                </summary>
                                <div className="grid gap-3 border-t border-[var(--color-border)] p-3">
                                  {checkingReceipt && (
                                    <p className="text-[13px] text-neutral-600">
                                      Loading receipt JSON...
                                    </p>
                                  )}
                                  {!checkingReceipt && receiptMessage && (
                                    <p className="text-[13px] text-neutral-600">
                                      {receiptMessage}
                                    </p>
                                  )}
                                  {!checkingReceipt && receiptJson && (
                                    <>
                                      <div className="flex justify-end">
                                        <button
                                          type="button"
                                          onClick={downloadReceiptJson}
                                          title={labelHelp('Download JSON')}
                                          aria-label={labelHelp(
                                            'Download JSON',
                                          )}
                                          className="border border-[var(--color-border)] bg-white px-2 py-1 text-[12px] hover:border-neutral-700"
                                        >
                                          Download JSON
                                        </button>
                                      </div>
                                      <pre className="max-h-56 overflow-auto border border-[var(--color-border)] bg-white p-3 text-[11px] leading-5 text-neutral-700">
                                        {receiptJson}
                                      </pre>
                                    </>
                                  )}
                                  {!checkingReceipt &&
                                    !receiptJson &&
                                    !receiptMessage && (
                                      <p className="text-[13px] text-neutral-600">
                                        Receipt JSON is not available yet.
                                      </p>
                                    )}
                                </div>
                              </details>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <HelpLabel
                          label="State"
                          className="text-neutral-500"
                        />
                        <div className="flex items-center gap-2">
                          {isActiveAttestationState(
                            selectedAttestationState ??
                              selectedAttestation.data.attestation.state,
                          ) && (
                            <span
                              className="text-[12px] text-neutral-500"
                              title={labelHelp('Auto-refreshing')}
                            >
                              Auto-refreshing
                            </span>
                          )}
                          <span className="font-mono text-[12px]">
                            {selectedAttestationState ??
                              selectedAttestation.data.attestation.state}
                          </span>
                        </div>
                      </div>
                      <DetailRow
                        label="Attestation id"
                        value={selectedAttestation.data.attestation.id}
                      />
                      <DetailRow
                        label="Created"
                        value={formatDate(
                          selectedAttestation.data.attestation.createdAt,
                        )}
                      />
                      <DetailRow
                        label="Merkle root"
                        value={selectedAttestation.data.attestation.merkleRoot}
                      />
                      <DetailRow
                        label="Package id"
                        value={selectedAttestation.data.attestation.packageId}
                      />
                      <DetailRow
                        label="Source"
                        value={attestationSourceLabel(
                          primaryAttestationSource(
                            selectedAttestation.data.attempts,
                          ),
                        )}
                      />
                      <details
                        className="group border-t border-[var(--color-border)] pt-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:hidden">
                          <span>
                            <HelpLabel
                              label="Attempts"
                              className="block text-[13px] font-medium text-neutral-700"
                            />
                            <span className="mt-0.5 block text-[12px] text-neutral-500">
                              {attemptRollupLabel(
                                selectedAttestation.data.attempts,
                              )}
                            </span>
                          </span>
                          <span
                            className="text-[12px] text-neutral-500 group-open:hidden"
                            title="Show attempt details"
                          >
                            Open
                          </span>
                          <span
                            className="hidden text-[12px] text-neutral-500 group-open:inline"
                            title="Hide attempt details"
                          >
                            Hide
                          </span>
                        </summary>
                        <div className="mt-3 grid gap-2">
                          {selectedAttestation.data.attempts.map((attempt) => (
                            <div
                              key={attempt.id}
                              className="border border-[var(--color-border)] p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <CopyableValue
                                    value={attempt.id}
                                    label="Attempt id"
                                  />
                                  {attempt.isConfirmed && (
                                    <p className="mt-1 text-[12px] text-[#166534]">
                                      Confirmed attempt
                                    </p>
                                  )}
                                </div>
                                <StatusPill state={attempt.state} />
                              </div>
                              <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-[12px]">
                                <dt
                                  className="text-neutral-500"
                                  title={labelHelp('Created')}
                                >
                                  Created
                                </dt>
                                <dd>{formatDateTime(attempt.createdAt)}</dd>
                                <dt
                                  className="text-neutral-500"
                                  title={labelHelp('Uploaded')}
                                >
                                  Uploaded
                                </dt>
                                <dd>
                                  {attempt.uploadedAt
                                    ? formatDateTime(attempt.uploadedAt)
                                    : 'Not uploaded'}
                                </dd>
                                <dt
                                  className="text-neutral-500"
                                  title={labelHelp('Validated')}
                                >
                                  Validated
                                </dt>
                                <dd>
                                  {attempt.validatedAt
                                    ? formatDateTime(attempt.validatedAt)
                                    : 'Not validated'}
                                </dd>
                                {attempt.failedAt && (
                                  <>
                                    <dt
                                      className="text-neutral-500"
                                      title={labelHelp('Failed')}
                                    >
                                      Failed
                                    </dt>
                                    <dd>{formatDateTime(attempt.failedAt)}</dd>
                                  </>
                                )}
                                {attempt.sourceMetadata && (
                                  <>
                                    <dt
                                      className="text-neutral-500"
                                      title={labelHelp('Source')}
                                    >
                                      Source
                                    </dt>
                                    <dd>
                                      {attestationSourceLabel(
                                        attempt.sourceMetadata,
                                      )}
                                    </dd>
                                  </>
                                )}
                              </dl>
                              {attempt.sourceMetadata?.provider ===
                                'google_drive' && (
                                <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-3 text-[12px]">
                                  <dt
                                    className="text-neutral-500"
                                    title={labelHelp('Drive file')}
                                  >
                                    Drive file
                                  </dt>
                                  <dd>{attempt.sourceMetadata.fileName}</dd>
                                  <dt
                                    className="text-neutral-500"
                                    title={labelHelp('Google account')}
                                  >
                                    Account
                                  </dt>
                                  <dd>
                                    {attempt.sourceMetadata
                                      .googleAccountEmail ?? 'Not recorded'}
                                  </dd>
                                  <dt
                                    className="text-neutral-500"
                                    title={labelHelp('Drive file id')}
                                  >
                                    File id
                                  </dt>
                                  <dd>
                                    <CopyableValue
                                      value={attempt.sourceMetadata.fileId}
                                      label="Drive file id"
                                    />
                                  </dd>
                                </dl>
                              )}
                              {attempt.sourceMetadata?.provider ===
                                'model_release' && (
                                <dl className="mt-3 grid grid-cols-[128px_1fr] gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-3 text-[12px]">
                                  <dt className="text-neutral-500">Model</dt>
                                  <dd>
                                    {attempt.sourceMetadata.modelName}{' '}
                                    {attempt.sourceMetadata.modelVersion}
                                  </dd>
                                  <dt className="text-neutral-500">
                                    Claim type
                                  </dt>
                                  <dd>{attempt.sourceMetadata.claimType}</dd>
                                  <dt className="text-neutral-500">
                                    Policy
                                  </dt>
                                  <dd>
                                    {attempt.sourceMetadata.policyId} @{' '}
                                    {attempt.sourceMetadata.policyVersion}
                                  </dd>
                                  <dt className="text-neutral-500">
                                    Decision
                                  </dt>
                                  <dd>{attempt.sourceMetadata.policyDecision}</dd>
                                  <dt className="text-neutral-500">
                                    Record hash
                                  </dt>
                                  <dd>
                                    <CopyableValue
                                      value={attempt.sourceMetadata.canonicalHash}
                                      label="Model release record hash"
                                    />
                                  </dd>
                                  <dt className="text-neutral-500">
                                    Subject hash
                                  </dt>
                                  <dd>
                                    <CopyableValue
                                      value={attempt.sourceMetadata.subjectHash}
                                      label="Model release subject hash"
                                    />
                                  </dd>
                                </dl>
                              )}
                              {attempt.validationError && (
                                <p className="mt-2 text-[#B91C1C]">
                                  {attempt.validationError}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                      <DetailRow
                        label="Coverage"
                        value={coverageLabel(
                          selectedAttestation.data.attestation.coverageType,
                        )}
                      />
                      <DetailRow
                        label="Content proof"
                        value={contentProofSummary(
                          selectedAttestation.data.attestation.coverageType,
                          selectedAttestation.data.attestation
                            .extractionMethods,
                          selectedAttestation.data.attestation
                            .shinglingPresets,
                        )}
                      />
                      <DetailRow
                        label="Shingling presets"
                        value={
                          selectedAttestation.data.attestation.shinglingPresets
                            .length > 0
                            ? selectedAttestation.data.attestation.shinglingPresets
                                .map(formatCoverageToken)
                                .join(', ')
                            : 'None'
                        }
                      />
                      <DetailRow
                        label="Extraction methods"
                        value={
                          selectedAttestation.data.attestation.extractionMethods
                            .length > 0
                            ? selectedAttestation.data.attestation.extractionMethods
                                .map(formatCoverageToken)
                                .join(', ')
                            : 'None'
                        }
                      />
                    </div>
                    </section>
                  )}

                  {attestationDetailTab === 'verifications' && (
                    <section
                      className="border border-[var(--color-border)] bg-white p-4"
                      role="tabpanel"
                      aria-label={labelHelp('Verifications')}
                    >
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-[14px] font-medium">
                            Verifier access
                          </h3>
                          <p className="mt-1 text-[12px] text-neutral-500">
                            Manage who can use this attestation's private verifier lookup.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={toggleVerifierForm}
                          className="bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white"
                        >
                          {verifierFormOpen ? 'Close form' : 'New verifier'}
                        </button>
                      </div>
                      {verifierFormOpen && (
                        <form
                          onSubmit={createAccessGrant}
                          className="grid gap-3 border border-[var(--color-border)] bg-neutral-50 p-3"
                        >
                          <ProjectField label="Verifier email" htmlFor="grantEmail">
                            <input
                              id="grantEmail"
                              type="email"
                              value={grantEmail}
                              onChange={(e) => {
                                const email = e.target.value;
                                setGrantEmail(email);
                                if (!grantNoteEdited) {
                                  setGrantNote(
                                    buildVerifierGrantMessage(email),
                                  );
                                }
                              }}
                              placeholder="verifier@example.com"
                              required
                              title={labelHelp('Verifier email')}
                              className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                            />
                          </ProjectField>
                          <ProjectField label="Message" htmlFor="grantNote">
                            <textarea
                              id="grantNote"
                              value={grantNote}
                              onChange={(e) => {
                                setGrantNote(e.target.value);
                                setGrantNoteEdited(true);
                              }}
                              rows={8}
                              maxLength={1000}
                              placeholder="Message sent with the verifier access notification."
                              className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                            />
                          </ProjectField>
                          <button
                            type="submit"
                            disabled={grantingAccess}
                            title={labelHelp('Grant access')}
                            className="w-fit border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] hover:border-neutral-700 disabled:opacity-50"
                          >
                            {grantingAccess ? 'Granting...' : 'Grant access'}
                          </button>
                        </form>
                      )}
                      {verifierLookupUrl && (
                        <div className="border-y border-[var(--color-border)]">
                          <ReceiptLinkRow
                            label="Private verifier lookup"
                            href={verifierLookupUrl}
                            onCopy={() => void copyVerifierLookupLink()}
                          />
                        </div>
                      )}
                      {verifierLinkMessage && (
                        <p className="text-[12px] text-neutral-600">
                          {verifierLinkMessage}
                        </p>
                      )}
                      {accessGrants.isLoading ? (
                        <LoadingState label="Loading access grants..." compact />
                      ) : accessGrants.isError ? (
                        <ErrorState
                          message={errorMessage(
                            accessGrants.error,
                            'Could not load access grants.',
                          )}
                          onRetry={() => void accessGrants.refetch()}
                          compact
                        />
                      ) : accessGrants.data && accessGrants.data.length > 0 ? (
                        <>
                          <div className="grid grid-cols-[minmax(160px,260px)_160px] gap-3">
                            <label
                              htmlFor="verifierSearch"
                              className="grid gap-1 text-[13px] text-neutral-600"
                            >
                              Search
                              <input
                                id="verifierSearch"
                                value={verifierSearch}
                                onChange={(e) => {
                                  setVerifierSearch(e.target.value);
                                  setVerifierPage(1);
                                }}
                                placeholder="Email..."
                                className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                              />
                            </label>
                            <label
                              htmlFor="verifierStatusFilter"
                              className="grid gap-1 text-[13px] text-neutral-600"
                            >
                              Status
                              <select
                                id="verifierStatusFilter"
                                value={verifierStatusFilter}
                                onChange={(e) => {
                                  setVerifierStatusFilter(
                                    e.target.value as VerifierStatusFilter,
                                  );
                                  setVerifierPage(1);
                                }}
                                className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                              >
                                <option value="all">All</option>
                                <option value="claimed">Claimed</option>
                                <option value="pending">Pending</option>
                              </select>
                            </label>
                          </div>
                          <div className="border border-[var(--color-border)]">
                            <div className="border-b border-[var(--color-border)] bg-neutral-50 px-3 py-2 text-[12px] font-medium uppercase text-neutral-500">
                              Verifier records
                            </div>
                            <div className="overflow-x-auto">
                              <table
                                className="w-full border-collapse text-left text-[13px]"
                                style={{
                                  minWidth:
                                    Object.values(verifierColumnWidths).reduce(
                                      (sum, width) => sum + width,
                                      0,
                                    ) + 1,
                                }}
                              >
                                <colgroup>
                                  <col style={{ width: verifierColumnWidths.email }} />
                                  <col style={{ width: verifierColumnWidths.status }} />
                                  <col style={{ width: verifierColumnWidths.createdAt }} />
                                  <col style={{ width: verifierColumnWidths.actions }} />
                                </colgroup>
                                <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                                  <tr>
                                    <StandardSortableTableHeader
                                      label="Verifier"
                                      columnKey="email"
                                      sortKey="email"
                                      sort={verifierSort}
                                      onSort={sortVerifiersBy}
                                      onResize={resizeVerifierColumn}
                                    />
                                    <StandardSortableTableHeader
                                      label="Status"
                                      columnKey="status"
                                      sortKey="status"
                                      sort={verifierSort}
                                      onSort={sortVerifiersBy}
                                      onResize={resizeVerifierColumn}
                                    />
                                    <StandardSortableTableHeader
                                      label="Granted"
                                      columnKey="createdAt"
                                      sortKey="createdAt"
                                      sort={verifierSort}
                                      onSort={sortVerifiersBy}
                                      onResize={resizeVerifierColumn}
                                    />
                                    <StandardResizableTableHeader
                                      label="Actions"
                                      columnKey="actions"
                                      onResize={resizeVerifierColumn}
                                      align="right"
                                    />
                                  </tr>
                                </thead>
                                <tbody>
                                  {pagedAccessGrants.map((grant) => (
                                    <tr
                                      key={grant.id}
                                      className="border-t border-[var(--color-border)] align-top hover:bg-neutral-50"
                                    >
                                      <td className="break-all px-3 py-3 font-mono text-[12px]">
                                        {grant.grantedToEmail}
                                      </td>
                                      <td className="px-3 py-3">
                                        <StatusPill
                                          state={grant.pending ? 'pending' : 'claimed'}
                                        />
                                      </td>
                                      <td className="px-3 py-3 text-neutral-600">
                                        {formatDate(grant.createdAt)}
                                      </td>
                                      <td className="px-3 py-3 text-right">
                                        <button
                                          type="button"
                                          onClick={() => void revokeAccessGrant(grant.id)}
                                          disabled={Boolean(revokingGrantId)}
                                          title={labelHelp('Revoke')}
                                          className="inline-grid h-8 w-8 place-items-center border border-[var(--color-border)] text-neutral-700 hover:border-neutral-700 disabled:opacity-50"
                                          aria-label={`Revoke ${grant.grantedToEmail}`}
                                        >
                                          <RevokeIcon />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {pagedAccessGrants.length === 0 && (
                              <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                                No verifiers match the current filters.
                              </div>
                            )}
                          </div>
                          <TablePager
                            count={pagedAccessGrants.length}
                            total={visibleAccessGrants.length}
                            noun="verifiers"
                            page={activeVerifierPage}
                            pageCount={verifierPageCount}
                            onPrevious={() =>
                              setVerifierPage((page) => Math.max(1, page - 1))
                            }
                            onNext={() =>
                              setVerifierPage((page) =>
                                Math.min(verifierPageCount, page + 1),
                              )
                            }
                          />
                        </>
                      ) : (
                        <EmptyState
                          title="No active grants"
                          body="Grant access when an external verifier needs to check this attestation."
                          actionLabel="New verifier"
                          onAction={() => setVerifierFormOpen(true)}
                          compact
                        />
                      )}
                      {grantMessage && (
                        <p className="text-[13px] text-neutral-600">
                          {grantMessage}
                        </p>
                      )}
                    </div>
                    </section>
                  )}

                  {attestationDetailTab === 'events' && (
                    <section
                      className="border border-[var(--color-border)] bg-white p-4"
                      role="tabpanel"
                      aria-label={labelHelp('Events')}
                    >
                    <div className="mb-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void audit.refetch()}
                        disabled={audit.isFetching}
                        className="inline-flex h-8 w-8 items-center justify-center border border-[var(--color-border)] hover:border-neutral-700 disabled:opacity-50"
                        aria-label="Refresh events"
                        title="Refresh events"
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                    {audit.isLoading ? (
                      <LoadingState label="Loading events..." compact />
                    ) : audit.isError ? (
                      <ErrorState
                        message={errorMessage(
                          audit.error,
                          'Could not load events.',
                        )}
                        onRetry={() => void audit.refetch()}
                        compact
                      />
                    ) : selectedAttestationAuditEvents.length > 0 ? (
                      <>
                        <div className="grid grid-cols-[minmax(180px,1fr)_180px] gap-3">
                          <label className="grid gap-1 text-[13px] text-neutral-600">
                            Search
                            <input
                              value={detailEventSearch}
                              onChange={(e) => {
                                setDetailEventSearch(e.target.value);
                                setDetailEventPage(1);
                              }}
                              placeholder="Action, actor, target..."
                              className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                            />
                          </label>
                          <label className="grid gap-1 text-[13px] text-neutral-600">
                            Category
                            <select
                              value={detailEventCategoryFilter}
                              onChange={(e) => {
                                setDetailEventCategoryFilter(e.target.value);
                                setDetailEventPage(1);
                              }}
                              className="w-full border border-[var(--color-border)] bg-white px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                            >
                              <option value="all">All</option>
                              {detailEventCategories.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="mt-4 border border-[var(--color-border)]">
                          <div className="border-b border-[var(--color-border)] bg-neutral-50 px-3 py-2 text-[12px] font-medium uppercase text-neutral-500">
                            Attestation events
                          </div>
                          <div className="overflow-x-auto">
                            <table
                              className="w-full border-collapse text-left text-[13px]"
                              style={{
                                minWidth:
                                  Object.values(eventColumnWidths).reduce(
                                    (sum, width) => sum + width,
                                    0,
                                  ) + 1,
                              }}
                            >
                              <colgroup>
                                <col style={{ width: eventColumnWidths.action }} />
                                <col style={{ width: eventColumnWidths.category }} />
                                <col style={{ width: eventColumnWidths.actor }} />
                                <col style={{ width: eventColumnWidths.createdAt }} />
                                <col style={{ width: eventColumnWidths.target }} />
                              </colgroup>
                              <thead className="bg-neutral-50 text-[12px] uppercase text-neutral-500">
                                <tr>
                                  <StandardSortableTableHeader
                                    label="Action"
                                    columnKey="action"
                                    sortKey="action"
                                    sort={detailEventSort}
                                    onSort={sortDetailEventsBy}
                                    onResize={resizeEventColumn}
                                  />
                                  <StandardSortableTableHeader
                                    label="Category"
                                    columnKey="category"
                                    sortKey="category"
                                    sort={detailEventSort}
                                    onSort={sortDetailEventsBy}
                                    onResize={resizeEventColumn}
                                  />
                                  <StandardSortableTableHeader
                                    label="Actor"
                                    columnKey="actor"
                                    sortKey="actor"
                                    sort={detailEventSort}
                                    onSort={sortDetailEventsBy}
                                    onResize={resizeEventColumn}
                                  />
                                  <StandardSortableTableHeader
                                    label="Created"
                                    columnKey="createdAt"
                                    sortKey="createdAt"
                                    sort={detailEventSort}
                                    onSort={sortDetailEventsBy}
                                    onResize={resizeEventColumn}
                                  />
                                  <StandardResizableTableHeader
                                    label="Details"
                                    columnKey="target"
                                    onResize={resizeEventColumn}
                                    align="right"
                                  />
                                </tr>
                              </thead>
                              <tbody>
                                {pagedDetailEvents.map((event) => {
                                  const isExpanded =
                                    expandedDetailEventIds.has(event.id);
                                  return (
                                    <Fragment key={event.id}>
                                      <tr className="border-t border-[var(--color-border)] align-top hover:bg-neutral-50">
                                        <td className="px-3 py-3 font-medium">
                                          {auditActionLabel(event.action)}
                                        </td>
                                        <td className="px-3 py-3 text-neutral-600">
                                          {event.category}
                                        </td>
                                        <td className="break-all px-3 py-3 font-mono text-[12px]">
                                          {auditActorLabel(event)}
                                        </td>
                                        <td className="px-3 py-3 text-neutral-500">
                                          {formatDate(event.createdAt)}
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              toggleDetailEvent(event.id)
                                            }
                                            className="text-[13px] font-medium text-[var(--color-accent)] hover:underline"
                                            aria-expanded={isExpanded}
                                            aria-label={`${
                                              isExpanded ? 'Hide' : 'Show'
                                            } details for ${auditActionLabel(
                                              event.action,
                                            )}`}
                                          >
                                            {isExpanded ? 'Hide' : 'Open'}
                                          </button>
                                        </td>
                                      </tr>
                                      {isExpanded && (
                                        <tr className="border-t border-[var(--color-border)] bg-neutral-50">
                                          <td colSpan={5} className="px-3 py-3">
                                            <AuditEventDetailPanel event={event} />
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {pagedDetailEvents.length === 0 && (
                            <div className="border-t border-[var(--color-border)] p-4 text-[13px] text-neutral-500">
                              No events match the current filters.
                            </div>
                          )}
                        </div>
                        <TablePager
                          count={pagedDetailEvents.length}
                          total={visibleDetailEvents.length}
                          noun="events"
                          page={activeDetailEventPage}
                          pageCount={detailEventPageCount}
                          onPrevious={() =>
                            setDetailEventPage((page) => Math.max(1, page - 1))
                          }
                          onNext={() =>
                            setDetailEventPage((page) =>
                              Math.min(detailEventPageCount, page + 1),
                            )
                          }
                        />
                      </>
                    ) : (
                      <EmptyState
                        title="No matching events"
                        body="Workspace events tied to this record will appear here."
                        compact
                      />
                    )}
                    </section>
                  )}
                </div>
              ) : (
                <EmptyState
                  title="Select an attestation"
                  body="Choose an attestation from the list to see status, receipts, private verifier lookups, and access grants."
                  compact
                />
              )}
            </div>
              )}
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
};

type HomeView =
  | 'overview'
  | 'workspaces'
  | 'projects'
  | 'attestations'
  | 'requests'
  | 'users'
  | 'settings'
  | 'profile'
  | 'audit';
type ProjectViewMode = 'list' | 'new';
type AttestationViewMode = 'list' | 'new' | 'detail';
type AttestationDetailTab = 'records' | 'verifications' | 'events';
type EventsTab = 'records' | 'exports';
type AttestationColumnKey =
  | 'label'
  | 'project'
  | 'createdAt'
  | 'confirmedAt'
  | 'state';
type AttestationColumnWidths = Record<AttestationColumnKey, number>;
type ProjectColumnKey = 'name' | 'status' | 'actions';
type ProjectColumnWidths = Record<ProjectColumnKey, number>;
type WorkspaceColumnKey = 'name' | 'role' | 'status' | 'actions';
type WorkspaceColumnWidths = Record<WorkspaceColumnKey, number>;
type RequestColumnKey =
  | 'verifier'
  | 'attestation'
  | 'project'
  | 'status'
  | 'createdAt'
  | 'reason'
  | 'actions';
type RequestColumnWidths = Record<RequestColumnKey, number>;
type MemberColumnKey =
  | 'user'
  | 'status'
  | 'role'
  | 'workspaces'
  | 'orgRole'
  | 'joinedAt';
type MemberColumnWidths = Record<MemberColumnKey, number>;
type EventColumnKey = 'action' | 'category' | 'actor' | 'target' | 'createdAt';
type EventColumnWidths = Record<EventColumnKey, number>;
type VerifierColumnKey =
  | 'email'
  | 'status'
  | 'createdAt'
  | 'actions';
type VerifierColumnWidths = Record<VerifierColumnKey, number>;
type AttestationStatusFilter =
  | 'all'
  | 'active'
  | 'confirmed'
  | 'failed'
  | 'other';
type ProjectStatusFilter = 'all' | 'active' | 'archived';
type RequestStatusFilter = 'all' | 'pending' | 'approved' | 'denied';
type MemberRoleFilter =
  | 'all'
  | 'tenant_admin'
  | 'producer'
  | 'organization_admin';
type VerifierStatusFilter = 'all' | 'pending' | 'claimed';
type WorkspaceRole = 'tenant_admin' | 'producer' | 'consumer';
type OrganizationRole = 'organization_admin' | 'member';
type WorkspaceAccessMode = 'selected_workspaces';
interface MemberEditDraft {
  role: WorkspaceRole;
  organizationAdmin: boolean;
  workspaceIds: string[];
}
type UserRosterRow =
  | {
      kind: 'member';
      userId: string;
      email: string;
      displayName: string | null;
      role: string;
      organizationRole: string;
      joinedAt: string;
      status: 'active';
      workspaces?: Array<{
        id: string;
        slug: string;
        name: string;
        role: string;
      }>;
    }
  | {
      kind: 'invitation';
      id: string;
      userId: string;
      email: string;
      displayName: null;
      role: string;
      organizationRole: string;
      joinedAt: string;
      expiresAt: string;
      status: 'pending';
      workspaces?: Array<{
        id: string;
        slug: string;
        name: string;
        role: string;
      }>;
    };
type MemberRosterRow = Extract<UserRosterRow, { kind: 'member' }>;
interface UserDetailCurrentDevice {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}
type AttestationSortKey = 'label' | 'state' | 'createdAt' | 'confirmedAt';
type ProjectSortKey = 'name' | 'status';
type WorkspaceSortKey = 'name' | 'role' | 'status';
type RequestSortKey =
  | 'verifier'
  | 'attestation'
  | 'project'
  | 'status'
  | 'createdAt';
type MemberSortKey =
  | 'user'
  | 'status'
  | 'role'
  | 'workspaces'
  | 'orgRole'
  | 'joinedAt';
type EventSortKey = 'action' | 'category' | 'actor' | 'target' | 'createdAt';
type VerifierSortKey = 'email' | 'status' | 'createdAt';
type SortDirection = 'asc' | 'desc';

interface AttestationSort {
  key: AttestationSortKey;
  direction: SortDirection;
}
interface ProjectSort {
  key: ProjectSortKey;
  direction: SortDirection;
}
interface WorkspaceSort {
  key: WorkspaceSortKey;
  direction: SortDirection;
}
interface RequestSort {
  key: RequestSortKey;
  direction: SortDirection;
}
interface MemberSort {
  key: MemberSortKey;
  direction: SortDirection;
}
interface EventSort {
  key: EventSortKey;
  direction: SortDirection;
}
interface VerifierSort {
  key: VerifierSortKey;
  direction: SortDirection;
}

const UserDetailPanel = ({
  member,
  draft,
  memberChanged,
  currentUserId,
  currentDevice,
  currentDeviceId,
  currentDeviceLoading,
  currentDeviceError,
  currentDeviceIsError,
  projectNounLower,
  projectNounPluralLower,
  removingMemberId,
  savingMemberAccessId,
  workspaceOptions,
  onBack,
  onUpdateDraft,
  onRemove,
  onRetryDevices,
  onSubmit,
}: {
  member: MemberRosterRow;
  draft: MemberEditDraft;
  memberChanged: boolean;
  currentUserId: string;
  currentDevice: UserDetailCurrentDevice | null;
  currentDeviceId: string | null;
  currentDeviceLoading: boolean;
  currentDeviceError: unknown;
  currentDeviceIsError: boolean;
  projectNounLower: string;
  projectNounPluralLower: string;
  removingMemberId: string | null;
  savingMemberAccessId: string | null;
  workspaceOptions: Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  onBack: () => void;
  onUpdateDraft: (patch: Partial<MemberEditDraft>) => void;
  onRemove: () => void;
  onRetryDevices: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): React.JSX.Element => {
  return (
    <div className="mt-5 grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-[13px] text-[var(--color-accent)] hover:underline"
          >
            Back to users
          </button>
          <h3 className="mt-3 text-[20px] font-medium">User Detail</h3>
          <p className="mt-1 font-mono text-[13px] text-neutral-500">
            {member.email}
          </p>
        </div>
        <StatusPill state={member.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border border-[var(--color-border)] px-3 py-3">
          <p className="text-[12px] uppercase text-neutral-500">Name</p>
          <p className="mt-1 text-[14px] font-medium">
            {member.displayName ?? member.email}
          </p>
        </div>
        <div className="border border-[var(--color-border)] px-3 py-3">
          <p className="text-[12px] uppercase text-neutral-500">
            Workspace role
          </p>
          <p className="mt-1 text-[14px]">{roleLabel(member.role)}</p>
        </div>
        <div className="border border-[var(--color-border)] px-3 py-3">
          <p className="text-[12px] uppercase text-neutral-500">Joined</p>
          <p className="mt-1 text-[14px]">{formatDate(member.joinedAt)}</p>
        </div>
      </div>

      <section className="grid gap-2">
        <h4 className="text-[15px] font-medium">Current trusted device</h4>
        {currentDeviceLoading ? (
          <LoadingState label="Loading trusted device..." />
        ) : currentDeviceIsError ? (
          <ErrorState
            message={errorMessage(
              currentDeviceError,
              'Could not load trusted device.',
            )}
            onRetry={onRetryDevices}
          />
        ) : currentDevice ? (
          <div className="border border-[var(--color-border)] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{currentDevice.name}</span>
              <span className="border border-[#15803D] bg-[#F0FDF4] px-2 py-0.5 text-[11px] text-[#166534]">
                Current trusted device
              </span>
              {currentDevice.id === currentDeviceId && (
                <span className="border border-[#1D4ED8] bg-[#EFF6FF] px-2 py-0.5 text-[11px] text-[#1E40AF]">
                  This desktop
                </span>
              )}
              <StatusPill
                state={currentDevice.revokedAt ? 'revoked' : 'active'}
              />
            </div>
            <p className="mt-2 font-mono text-[12px] text-neutral-500">
              {currentDevice.id}
            </p>
            <p className="mt-1 text-[12px] text-neutral-500">
              {currentDevice.platform} · {currentDevice.appVersion} · Paired{' '}
              {formatDate(currentDevice.pairedAt)}
              {currentDevice.lastSeenAt
                ? ` · Last seen ${formatDate(currentDevice.lastSeenAt)}`
                : ''}
            </p>
          </div>
        ) : (
          <p className="border border-[var(--color-border)] px-3 py-3 text-[13px] text-neutral-500">
            This user has no active trusted device in this workspace.
            Use Events for trusted-device history.
          </p>
        )}
      </section>

      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="flex w-fit items-center gap-2 border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] text-neutral-700">
              <input
                type="checkbox"
                name="organizationAdmin"
                value="true"
                checked={draft.organizationAdmin}
                onChange={(event) =>
                  onUpdateDraft({ organizationAdmin: event.target.checked })
                }
                className="h-4 w-4"
              />
              Organization Admin
            </label>
            {draft.organizationAdmin && (
              <p className="border border-[#B45309] bg-[#FFFBEB] px-3 py-2 text-[12px] leading-5 text-[#92400E]">
                Organization admins can manage users, workspaces,{' '}
                {projectNounPluralLower}, attestations, access, and exports
                across the organization. The organization must always keep at
                least one organization admin.
              </p>
            )}
          </div>
          <ChoiceSegmentGroup
            legend="Workspace role"
            name="role"
            value={draft.role}
            onChange={(value) =>
              onUpdateDraft({ role: value as WorkspaceRole })
            }
            options={[
              { value: 'producer', label: 'Workspace member' },
              { value: 'tenant_admin', label: 'Workspace admin' },
            ]}
          />
          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-medium text-neutral-700">
              Workspace membership
            </legend>
            <div className="grid gap-2 md:grid-cols-2">
              {workspaceOptions.map((workspace) => {
                const checked = draft.workspaceIds.includes(workspace.id);
                return (
                  <label
                    key={workspace.id}
                    className="flex items-start gap-2 border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] text-neutral-700"
                  >
                    <input
                      type="checkbox"
                      name="workspaceIds"
                      value={workspace.id}
                      checked={checked}
                      onChange={(event) => {
                        const nextWorkspaceIds = event.target.checked
                          ? [...draft.workspaceIds, workspace.id]
                          : draft.workspaceIds.filter(
                              (id) => id !== workspace.id,
                            );
                        onUpdateDraft({ workspaceIds: nextWorkspaceIds });
                      }}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      <span className="block font-medium text-neutral-900">
                        {workspace.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-[12px] text-neutral-500">
                        {workspace.slug}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="text-[12px] leading-5 text-neutral-500">
            Workspace access is selected workspaces only. Verifiers are managed
            separately through {projectNounLower} or attestation verification
            access.
          </p>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          {member.userId !== currentUserId && (
            <button
              type="button"
              onClick={onRemove}
              disabled={Boolean(removingMemberId)}
              className="border border-[#B91C1C] px-3 py-1.5 text-[13px] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-50"
            >
              {removingMemberId === member.userId ? 'Deleting...' : 'Delete user'}
            </button>
          )}
          {memberChanged && (
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onBack}
                className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] hover:border-neutral-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(savingMemberAccessId)}
                className="bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {savingMemberAccessId === member.userId
                  ? 'Saving...'
                  : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

interface AttestationTableRow {
  id: string;
  label: string;
  description: string | null;
  state: string;
  createdAt: string;
  confirmedAt: string | null;
}

interface AttestationFileInput {
  id: string;
  file: File;
  label: string;
  hash: string;
  contentProof?: PlainTextContentProof;
  contentProofError: string | null;
  exactImageProof?: RendererExactImageProof;
  error: string | null;
  result?: AttestationSubmitResult;
}

interface PlainTextContentProof {
  preset: 'standard';
  sourceExtractionMethod:
    | 'plain-text/v1'
    | 'pdf-text-layer/v1'
    | 'ocr-tesseract/v1';
  normalizedTokenCount: number;
  shingleCount: number;
  shingles: Array<{
    canonicalPayloadHash: string;
    sourceIndex: number;
  }>;
  ocrSummary?: RendererOcrSummary;
}

type AttestationSubmitResult =
  | {
      clientId: string;
      label: string;
      ok: true;
      attestationId: string;
      state: string;
      merkleRoot: string;
      submittedHash: string;
      shingleCount: number;
      componentCount: number;
      confirmedAt: string | null;
    }
  | {
      clientId: string;
      label: string;
      ok: false;
      error: string;
    };
type AttestationSubmitSuccess = Extract<AttestationSubmitResult, { ok: true }>;

interface SubmissionProgress {
  visible: boolean;
  label: string;
  detail: string;
  percent: number;
}

interface SubmissionBatchSummary {
  visible: boolean;
  items: Array<{ label: string; value: string }>;
}

interface AttestationStateSnapshot {
  state: string;
  confirmedAt: string | null;
}

const ATTESTATION_PAGE_SIZE = 8;
const STANDARD_TABLE_PAGE_SIZE = 8;
const DEFAULT_ATTESTATION_COLUMN_WIDTHS: AttestationColumnWidths = {
  label: 240,
  project: 180,
  createdAt: 112,
  confirmedAt: 112,
  state: 96,
};
const ATTESTATION_COLUMN_MIN_WIDTHS: AttestationColumnWidths = {
  label: 160,
  project: 140,
  createdAt: 96,
  confirmedAt: 96,
  state: 88,
};
const DEFAULT_PROJECT_COLUMN_WIDTHS: ProjectColumnWidths = {
  name: 220,
  status: 120,
  actions: 120,
};
const PROJECT_COLUMN_MIN_WIDTHS: ProjectColumnWidths = {
  name: 160,
  status: 96,
  actions: 96,
};
const DEFAULT_WORKSPACE_COLUMN_WIDTHS: WorkspaceColumnWidths = {
  name: 260,
  role: 160,
  status: 120,
  actions: 160,
};
const WORKSPACE_COLUMN_MIN_WIDTHS: WorkspaceColumnWidths = {
  name: 180,
  role: 120,
  status: 100,
  actions: 130,
};
const DEFAULT_REQUEST_COLUMN_WIDTHS: RequestColumnWidths = {
  verifier: 220,
  attestation: 160,
  project: 160,
  status: 110,
  createdAt: 112,
  reason: 240,
  actions: 160,
};
const REQUEST_COLUMN_MIN_WIDTHS: RequestColumnWidths = {
  verifier: 160,
  attestation: 130,
  project: 130,
  status: 96,
  createdAt: 96,
  reason: 180,
  actions: 140,
};
const DEFAULT_MEMBER_COLUMN_WIDTHS: MemberColumnWidths = {
  user: 240,
  status: 110,
  role: 150,
  workspaces: 260,
  orgRole: 130,
  joinedAt: 112,
};
const MEMBER_COLUMN_MIN_WIDTHS: MemberColumnWidths = {
  user: 170,
  status: 96,
  role: 120,
  workspaces: 180,
  orgRole: 110,
  joinedAt: 96,
};
const DEFAULT_EVENT_COLUMN_WIDTHS: EventColumnWidths = {
  action: 240,
  category: 140,
  actor: 220,
  target: 220,
  createdAt: 112,
};
const EVENT_COLUMN_MIN_WIDTHS: EventColumnWidths = {
  action: 170,
  category: 110,
  actor: 160,
  target: 160,
  createdAt: 96,
};
const DEFAULT_VERIFIER_COLUMN_WIDTHS: VerifierColumnWidths = {
  email: 220,
  status: 110,
  createdAt: 112,
  actions: 96,
};
const VERIFIER_COLUMN_MIN_WIDTHS: VerifierColumnWidths = {
  email: 160,
  status: 96,
  createdAt: 96,
  actions: 80,
};

const HOME_VIEWS: { id: HomeView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'projects', label: 'Projects' },
  { id: 'attestations', label: 'Attestations' },
  { id: 'requests', label: 'Verification Requests' },
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' },
  { id: 'audit', label: 'Events' },
];

interface MetricProps {
  label: string;
  value: string;
}

const Metric = ({ label, value }: MetricProps): React.JSX.Element => (
  <div className="border border-[var(--color-border)] p-4">
    <HelpLabel
      label={label}
      className="text-[11px] font-medium text-neutral-500"
    />
    <div className="mt-2 text-[20px] font-medium">{value}</div>
  </div>
);

const CompactFact = ({
  label,
  value,
}: {
  label: string;
  value: string | null;
}): React.JSX.Element => (
  <div className="min-w-0">
    <dt>
      <HelpLabel
        label={label}
        className="text-[10px] font-medium text-neutral-500"
      />
    </dt>
    <dd className="mt-0.5 font-mono text-[12px] leading-5 text-neutral-800">
      {value && isCopyableDetailLabel(label) ? (
        <CopyableValue value={value} label={label} />
      ) : (
        <span className="break-words">{value ?? 'None'}</span>
      )}
    </dd>
  </div>
);

interface DetailPanelProps {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}

const DetailPanel = ({
  title,
  description,
  children,
  actions,
}: DetailPanelProps): React.JSX.Element => (
  <details className="group border border-[var(--color-border)] bg-white">
    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 marker:hidden">
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
          {description}
        </span>
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-3">
        {actions}
        <span className="text-[12px] font-medium text-neutral-500 group-open:hidden">
          Open
        </span>
        <span className="hidden text-[12px] font-medium text-neutral-500 group-open:inline">
          Close
        </span>
      </span>
    </summary>
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      {children}
    </div>
  </details>
);

const AttestationDetailTabButton = ({
  label,
  active,
  onClick,
  children,
  help,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  help?: string;
}): React.JSX.Element => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    title={help}
    aria-label={help ? `${label}: ${help}` : label}
    className={`min-w-max border-r border-[var(--color-border)] px-4 py-2.5 text-left text-[13px] font-medium hover:bg-neutral-50 ${
      active
        ? 'border-b-2 border-b-neutral-900 bg-neutral-50 text-neutral-950'
        : 'text-neutral-500'
    }`}
  >
    {children}
  </button>
);

const ReceiptLinkRow = ({
  label,
  href,
  onCopy,
}: {
  label: string;
  href: string;
  onCopy: () => void;
}): React.JSX.Element => (
  <div className="grid grid-cols-[minmax(48px,max-content)_minmax(0,1fr)_32px] items-center gap-3 border-b border-[var(--color-border)] py-2 last:border-b-0">
    <HelpLabel
      label={`${label}:`}
      help={labelHelp(label)}
      className="text-[11px] font-medium text-neutral-500"
    />
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open ${label.toLowerCase()} link`}
      className="min-w-0 break-all font-mono text-[12px] text-[var(--color-accent)] hover:underline"
    >
      {href}
    </a>
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex h-8 w-8 items-center justify-center text-neutral-500 hover:text-neutral-900"
      aria-label={`Copy ${label.toLowerCase()} link`}
      title={`Copy ${label} link`}
    >
      <CopyIcon />
    </button>
  </div>
);

const ReceiptPendingRow = ({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element => (
  <div className="grid grid-cols-[minmax(48px,max-content)_minmax(0,1fr)_32px] items-center gap-3 border-b border-[var(--color-border)] py-2 last:border-b-0">
    <HelpLabel
      label={`${label}:`}
      help={labelHelp(label)}
      className="text-[11px] font-medium text-neutral-500"
    />
    <span className="min-w-0 text-[12px] text-neutral-500">{value}</span>
    <span aria-hidden="true" />
  </div>
);

const CopyIcon = (): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const attemptRollupLabel = (attempts: AttestationAttemptLike[]): string => {
  if (attempts.length === 0) return 'No attempts yet.';
  const confirmed = attempts.filter((attempt) => attempt.isConfirmed).length;
  const failed = attempts.filter(
    (attempt) => attempt.failedAt || attempt.state === 'failed',
  ).length;
  const latest = attempts.reduce((newest, attempt) =>
    new Date(attempt.createdAt).getTime() > new Date(newest.createdAt).getTime()
      ? attempt
      : newest,
  );
  return `${confirmed} confirmed · ${failed} failed · latest ${formatDateTime(
    latest.createdAt,
  )}`;
};

interface OverviewAttentionItemProps {
  item: {
    title: string;
    body: string;
    action: string;
    tone: 'warning' | 'danger';
    onClick: () => void;
  };
}

const OverviewAttentionItem = ({
  item,
}: OverviewAttentionItemProps): React.JSX.Element => {
  const toneClass =
    item.tone === 'danger'
      ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]'
      : 'border-[#B45309] bg-[#FFFBEB] text-[#92400E]';

  return (
    <div className={`border p-4 ${toneClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-medium">{item.title}</h3>
          <p className="mt-1 text-[13px] leading-5">{item.body}</p>
        </div>
        <button
          type="button"
          onClick={item.onClick}
          className="bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white"
        >
          {item.action}
        </button>
      </div>
    </div>
  );
};

interface OverviewNextActionProps {
  action: {
    label: string;
    description: string;
    onClick: () => void;
  };
}

const OverviewNextAction = ({
  action,
}: OverviewNextActionProps): React.JSX.Element => (
  <button
    type="button"
    onClick={action.onClick}
    className="border border-[var(--color-border)] px-4 py-3 text-left hover:border-neutral-700"
  >
    <span className="block text-[14px] font-medium">{action.label}</span>
    <span className="mt-1 block text-[12px] leading-5 text-neutral-500">
      {action.description}
    </span>
  </button>
);

const TablePager = ({
  count,
  total,
  noun,
  page,
  pageCount,
  onPrevious,
  onNext,
}: {
  count: number;
  total: number;
  noun: string;
  page: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
}): React.JSX.Element => (
  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-neutral-600">
    <div>
      Showing {count} of {total} matching {noun}
    </div>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={page <= 1}
        className="border border-[var(--color-border)] px-3 py-1.5 hover:border-neutral-700 disabled:opacity-50"
      >
        Previous
      </button>
      <span>
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= pageCount}
        className="border border-[var(--color-border)] px-3 py-1.5 hover:border-neutral-700 disabled:opacity-50"
      >
        Next
      </button>
    </div>
  </div>
);

const SubmissionProgressBar = ({
  progress,
  summary,
}: {
  progress: SubmissionProgress;
  summary: SubmissionBatchSummary;
}): React.JSX.Element => (
  <div className="border border-[var(--color-border)] bg-white p-3">
    <div className="flex items-center justify-between gap-3">
      <div className="text-[13px] font-medium text-neutral-800">
        {progress.label}
      </div>
      <div className="font-mono text-[12px] text-neutral-500">
        {progress.percent}%
      </div>
    </div>
    <div className="mt-3 h-2 overflow-hidden bg-neutral-100">
      <div
        className="h-full bg-neutral-900 transition-[width] duration-300"
        style={{ width: `${progress.percent}%` }}
      />
    </div>
    <p className="mt-2 text-[12px] text-neutral-500">{progress.detail}</p>
    {summary.visible && (
      <div className="mt-3 grid gap-2 border-t border-[var(--color-border)] pt-3 text-[12px] sm:grid-cols-4">
        {summary.items.map((item) => (
          <div key={item.label}>
            <div className="font-medium text-neutral-900">{item.value}</div>
            <div className="mt-0.5 text-neutral-500">{item.label}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface AttestationTableHeaderProps {
  label: string;
  columnKey: AttestationColumnKey;
  sortKey: AttestationSortKey;
  sort: AttestationSort;
  onSort: (key: AttestationSortKey) => void;
  onResize: (key: AttestationColumnKey, deltaX: number) => void;
  align?: 'left' | 'right';
}

const AttestationTableHeader = ({
  label,
  columnKey,
  sortKey,
  sort,
  onSort,
  onResize,
  align = 'left',
}: AttestationTableHeaderProps): React.JSX.Element => (
  <ResizableTableHeader
    label={label}
    columnKey={columnKey}
    onResize={onResize}
    align={align}
  >
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 hover:text-neutral-900 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {label}
      <SortIcon
        active={sort.key === sortKey}
        direction={sort.key === sortKey ? sort.direction : null}
      />
    </button>
  </ResizableTableHeader>
);

interface StandardSortableTableHeaderProps<
  TColumnKey extends string,
  TSortKey extends string,
> {
  label: string;
  columnKey: TColumnKey;
  sortKey: TSortKey;
  sort: { key: TSortKey; direction: SortDirection };
  onSort: (key: TSortKey) => void;
  onResize: (key: TColumnKey, deltaX: number) => void;
  align?: 'left' | 'right';
}

const StandardSortableTableHeader = <
  TColumnKey extends string,
  TSortKey extends string,
>({
  label,
  columnKey,
  sortKey,
  sort,
  onSort,
  onResize,
  align = 'left',
}: StandardSortableTableHeaderProps<
  TColumnKey,
  TSortKey
>): React.JSX.Element => (
  <StandardResizableTableHeader
    label={label}
    columnKey={columnKey}
    onResize={onResize}
    align={align}
  >
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 hover:text-neutral-900 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {label}
      <SortIcon
        active={sort.key === sortKey}
        direction={sort.key === sortKey ? sort.direction : null}
      />
    </button>
  </StandardResizableTableHeader>
);

const StandardResizableTableHeader = <TColumnKey extends string>({
  label,
  columnKey,
  onResize,
  align = 'left',
  children,
}: {
  label: string;
  columnKey: TColumnKey;
  onResize: (key: TColumnKey, deltaX: number) => void;
  align?: 'left' | 'right';
  children?: ReactNode;
}): React.JSX.Element => {
  const startResize = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const onMouseMove = (moveEvent: MouseEvent): void => {
      onResize(columnKey, moveEvent.clientX - startX);
    };
    const onMouseUp = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <th
      className={`relative px-3 py-2 font-medium ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children ?? label}
      <button
        type="button"
        onMouseDown={startResize}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-transparent hover:border-neutral-400"
        aria-label={`Resize ${label} column`}
        title={`Resize ${label} column`}
      />
    </th>
  );
};

const ResizableTableHeader = ({
  label,
  columnKey,
  onResize,
  align = 'left',
  children,
}: {
  label: string;
  columnKey: AttestationColumnKey;
  onResize: (key: AttestationColumnKey, deltaX: number) => void;
  align?: 'left' | 'right';
  children?: ReactNode;
}): React.JSX.Element => {
  const startResize = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const onMouseMove = (moveEvent: MouseEvent): void => {
      onResize(columnKey, moveEvent.clientX - startX);
    };
    const onMouseUp = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <th
      className={`relative px-3 py-2 font-medium ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children ?? label}
      <button
        type="button"
        onMouseDown={startResize}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-transparent hover:border-neutral-400"
        aria-label={`Resize ${label} column`}
        title={`Resize ${label} column`}
      />
    </th>
  );
};

const SortIcon = ({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection | null;
}): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className={`h-3.5 w-3.5 ${active ? 'text-neutral-900' : 'text-neutral-400'}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {direction === 'asc' ? (
      <path d="M8 3.5v9M4.5 7 8 3.5 11.5 7" />
    ) : direction === 'desc' ? (
      <path d="M8 12.5v-9M4.5 9 8 12.5 11.5 9" />
    ) : (
      <>
        <path d="M5 6 8 3 11 6" />
        <path d="M5 10 8 13 11 10" />
      </>
    )}
  </svg>
);

const RefreshIcon = (): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 0 1-15.5 6.2" />
    <path d="M3 12A9 9 0 0 1 18.5 5.8" />
    <path d="M18 2v4h4" />
    <path d="M6 22v-4H2" />
  </svg>
);

const SidebarToggleIcon = ({
  collapsed,
}: {
  collapsed: boolean;
}): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    {collapsed ? <path d="M13 9l3 3-3 3" /> : <path d="M16 9l-3 3 3 3" />}
  </svg>
);

const ArchiveIcon = (): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </svg>
);

const RestoreIcon = (): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v6h6" />
    <path d="M12 8v5l3 2" />
  </svg>
);

const RevokeIcon = (): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

interface AuditEventCardProps {
  event: {
    id: string;
    category: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    actorUserId: string | null;
    actorDeviceId: string | null;
    actorEmail: string | null;
    createdAt: string;
  };
  compact?: boolean;
}

const AuditEventCard = ({
  event,
  compact = false,
}: AuditEventCardProps): React.JSX.Element => (
  <article
    className={`border border-[var(--color-border)] ${
      compact ? 'p-3' : 'px-4 py-3'
    }`}
  >
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3
          className="text-[15px] font-medium"
          title={labelHelp('Event action')}
        >
          {auditActionLabel(event.action)}
        </h3>
        <p
          className="mt-1 text-[13px] text-neutral-500"
          title={labelHelp('Event category')}
        >
          {event.category}
          {event.targetType ? ` · ${event.targetType}` : ''}
        </p>
      </div>
      <time
        className="shrink-0 text-[12px] text-neutral-500"
        title={labelHelp('Created')}
      >
        {formatDate(event.createdAt)}
      </time>
    </div>
    <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1 text-[12px]">
      <dt>
        <HelpLabel label="Actor" className="text-neutral-500" />
      </dt>
      <dd className="break-all font-mono">{auditActorLabel(event)}</dd>
      {event.actorDeviceId && (
        <>
          <dt>
            <HelpLabel label="Device" className="text-neutral-500" />
          </dt>
          <dd className="break-all font-mono">
            <CopyableValue value={event.actorDeviceId} label="Device id" />
          </dd>
        </>
      )}
      {event.targetId && (
        <>
          <dt>
            <HelpLabel label="Target" className="text-neutral-500" />
          </dt>
          <dd className="break-all font-mono">
            <CopyableValue value={event.targetId} label="Target id" />
          </dd>
        </>
      )}
    </dl>
  </article>
);

const AuditEventDetailPanel = ({
  event,
}: {
  event: AuditEventCardProps['event'] & { payload: unknown };
}): React.JSX.Element => (
  <div className="grid gap-3 text-[12px]">
    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2">
      <dt>
        <HelpLabel label="Event id" className="text-neutral-500" />
      </dt>
      <dd className="break-all font-mono">
        <CopyableValue value={event.id} label="Event id" />
      </dd>
      <dt>
        <HelpLabel label="Raw action" className="text-neutral-500" />
      </dt>
      <dd className="break-all font-mono">{event.action}</dd>
      <dt>
        <HelpLabel label="Actor" className="text-neutral-500" />
      </dt>
      <dd className="break-all font-mono">{auditActorLabel(event)}</dd>
      {event.actorUserId && (
        <>
          <dt>
            <HelpLabel label="Actor user id" className="text-neutral-500" />
          </dt>
          <dd className="break-all font-mono">
            <CopyableValue value={event.actorUserId} label="Actor user id" />
          </dd>
        </>
      )}
      {event.actorDeviceId && (
        <>
          <dt>
            <HelpLabel label="Actor device id" className="text-neutral-500" />
          </dt>
          <dd className="break-all font-mono">
            <CopyableValue
              value={event.actorDeviceId}
              label="Actor device id"
            />
          </dd>
        </>
      )}
      {event.targetType && (
        <>
          <dt>
            <HelpLabel label="Target type" className="text-neutral-500" />
          </dt>
          <dd>{event.targetType}</dd>
        </>
      )}
      {event.targetId && (
        <>
          <dt>
            <HelpLabel label="Target id" className="text-neutral-500" />
          </dt>
          <dd className="break-all font-mono">
            <CopyableValue value={event.targetId} label="Target id" />
          </dd>
        </>
      )}
      <dt>
        <HelpLabel label="Created" className="text-neutral-500" />
      </dt>
      <dd>{formatDateTime(event.createdAt)}</dd>
    </dl>
    <div>
      <HelpLabel label="Payload" className="text-neutral-500" />
      <pre className="mt-1 max-h-56 overflow-auto border border-[var(--color-border)] bg-white p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
        {formatAuditPayload(event.payload)}
      </pre>
    </div>
  </div>
);

interface WorkflowStepProps {
  index: string;
  label: string;
  value: string;
}

const WorkflowStep = ({
  index,
  label,
  value,
}: WorkflowStepProps): React.JSX.Element => (
  <div className="border border-[var(--color-border)] bg-neutral-50 px-3 py-3">
    <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center border border-[var(--color-border)] bg-white text-[12px] font-medium">
        {index}
      </span>
      <span className="font-medium">{label}</span>
    </div>
    <div className="mt-2 text-neutral-500">{value}</div>
  </div>
);

interface EmptyStateProps {
  title: string;
  body: string;
  actionLabel?: string;
  compact?: boolean;
  onAction?: () => void;
}

interface LoadingStateProps {
  label: string;
  compact?: boolean;
}

const LoadingState = ({
  label,
  compact = false,
}: LoadingStateProps): React.JSX.Element => (
  <p
    className={`${compact ? 'mt-3 text-[13px]' : 'mt-5 text-[14px]'} text-neutral-500`}
  >
    {label}
  </p>
);

interface ErrorStateProps {
  message: string;
  compact?: boolean;
  onRetry?: () => void;
}

const ErrorState = ({
  message,
  compact = false,
  onRetry,
}: ErrorStateProps): React.JSX.Element => (
  <div
    role="alert"
    className={`${compact ? 'mt-3 text-[13px]' : 'mt-5 text-[14px]'} text-[#B91C1C]`}
  >
    <p>{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 border border-[#FCA5A5] bg-white px-3 py-1.5 text-[13px] text-[#991B1B] hover:border-[#DC2626]"
      >
        Retry
      </button>
    )}
  </div>
);

const EmptyState = ({
  title,
  body,
  actionLabel,
  compact = false,
  onAction,
}: EmptyStateProps): React.JSX.Element => (
  <div
    className={`mt-5 border border-dashed border-[var(--color-border)] bg-neutral-50 ${
      compact ? 'p-3' : 'p-5'
    }`}
  >
    <h3 className="text-[14px] font-medium">{title}</h3>
    <p className="mt-1 text-[13px] leading-5 text-neutral-500">{body}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-4 border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] hover:border-neutral-700"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

interface ProjectFieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}

const ProjectField = ({
  label,
  htmlFor,
  children,
}: ProjectFieldProps): React.JSX.Element => (
  <div>
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[13px] font-medium text-neutral-700"
    >
      {label}
    </label>
    {children}
  </div>
);

const ChoiceSegmentGroup = ({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}): React.JSX.Element => (
  <fieldset>
    <legend className="mb-1.5 block text-[13px] font-medium text-neutral-700">
      {legend}
    </legend>
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        return (
          <label key={option.value} htmlFor={id} className="cursor-pointer">
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="block border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] text-neutral-700 peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-neutral-900">
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

const StatusPill = ({ state }: { state: string }): React.JSX.Element => (
  <span
    className={`border px-2 py-1 text-[12px] ${statusClass(state)}`}
    title={labelHelp('Status')}
  >
    {state}
  </span>
);

const SuccessDetail = ({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}): React.JSX.Element => (
  <div className={wide ? 'sm:col-span-2' : undefined}>
    <div className="text-[11px] font-medium uppercase text-[#166534]/70">
      {label}
    </div>
    <div className="mt-1 break-all font-mono text-[12px] text-[#14532D]">
      {value}
    </div>
  </div>
);

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value: string | null;
}): React.JSX.Element => (
  <div>
    <HelpLabel
      label={label}
      className="text-[11px] font-medium text-neutral-500"
    />
    <div className="mt-1 font-mono text-[12px] text-neutral-700">
      {value && isCopyableDetailLabel(label) ? (
        <CopyableValue value={value} label={label} />
      ) : (
        <span className="break-all">{value ?? 'None'}</span>
      )}
    </div>
  </div>
);

const CopyableValue = ({
  value,
  label,
}: {
  value: string;
  label: string;
}): React.JSX.Element => (
  <span className="inline-flex min-w-0 max-w-full items-start gap-1.5">
    <span className="min-w-0 break-all">{value}</span>
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(value)}
      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-neutral-500 hover:text-neutral-900"
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label}`}
    >
      <CopyIcon />
    </button>
  </span>
);

const isCopyableDetailLabel = (label: string): boolean =>
  [
    'Attestation id',
    'Device signature',
    'Manifest SHA-256',
    'Merkle root',
    'Package id',
    'Receipt Merkle root',
    'Receipt package',
  ].some((copyableLabel) => label.startsWith(copyableLabel));

const HelpLabel = ({
  label,
  help,
  className,
}: {
  label: string;
  help?: string;
  className?: string;
}): React.JSX.Element => {
  const text = help ?? labelHelp(label);
  return (
    <span
      className={`group/help relative inline-flex min-w-0 ${className ?? ''}`}
      aria-label={`${label}: ${text}`}
    >
      <span
        tabIndex={0}
        className="cursor-help border-b border-dotted border-neutral-400 text-[0.9em] normal-case leading-tight hover:border-neutral-800 hover:text-neutral-800 focus:border-neutral-800 focus:text-neutral-800 focus:outline-none"
        aria-label={text}
      >
        {label}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 border border-[var(--color-border)] bg-white px-2 py-1.5 text-left text-[12px] font-normal leading-5 text-neutral-700 shadow-sm group-hover/help:block group-focus-within/help:block"
      >
        {text}
      </span>
    </span>
  );
};

const labelHelp = (label: string): string => {
  const help: Record<string, string> = {
    'Access grants': 'Verifier access entries currently attached to this record.',
    Actor: 'User, device, or system identity that created this event.',
    Attempts: 'Submission runs made while creating or confirming this record.',
    'Auto-refreshing': 'The app is polling while this record is still being processed.',
    Confirmed: 'When this record was confirmed by Proveria.',
    'Content proof': 'Whether this record includes text-content hashes for passage verification.',
    Coverage: 'What the record covers, such as whole-file hashes or text content proof.',
    Created: 'When this record was first created.',
    Device: 'Trusted desktop device associated with this event.',
    'Drive file':
      'Google Drive file name captured when the producer selected the file.',
    'Drive file id':
      'Google Drive file identifier captured as source metadata.',
    'Download JSON': 'Download the raw receipt payload as a JSON artifact.',
    Events: 'Audit history entries related to this record.',
    'Event action': 'The human-readable action recorded in the workspace event log.',
    'Event category': 'Event category and target type recorded by the API.',
    Extraction: 'How text content was extracted before content proof hashing.',
    'Extraction methods': 'Methods used to extract text content for content proof.',
    Failed: 'When this attempt failed, if it did not confirm.',
    'Grant access': 'Allow the listed verifier account to use the private verifier lookup for this attestation.',
    'Grant id': 'Internal identifier for this verifier access grant.',
    'Google account':
      'Google account used when the Drive file was selected.',
    'Handoff message': 'A ready-to-send note with the private verifier lookup and sign-in context.',
    'Private verifier lookup':
      'Private verifier lookup link. It only works for verifiers with granted access.',
    'Merkle root': 'Cryptographic root committing to the hashes in this record.',
    Package: 'Receipt package identifier for this record.',
    'Package id': 'Receipt package identifier for this record.',
    PDF: 'Downloadable receipt PDF for this record.',
    Records: 'Core attestation record, receipt artifacts, confirmation attempts, and proof metadata.',
    Receipt: 'Whether this record has an available receipt bundle.',
    'Receipt evidence summary': 'Receipt fields used to verify the committed record.',
    State: 'Current lifecycle state for this record.',
    Source: 'Where the producer selected the file or hash before local hashing.',
    Status: 'Current lifecycle state for this record.',
    Target: 'Workspace object affected by this event.',
    'Technical receipt data': 'Lower-level receipt metadata and raw JSON for inspection.',
    Uploaded: 'When this attempt uploaded its manifest to the API.',
    Validated: 'When this attempt was validated by the worker.',
    'Verifier email': 'Email address of the verifier account that should receive access.',
    Verifications: 'Private verifier lookup, handoff copy, and access grant management.',
    Web: 'Web receipt page for this record.',
    'Attestation id': 'Internal identifier for this attestation record.',
    'Receipt bundle': 'Web and PDF receipt artifacts for this record.',
    'Receipt JSON': 'Raw signed receipt payload for this attestation.',
    'Receipt package': 'Receipt package identifier for this record.',
    'Receipt Merkle root': 'Merkle root recorded in the receipt.',
    'Manifest SHA-256': 'Hash of the canonical manifest committed by this record.',
    'Receipt confirmed': 'Confirmation time recorded in the receipt.',
    'Receipt issued': 'Issuance time recorded in the receipt.',
    'Device signature': 'Producer device signature recorded in the receipt.',
    Revoke: 'Remove this verifier grant so the account can no longer perform new lookups.',
    'Shingling presets': 'Text content proof window settings used for passage matching.',
  };
  return help[label] ?? label;
};

const primaryAttestationSource = (
  attempts: AttestationSourceAttemptLike[],
): AttestationSourceMetadata | null => {
  return (
    attempts.find((attempt) => attempt.isConfirmed && attempt.sourceMetadata)
      ?.sourceMetadata ??
    attempts.find((attempt) => attempt.sourceMetadata)?.sourceMetadata ??
    null
  );
};

const attestationSourceLabel = (
  source: AttestationSourceMetadata | null | undefined,
): string => {
  if (source?.provider === 'google_drive') return 'Google Drive';
  if (source?.provider === 'model_release') return 'Model release receipt';
  return 'Local or external hash';
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const pluralizeProjectNoun = (noun: string): string => {
  if (noun === 'Case') return 'Cases';
  if (noun.endsWith('y')) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
};

const stripFileExtension = (fileName: string): string =>
  fileName.replace(/\.[^.]+$/, '');

const sanitizeAttestationName = (value: string): string => {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^\w .-]+/g, ' ')
    .replace(/^[^a-zA-Z0-9]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128)
    .trim();
  return sanitized || 'Attestation';
};

const defaultAttestationNameFromFileName = (fileName: string): string =>
  sanitizeAttestationName(stripFileExtension(fileName));

const numberedAttestationName = (baseName: string, index: number): string =>
  sanitizeAttestationName(`${baseName} ${index}`);

const isValidAttestationName = (value: string): boolean =>
  ATTESTATION_NAME_RE.test(value.trim());

const batchDescription = (
  name: string,
  index: number,
  total: number,
): string => `Batch: ${name} (${index}/${total})`;

const parseBatchDescription = (
  description: string | null | undefined,
): { name: string; index: number; total: number } | null => {
  const match = description?.match(/^Batch: (.+) \((\d+)\/(\d+)\)$/);
  if (!match) return null;
  const [, name, index, total] = match;
  const parsedIndex = Number(index);
  const parsedTotal = Number(total);
  if (
    !name ||
    !Number.isInteger(parsedIndex) ||
    !Number.isInteger(parsedTotal) ||
    parsedIndex < 1 ||
    parsedTotal < 1
  ) {
    return null;
  }
  return { name, index: parsedIndex, total: parsedTotal };
};

const sha256FileHex = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const sha256TextHex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const stableCanonicalJson = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('Model release record contains a non-canonical number.');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableCanonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(object[key])}`)
      .join(',')}}`;
  }
  throw new Error('Model release record contains an unsupported value.');
};

const normalizeOptionalHash = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
};

const buildModelReleaseRecord = (form: ModelReleaseFormState) => ({
  record_type: 'model_provenance_record',
  schema_version: '0.1',
  model: {
    name: form.modelName.trim(),
    version: form.modelVersion.trim(),
    type: form.modelType,
    release_stage: form.releaseStage,
  },
  claim: {
    claim_type: form.claimType,
    claim_text: form.claimText.trim(),
    claim_scope: form.claimScope,
    subject_type: form.subjectType,
    subject_identifier: form.subjectIdentifier.trim(),
    subject_hash: form.subjectHash.trim().toLowerCase(),
    claim_status: 'submitted',
  },
  artifacts: {
    artifact_manifest_hash: form.artifactManifestHash.trim().toLowerCase(),
    model_card_hash: form.modelCardHash.trim().toLowerCase(),
  },
  data_provenance: {
    dataset_manifest_hash: form.datasetManifestHash.trim().toLowerCase(),
  },
  evaluation: {
    evaluation_report_hash: form.evaluationReportHash.trim().toLowerCase(),
    risk_review_hash: normalizeOptionalHash(form.riskReviewHash),
    known_limitations: form.knownLimitations.trim(),
  },
  policy: {
    policy_id: form.policyId.trim(),
    policy_version: form.policyVersion.trim(),
    policy_decision: form.policyDecision,
  },
  approval: {
    final_approver: form.finalApprover.trim(),
    final_approval_timestamp: form.finalApprovalTimestamp.trim(),
  },
  disclosure: {
    disclosure_mode: form.disclosureMode,
    verification_policy: form.verificationPolicy.trim(),
    retention_period: form.retentionPeriod.trim(),
    private_evidence_stored: true,
  },
});

const TEXT_PROOF_EXTENSIONS = new Set([
  'csv',
  'md',
  'markdown',
  'txt',
  'tsv',
]);

const isPlainTextProofCandidate = (file: File): boolean => {
  if (file.type.startsWith('text/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? TEXT_PROOF_EXTENSIONS.has(extension) : false;
};

const isNativePdfProofCandidate = (file: File): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const imageMediaType = (file: File): RendererExactImageProof['mediaType'] | null => {
  const name = file.name.toLowerCase();
  if (file.type === 'image/png' || name.endsWith('.png')) return 'image/png';
  if (
    file.type === 'image/jpeg' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg')
  ) {
    return 'image/jpeg';
  }
  return null;
};

const buildExactImageProof = (
  file: File,
): RendererExactImageProof | undefined => {
  const mediaType = imageMediaType(file);
  if (!mediaType) return undefined;
  return { method: 'exact-image-sha256/v1', mediaType };
};

const buildContentProof = async (
  file: File,
): Promise<PlainTextContentProof | undefined> => {
  if (isPlainTextProofCandidate(file)) {
    return buildTextContentProof(await file.text(), 'plain-text/v1');
  }
  if (isNativePdfProofCandidate(file)) {
    const text = await extractPdfTextLayer(file);
    if (normalizedTokenCount(text) >= PDF_TEXT_LAYER_MIN_TOKENS) {
      const proof = await buildTextContentProof(text, 'pdf-text-layer/v1');
      if (proof) return proof;
    }
    const ocr = await buildOcrContentProof(file);
    if (ocr) return ocr;
    throw new Error(
      'This PDF did not have enough selectable text or OCR-readable text to build content proof hashes. It can still be submitted as whole-file coverage.',
    );
  }
  return undefined;
};

const buildTextContentProof = async (
  text: string,
  sourceExtractionMethod: PlainTextContentProof['sourceExtractionMethod'],
  options: { ocrSummary?: RendererOcrSummary } = {},
): Promise<PlainTextContentProof | undefined> => {
  const result = await shinglePlainTextInBrowser(text, {
    preset: 'standard',
    sourceExtractionMethod,
  });
  if (result.shingleCount === 0) return undefined;
  return {
    preset: 'standard',
    sourceExtractionMethod,
    normalizedTokenCount: result.normalizedTokenCount,
    shingleCount: result.shingleCount,
    shingles: result.shingles,
    ...(options.ocrSummary ? { ocrSummary: options.ocrSummary } : {}),
  };
};

const buildOcrContentProof = async (
  file: File,
): Promise<PlainTextContentProof | undefined> => {
  const result = await rpc.attestations.ocrPdf({
    pdfBase64: await fileToBase64(file),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    preset: result.value.contentProof.preset,
    sourceExtractionMethod: result.value.contentProof.sourceExtractionMethod,
    normalizedTokenCount: result.value.contentProof.normalizedTokenCount,
    shingleCount: result.value.contentProof.shingleCount,
    shingles: result.value.contentProof.shingles,
    ocrSummary: result.value.contentProof.ocrSummary,
  };
};

const normalizedTokenCount = (text: string): number =>
  tokenizeNormalized(normalizeForShingling(text)).reduce(
    (count, paragraph) => count + paragraph.length,
    0,
  );

const fileToBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const extractPdfTextLayer = async (file: File): Promise<string> => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (params: object) => { promise: Promise<PdfDocument> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(
        text.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' '),
      );
    }
  } finally {
    await doc.destroy();
  }
  return pages.join('\f');
};

const contentProofErrorMessage = (err: unknown): string => {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return 'Content proof could not be generated from this file. It can still be submitted as whole-file coverage.';
};

const contentProofLabel = (proof: PlainTextContentProof): string =>
  proof.sourceExtractionMethod === 'pdf-text-layer/v1'
    ? 'Native PDF text'
    : proof.sourceExtractionMethod === 'ocr-tesseract/v1'
      ? 'OCR text'
      : 'Plain text';

const imageMediaTypeLabel = (
  mediaType: RendererExactImageProof['mediaType'],
): string => (mediaType === 'image/png' ? 'PNG' : 'JPEG');

const coverageLabel = (coverageType: string): string =>
  coverageType
    .replace('whole-file', 'Whole file')
    .replace('exact image proof', 'Exact image proof')
    .replace('native text + ocr shingles', 'Text + OCR content')
    .replace('native text shingles', 'Text content')
    .replace('ocr-derived shingles', 'OCR content');

const hasContentProofCoverage = (
  coverageType: string,
  extractionMethods: string[],
): boolean =>
  extractionMethods.length > 0 ||
  coverageType.includes('shingle') ||
  coverageType.includes('content');

const contentProofAvailabilityLabel = (
  coverageType: string,
  extractionMethods: string[],
): string =>
  hasContentProofCoverage(coverageType, extractionMethods)
    ? 'Available'
    : 'Whole file only';

const contentProofSummary = (
  coverageType: string,
  extractionMethods: string[],
  shinglingPresets: string[],
): string => {
  if (!hasContentProofCoverage(coverageType, extractionMethods)) {
    return 'Whole-file SHA-256 only';
  }
  const methods =
    extractionMethods.length > 0
      ? extractionMethods.map(formatCoverageToken).join(', ')
      : coverageLabel(coverageType);
  const presets =
    shinglingPresets.length > 0
      ? ` · ${shinglingPresets.map(formatCoverageToken).join(', ')}`
      : '';
  return `${methods}${presets}`;
};

const formatCoverageToken = (value: string): string =>
  value
    .replace(/^standard$/, 'Standard')
    .replace(/^broad$/, 'Broad')
    .replace(/^sensitive$/, 'Sensitive')
    .replace(/^plain-text\/v1$/, 'Plain text')
    .replace(/^pdf-text-layer\/v1$/, 'Native PDF text')
    .replace(/^ocr-tesseract\/v1$/, 'OCR text')
    .replace(/^standard$/, 'Standard');

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  getTextContent(): Promise<{
    items: Array<{ str: string } | Record<string, unknown>>;
  }>;
}

const attestationFileInputId = (file: File, index: number): string =>
  `${file.name}:${file.size}:${file.lastModified}:${index}`;

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

const toReceiptSummary = (receipt: unknown): ReceiptSummary | null => {
  if (!receipt || typeof receipt !== 'object') return null;
  const value = receipt as Partial<ReceiptSummary>;
  if (
    typeof value.attestation_id !== 'string' ||
    typeof value.package_id !== 'string' ||
    typeof value.merkle_root !== 'string' ||
    typeof value.manifest_canonical_sha256 !== 'string' ||
    typeof value.confirmed_at !== 'string' ||
    typeof value.issued_at !== 'string'
  ) {
    return null;
  }
  return {
    attestation_id: value.attestation_id,
    package_id: value.package_id,
    merkle_root: value.merkle_root,
    manifest_canonical_sha256: value.manifest_canonical_sha256,
    confirmed_at: value.confirmed_at,
    issued_at: value.issued_at,
    device_signature: value.device_signature,
    signatures: value.signatures,
  };
};

const buildVerificationUrl = (
  apiUrl: string | undefined,
  linkId: string | null | undefined,
): string | null => {
  if (!apiUrl || !linkId) return null;
  const url = new URL(apiUrl);
  if (url.port === '3001') {
    url.port = '3003';
  }
  url.pathname = `/v/${linkId}`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const buildVerificationPdfUrl = (
  apiUrl: string | undefined,
  linkId: string | null | undefined,
): string | null => {
  if (!apiUrl || !linkId) return null;
  const url = new URL(apiUrl);
  url.pathname = `/v/${linkId}.pdf`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const buildVerifierLookupUrl = (
  apiUrl: string | undefined,
  attestationId: string | null | undefined,
): string | null => {
  if (!apiUrl || !attestationId) return null;
  const url = new URL(apiUrl);
  if (url.port === '3001') {
    url.port = '3003';
  }
  url.pathname = `/lookups/${attestationId}`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const roleLabel = (role: string): string => {
  if (role === 'tenant_admin') return 'Workspace admin';
  if (role === 'producer') return 'Workspace member';
  if (role === 'consumer') return 'Verifier';
  return role;
};

const organizationRoleLabel = (role: string): string => {
  if (role === 'organization_admin') return 'Organization admin';
  if (role === 'member') return 'Organization member';
  return role;
};

const workspaceMembershipLabel = (
  workspaces?: Array<{ name: string }>,
): string => {
  if (!workspaces || workspaces.length === 0) return 'None';
  return workspaces.map((workspace) => workspace.name).join(', ');
};

const sameStringSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
};

const auditActionLabel = (action: string): string =>
  action
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const isVerifierActivityAction = (action: string): boolean =>
  action.startsWith('verification.') ||
  action.startsWith('attestation_access.');

const auditActorLabel = (event: {
  actorEmail: string | null;
  actorUserId: string | null;
  actorDeviceId: string | null;
}): string => {
  if (event.actorEmail) return event.actorEmail;
  if (event.actorDeviceId) return 'Trusted device';
  if (event.actorUserId) return 'Former workspace member';
  return 'System';
};

const formatAuditPayload = (payload: unknown): string => {
  if (payload === null || payload === undefined) return 'None';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

const attestationStatusGroup = (state: string): AttestationStatusFilter => {
  if (isActiveAttestationState(state)) return 'active';
  if (state === 'confirmed') return 'confirmed';
  if (state.includes('failed')) return 'failed';
  return 'other';
};

const compareAttestations = (
  a: AttestationTableRow,
  b: AttestationTableRow,
  sort: AttestationSort,
): number => {
  let result = 0;
  if (sort.key === 'createdAt' || sort.key === 'confirmedAt') {
    result =
      dateSortValue(a[sort.key]) - dateSortValue(b[sort.key]);
  } else {
    result = a[sort.key].localeCompare(b[sort.key]);
  }
  return sort.direction === 'asc' ? result : -result;
};

const getSubmissionProgress = ({
  expectedCount,
  hashing,
  submitting,
  results,
}: {
  expectedCount: number;
  hashing: boolean;
  submitting: boolean;
  results: AttestationSubmitResult[];
}): SubmissionProgress => {
  if (hashing) {
    return {
      visible: true,
      label: 'Preparing files',
      detail: 'Computing local hashes and content proof before submission.',
      percent: 20,
    };
  }
  if (submitting) {
    const submittedCount = results.length;
    const percent = Math.min(
      70,
      35 + Math.round((submittedCount / Math.max(1, expectedCount)) * 35),
    );
    return {
      visible: true,
      label: 'Submitting attestation',
      detail:
        expectedCount > 1
          ? `${submittedCount} of ${expectedCount} records submitted.`
          : 'Creating the attestation record.',
      percent,
    };
  }
  const successful = results.filter(
    (result): result is AttestationSubmitSuccess => result.ok,
  );
  if (successful.length === 0) {
    return {
      visible: false,
      label: '',
      detail: '',
      percent: 0,
    };
  }
  const confirmed = successful.filter((result) => result.state === 'confirmed');
  if (confirmed.length === successful.length) {
    return {
      visible: true,
      label: 'Confirmed',
      detail: 'Opening the attestation detail.',
      percent: 100,
    };
  }
  const percent = Math.min(
    95,
    75 + Math.round((confirmed.length / Math.max(1, successful.length)) * 20),
  );
  return {
    visible: true,
    label: 'Waiting for confirmation',
    detail:
      successful.length > 1
        ? `${confirmed.length} of ${successful.length} records confirmed.`
        : 'The worker is validating the record and preparing receipt artifacts.',
    percent,
  };
};

const getSubmissionBatchSummary = ({
  expectedCount,
  fileCount,
  hashMode,
  hashing,
  submitting,
  results,
}: {
  expectedCount: number;
  fileCount: number;
  hashMode: HashMode;
  hashing: boolean;
  submitting: boolean;
  results: AttestationSubmitResult[];
}): SubmissionBatchSummary => {
  if (expectedCount === 0 && results.length === 0) {
    return { visible: false, items: [] };
  }
  const successful = results.filter(
    (result): result is AttestationSubmitSuccess => result.ok,
  );
  const failed = results.filter((result) => !result.ok).length;
  const confirmed = successful.filter(
    (result) => result.state === 'confirmed',
  ).length;
  const prepared =
    (hashMode === 'file' || hashMode === 'google_drive') && !hashing
      ? fileCount
      : hashMode === 'external' && expectedCount > 0
        ? expectedCount
        : 0;
  return {
    visible: hashing || submitting || results.length > 0,
    items: [
      { label: 'Prepared', value: `${prepared} / ${expectedCount}` },
      { label: 'Submitted', value: `${results.length} / ${expectedCount}` },
      { label: 'Confirmed', value: `${confirmed} / ${successful.length}` },
      { label: 'Failed', value: String(failed) },
    ],
  };
};

const compareProjects = (
  a: {
    name: string;
    archivedAt: string | null;
  },
  b: {
    name: string;
    archivedAt: string | null;
  },
  sort: ProjectSort,
): number => {
  const projectValue = (project: typeof a): string => {
    if (sort.key === 'status') return project.archivedAt ? 'archived' : 'active';
    return project[sort.key];
  };
  const result = projectValue(a).localeCompare(projectValue(b));
  return sort.direction === 'asc' ? result : -result;
};

const compareWorkspaces = (
  a: {
    id: string;
    name: string;
    role: string;
    archivedAt?: string | null;
  },
  b: {
    id: string;
    name: string;
    role: string;
    archivedAt?: string | null;
  },
  sort: WorkspaceSort,
  activeWorkspaceId?: string,
): number => {
  let result = 0;
  if (sort.key === 'status') {
    const statusValue = (workspace: typeof a): string =>
      workspace.archivedAt
        ? 'archived'
        : workspace.id === activeWorkspaceId
          ? 'active'
          : 'available';
    result = statusValue(a).localeCompare(statusValue(b));
  } else if (sort.key === 'role') {
    result = roleLabel(a.role).localeCompare(roleLabel(b.role));
  } else {
    result = a.name.localeCompare(b.name);
  }
  return sort.direction === 'asc' ? result : -result;
};

const compareRequests = (
  a: {
    requestedByEmail: string;
    status: string;
    createdAt: string;
    attestation: { label: string };
    project: { name: string };
  },
  b: {
    requestedByEmail: string;
    status: string;
    createdAt: string;
    attestation: { label: string };
    project: { name: string };
  },
  sort: RequestSort,
): number => {
  let result = 0;
  if (sort.key === 'createdAt') {
    result = dateSortValue(a.createdAt) - dateSortValue(b.createdAt);
  } else {
    const requestValue = (request: typeof a): string => {
      if (sort.key === 'verifier') return request.requestedByEmail;
      if (sort.key === 'attestation') return request.attestation.label;
      if (sort.key === 'project') return request.project.name;
      return request.status;
    };
    result = requestValue(a).localeCompare(requestValue(b));
  }
  return sort.direction === 'asc' ? result : -result;
};

const compareMembers = (
  a: {
    email: string;
    displayName: string | null;
    role: string;
    organizationRole: string;
    status: string;
    joinedAt: string;
    workspaces?: Array<{ name: string }>;
  },
  b: {
    email: string;
    displayName: string | null;
    role: string;
    organizationRole: string;
    status: string;
    joinedAt: string;
    workspaces?: Array<{ name: string }>;
  },
  sort: MemberSort,
): number => {
  let result = 0;
  if (sort.key === 'joinedAt') {
    result = dateSortValue(a.joinedAt) - dateSortValue(b.joinedAt);
  } else {
    const memberValue = (member: typeof a): string => {
      if (sort.key === 'user') {
        return `${member.displayName ?? ''} ${member.email}`.trim();
      }
      if (sort.key === 'role') return roleLabel(member.role);
      if (sort.key === 'status') return member.status;
      if (sort.key === 'workspaces') {
        return workspaceMembershipLabel(member.workspaces);
      }
      return organizationRoleLabel(member.organizationRole);
    };
    result = memberValue(a).localeCompare(memberValue(b));
  }
  return sort.direction === 'asc' ? result : -result;
};

const compareEvents = (
  a: {
    action: string;
    category: string;
    targetType: string | null;
    targetId: string | null;
    actorEmail: string | null;
    actorUserId: string | null;
    actorDeviceId: string | null;
    createdAt: string;
  },
  b: {
    action: string;
    category: string;
    targetType: string | null;
    targetId: string | null;
    actorEmail: string | null;
    actorUserId: string | null;
    actorDeviceId: string | null;
    createdAt: string;
  },
  sort: EventSort,
): number => {
  let result = 0;
  if (sort.key === 'createdAt') {
    result = dateSortValue(a.createdAt) - dateSortValue(b.createdAt);
  } else {
    const eventValue = (event: typeof a): string => {
      if (sort.key === 'action') return auditActionLabel(event.action);
      if (sort.key === 'actor') return auditActorLabel(event);
      if (sort.key === 'target') return `${event.targetType ?? ''} ${event.targetId ?? ''}`;
      return event.category;
    };
    result = eventValue(a).localeCompare(eventValue(b));
  }
  return sort.direction === 'asc' ? result : -result;
};

const compareVerifierGrants = (
  a: {
    id: string;
    grantedToEmail: string;
    pending: boolean;
    createdAt: string;
  },
  b: {
    id: string;
    grantedToEmail: string;
    pending: boolean;
    createdAt: string;
  },
  sort: VerifierSort,
): number => {
  let result = 0;
  if (sort.key === 'createdAt') {
    result = dateSortValue(a.createdAt) - dateSortValue(b.createdAt);
  } else {
    const value = (grant: typeof a): string => {
      if (sort.key === 'email') return grant.grantedToEmail;
      if (sort.key === 'status') return grant.pending ? 'pending' : 'claimed';
      return grant.createdAt;
    };
    result = value(a).localeCompare(value(b));
  }
  return sort.direction === 'asc' ? result : -result;
};

const resizeTableColumn = <TKey extends string>(
  setWidths: Dispatch<SetStateAction<Record<TKey, number>>>,
  minWidths: Record<TKey, number>,
  key: TKey,
  deltaX: number,
): void => {
  setWidths((current) => ({
    ...current,
    [key]: Math.max(minWidths[key], current[key] + deltaX),
  }));
};

const downloadTextFile = (
  filename: string,
  body: string,
  contentType: string,
): void => {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const dateSortValue = (value: string | null): number =>
  value ? Date.parse(value) : 0;

const HEX64 = /^[0-9a-f]{64}$/;

const parseGoogleDriveFileId = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const idParam = url.searchParams.get('id');
    if (idParam) return idParam;
    const filePathMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    if (filePathMatch?.[1]) return filePathMatch[1];
  } catch {
    // Raw Google Drive file IDs are accepted below.
  }
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : '';
};

const isActiveAttestationState = (state: string): boolean =>
  ['pending', 'uploaded', 'validating'].includes(state);

const statusClass = (state: string): string => {
  if (state === 'confirmed' || state === 'validated' || state === 'connected') {
    return 'border-[#15803D] bg-[#F0FDF4] text-[#166534]';
  }
  if (state === 'failed_needs_review' || state === 'failed') {
    return 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]';
  }
  if (state === 'revoked' || state === 'disconnected') {
    return 'border-neutral-300 bg-neutral-100 text-neutral-500';
  }
  if (isActiveAttestationState(state)) {
    return 'border-[#A16207] bg-[#FEFCE8] text-[#854D0E]';
  }
  return 'border-[var(--color-border)] bg-white text-neutral-700';
};
