// buildAttestationReceipt — assembles an unsigned receipt from confirmation
// inputs. The worker calls this at confirmation time, then signReceipt().

import {
  RECEIPT_V1_VERSION,
  type AttestationReceipt,
  type ReceiptDeviceSignatureStatus,
  type ReceiptLeafCounts,
} from './types.js';

export interface BuildAttestationReceiptInput {
  packageId: string;
  tenantId: string;
  projectId: string;
  attestationId: string;
  attestationLabel: string;
  confirmedAttemptId: string;
  manifestObjectKey: string;
  manifestCanonicalSha256: string;
  merkleRoot: string;
  leafCounts: ReceiptLeafCounts;
  /** Source extraction methods present across shingle leaves; sorted + deduped. */
  extractionMethods?: string[];
  /** Component proof methods present across component leaves; sorted + deduped. */
  componentMethods?: string[];
  hashAlgorithm: string;
  protocolVersion: string;
  deviceSignature: ReceiptDeviceSignatureStatus;
  confirmedAt: string;
  issuedAt: string;
}

/** Build the unsigned V1 attestation receipt. signatures is []; sign next. */
export const buildAttestationReceipt = (
  input: BuildAttestationReceiptInput,
): AttestationReceipt => ({
  receipt_version: RECEIPT_V1_VERSION,
  receipt_type: 'attestation',
  package_id: input.packageId,
  tenant_id: input.tenantId,
  project_id: input.projectId,
  attestation_id: input.attestationId,
  attestation_label: input.attestationLabel,
  confirmed_attempt_id: input.confirmedAttemptId,
  manifest_object_key: input.manifestObjectKey,
  manifest_canonical_sha256: input.manifestCanonicalSha256,
  merkle_root: input.merkleRoot,
  leaf_counts: input.leafCounts,
  extraction_methods: [...(input.extractionMethods ?? [])].sort(),
  component_methods: [...(input.componentMethods ?? [])].sort(),
  hash_algorithm: input.hashAlgorithm,
  protocol_version: input.protocolVersion,
  device_signature: input.deviceSignature,
  confirmed_at: input.confirmedAt,
  issued_at: input.issuedAt,
  signatures: [],
});
