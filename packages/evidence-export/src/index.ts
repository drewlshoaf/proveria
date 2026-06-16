export interface EvidenceExportBundleArtifact {
  path: string;
  objectKey: string;
  contentType: string;
  encoding: 'base64';
  byteSize: number;
  bodyBase64: string;
}

export interface EvidenceExportBundleMissingArtifact {
  path: string;
  objectKey: string;
  reason: 'not_found';
}

export interface EvidenceExportBundle {
  schemaVersion: '1.0';
  type: 'proveria_evidence_bundle';
  generatedAt: string;
  manifest: unknown;
  artifacts: EvidenceExportBundleArtifact[];
  missingArtifacts: EvidenceExportBundleMissingArtifact[];
  counts: {
    artifacts: number;
    missingArtifacts: number;
  };
}

type ArtifactContainer = {
  id?: unknown;
  packageId?: unknown;
  artifacts?: unknown;
};

type ArtifactRef = {
  path: string;
  objectKey: string;
};

const artifactContentType = (objectKey: string): string => {
  if (objectKey.endsWith('.pdf')) return 'application/pdf';
  if (objectKey.endsWith('.json') || objectKey.endsWith('.jsonl')) {
    return 'application/json';
  }
  return 'application/octet-stream';
};

const safeSegment = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
};

const artifactLabel = (key: string): string => {
  switch (key) {
    case 'manifest':
      return 'manifest.json';
    case 'leaves':
      return 'leaves.jsonl';
    case 'receiptJson':
      return 'receipt.json';
    case 'receiptPdf':
      return 'receipt.pdf';
    case 'validationResult':
      return 'validation-result.json';
    case 'resultJson':
      return 'result.json';
    default:
      return `${safeSegment(key, 'artifact')}.bin`;
  }
};

const artifactRefsFrom = (
  collection: unknown,
  prefix: string,
  idFallback: string,
): ArtifactRef[] => {
  if (!Array.isArray(collection)) return [];
  return collection.flatMap((item, index) => {
    const row = item as ArtifactContainer;
    const artifacts =
      row.artifacts && typeof row.artifacts === 'object'
        ? (row.artifacts as Record<string, unknown>)
        : {};
    const id = safeSegment(row.id ?? row.packageId, `${idFallback}-${index + 1}`);
    return Object.entries(artifacts).flatMap(([name, objectKey]) => {
      if (typeof objectKey !== 'string' || objectKey.length === 0) return [];
      return [
        {
          path: `${prefix}/${id}/${artifactLabel(name)}`,
          objectKey,
        },
      ];
    });
  });
};

export const evidenceExportBundleKey = (
  tenantId: string,
  jobId: string,
): string => `tenants/${tenantId}/evidence-exports/${jobId}/bundle.json`;

export const buildEvidenceExportBundle = async ({
  manifest,
  getObjectBytes,
}: {
  manifest: unknown;
  getObjectBytes: (objectKey: string) => Promise<Buffer | null>;
}): Promise<EvidenceExportBundle> => {
  const root =
    manifest && typeof manifest === 'object'
      ? (manifest as Record<string, unknown>)
      : {};
  const refs: ArtifactRef[] = [
    ...artifactRefsFrom(root.attestations, 'attestations', 'attestation'),
    ...artifactRefsFrom(root.attempts, 'attempts', 'attempt'),
    ...artifactRefsFrom(
      root.verificationResults,
      'verification-results',
      'verification-result',
    ),
  ];

  const artifacts: EvidenceExportBundleArtifact[] = [];
  const missingArtifacts: EvidenceExportBundleMissingArtifact[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const dedupeKey = `${ref.path}\0${ref.objectKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const bytes = await getObjectBytes(ref.objectKey);
    if (!bytes) {
      missingArtifacts.push({
        path: ref.path,
        objectKey: ref.objectKey,
        reason: 'not_found',
      });
      continue;
    }
    artifacts.push({
      path: ref.path,
      objectKey: ref.objectKey,
      contentType: artifactContentType(ref.objectKey),
      encoding: 'base64',
      byteSize: bytes.byteLength,
      bodyBase64: bytes.toString('base64'),
    });
  }

  return {
    schemaVersion: '1.0',
    type: 'proveria_evidence_bundle',
    generatedAt: new Date().toISOString(),
    manifest,
    artifacts,
    missingArtifacts,
    counts: {
      artifacts: artifacts.length,
      missingArtifacts: missingArtifacts.length,
    },
  };
};
