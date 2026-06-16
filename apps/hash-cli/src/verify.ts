// `proveria-hash verify <result-package.json>` — math-only re-verification
// of a lookup result package. This is the consumer-side answer to the
// Free-tier "self-verifiable" promise (docs/v1 §17.2): given the JSON the
// verifier client handed them and nothing else, anyone can prove the result is
// internally consistent.
//
// Strictly local — no network. Signature verification is optional and
// requires the caller to supply a public key (--public-key); the CLI does
// not fetch one out-of-band.

import { readFile } from 'node:fs/promises';

import {
  NO_MATCH_STATEMENT,
  verifyMatchProof,
  verifyResultPackage,
  type ResultPackage,
} from '@proveria/proofs';

import type { VerifyRecord } from './output.js';

export interface VerifyOptions {
  /** base64url-encoded Ed25519 public key to check signatures against. */
  proveriaPublicKey?: string;
}

export const verifyPackageFile = async (
  path: string,
  options: VerifyOptions = {},
): Promise<VerifyRecord> => {
  const text = await readFile(path, 'utf8');
  let pkg: ResultPackage;
  try {
    pkg = JSON.parse(text) as ResultPackage;
  } catch (err) {
    throw new Error(`could not parse JSON: ${(err as Error).message}`);
  }

  const notes: string[] = [];
  let proofOk = false;
  let noMatchStatementOk: boolean | undefined;

  if (pkg.result_type === 'match') {
    proofOk = verifyMatchProof(pkg);
    notes.push(
      proofOk
        ? 'match proof reproduces leaf_id and walks to merkle_root'
        : 'match proof failed: leaf_id or merkle_root mismatch',
    );
  } else if (pkg.result_type === 'no_match') {
    noMatchStatementOk = pkg.no_match_statement === NO_MATCH_STATEMENT;
    // For no_match there's no Merkle proof to walk — "the package is
    // internally consistent" reduces to the §9.3 verbatim statement.
    proofOk = noMatchStatementOk;
    notes.push(
      noMatchStatementOk
        ? 'no_match_statement is the exact §9.3 wording'
        : 'no_match_statement does NOT match the §9.3 wording',
    );
  } else {
    notes.push(
      `unknown result_type=${(pkg as { result_type: string }).result_type}`,
    );
  }

  // Signature handling — packages are self-verifiable by default. Optional
  // external/legacy signatures are only verifiable with a supplied public key.
  const hasSignatures = pkg.signatures.length > 0;
  let signatureVerified: boolean | null = null;
  if (hasSignatures) {
    if (options.proveriaPublicKey) {
      signatureVerified = await verifyResultPackage(
        pkg,
        options.proveriaPublicKey,
      );
      notes.push(
        signatureVerified
          ? 'package signature verified against supplied public key'
          : 'package signature FAILED to verify against supplied public key',
      );
    } else {
      notes.push('package is signed — pass --public-key to verify');
    }
  } else {
    notes.push('package is unsigned (Free tier — self-verifiable by math)');
  }

  const record: VerifyRecord = {
    kind: 'verify',
    package_id: pkg.package_id,
    result_type: pkg.result_type,
    proof_ok: proofOk,
    signature_required: hasSignatures,
    signature_verified: signatureVerified,
    notes,
  };
  if (noMatchStatementOk !== undefined) {
    record.no_match_statement_ok = noMatchStatementOk;
  }
  return record;
};
