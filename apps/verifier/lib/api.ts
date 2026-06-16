// Browser-side fetch wrapper for the thin verifier app. The app only speaks
// session-cookie consumer APIs and public verification-link APIs.

export interface ApiError {
  status: number;
  body: unknown;
}

const request = async <T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const err: ApiError = { status: res.status, body: parsed };
    throw err;
  }
  return parsed as T;
};

export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    emailVerifiedAt: string | null;
    createdAt: string;
  };
  memberships: Array<{
    tenantId: string;
    slug: string;
    plan: string;
    name: string;
    role: string;
  }>;
}

export interface AttestationAccessGrant {
  grantId: string;
  grantedAt: string;
  attestation: {
    id: string;
    label: string;
    state: string;
    confirmedAt: string | null;
  };
  project: { slug: string; name: string };
  tenant: { slug: string; name: string };
}

export interface PreLookupMetadata {
  attestation: {
    id: string;
    label: string;
    confirmedAt: string | null;
    coverageType: string;
    shinglingPresets: string[];
    extractionMethods: string[];
    hashAlgorithm: string;
    hashAlgorithmVersion: string;
    signatureStatus: string;
    blockchainAnchoring: string;
  };
  project: { slug: string; name: string };
  tenant: { slug: string; name: string };
}

export interface LookupResultPackage {
  schema_version: string;
  protocol_version: string;
  package_id: string;
  result_type: 'match' | 'no_match';
  submitted_hash: string;
  hash_algorithm: string;
  lookup_scope: {
    tenant_id: string;
    project_id: string;
    attestation_id: string;
  };
  attestation: {
    label: string;
    confirmed_at: string;
    merkle_root: string;
    protocol_version: string;
  };
  match: {
    leaf_id: string;
    leaf_type: string;
    source_extraction_method?: string;
    preset?: string;
    source_index?: number;
    component_method?: string;
    media_type?: string;
    proof_path: Array<{ sibling: string; position: 'left' | 'right' }>;
  } | null;
  no_match_statement: string | null;
  signatures: Array<{
    signer_kind: string;
    key_id: string;
    algorithm: string;
    signature: string;
  }>;
  created_at: string;
}

export interface AttestationReceipt {
  receipt_version: string;
  receipt_type: string;
  package_id: string;
  attestation_id: string;
  attestation_label: string;
  merkle_root: string;
  manifest_canonical_sha256: string;
  leaf_counts: { file: number; shingle: number; component: number };
  extraction_methods?: string[];
  component_methods?: string[];
  hash_algorithm: string;
  protocol_version: string;
  device_signature: { key_id: string; algorithm: string; verified: boolean };
  confirmed_at: string;
  issued_at: string;
  signatures: Array<{
    signer_kind: string;
    key_id: string;
    algorithm: string;
    signature: string;
  }>;
}

export interface ResolvedLink {
  link: { id: string; createdAt: string; expiresAt: string | null };
  targetType: 'receipt' | 'lookup_result';
  payload: AttestationReceipt | LookupResultPackage;
  signed: boolean;
  signatureValid: boolean | null;
}

export interface LookupResponse {
  package: LookupResultPackage;
  packageId: string;
  linkId: string;
  signed: boolean;
  retrieveUrl: string;
  verificationUrl: string;
}

export interface AttestationAccessRequestResponse {
  request: {
    id?: string;
    status: 'received' | 'granted' | 'pending' | string;
    createdAt?: string;
    resolvedAt?: string | null;
    resolutionReason?: string | null;
  };
}

export interface AttestationAccessRequestStatusResponse {
  request: AttestationAccessRequestResponse['request'] | null;
}

export const api = {
  me: () => request<MeResponse>('GET', '/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: MeResponse['user'] }>('POST', '/auth/login', {
      email,
      password,
    }),
  logout: () => request<void>('POST', '/auth/logout', {}),
  register: (email: string, password: string, grantToken: string) =>
    request<{
      user: MeResponse['user'];
      tenant: { id: string; slug: string; plan: string } | null;
    }>('POST', '/auth/register', {
      email,
      password,
      grantToken,
    }),
  myAttestationAccess: () =>
    request<{ grants: AttestationAccessGrant[] }>(
      'GET',
      '/me/attestation-access',
    ),
  attestationLookupMetadata: (id: string) =>
    request<PreLookupMetadata>('GET', `/attestations/${id}/lookup`),
  performAttestationLookup: (
    id: string,
    submittedHash: string,
    lookupKind?: 'whole_file' | 'content' | 'exact_image' | 'any',
    candidateHashes?: string[],
  ) =>
    request<LookupResponse>('POST', `/attestations/${id}/lookup`, {
      submittedHash,
      ...(lookupKind ? { lookupKind } : {}),
      ...(candidateHashes && candidateHashes.length > 0
        ? { candidateHashes }
        : {}),
    }),
  requestAttestationAccess: (id: string, message?: string) =>
    request<AttestationAccessRequestResponse>(
      'POST',
      `/attestations/${id}/access-request`,
      message?.trim() ? { message: message.trim() } : {},
    ),
  attestationAccessRequestStatus: (id: string) =>
    request<AttestationAccessRequestStatusResponse>(
      'GET',
      `/attestations/${id}/access-request`,
    ),
  resolveLink: (linkId: string) =>
    request<ResolvedLink>('GET', `/v/${linkId}`),
};

export const downloadVerificationPdf = async (
  linkId: string,
): Promise<void> => {
  const url = `/api/v/${linkId}.pdf`;
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 200) {
      const blob = await res.blob();
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `${linkId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      return;
    }
    if (res.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (res.status === 410) {
      throw new Error('This verification link has expired.');
    }
    if (res.status === 404) {
      throw new Error('This verification link is no longer available.');
    }
    throw new Error(`PDF download failed (${res.status}).`);
  }
  throw new Error('The PDF is still rendering. Please try again in a moment.');
};

export const downloadJsonArtifact = (
  payload: AttestationReceipt | LookupResultPackage,
): void => {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([`${json}\n`], {
    type: 'application/json',
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${payload.package_id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};
