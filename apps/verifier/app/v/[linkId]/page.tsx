'use client';

// Universal verification page (docs/v1 §18.4) — what the QR code embedded
// in every PDF points at. Public, unauthenticated: anyone with the link id
// sees the underlying signed artifact (receipt or lookup result).

import {
  Card,
  Container,
  Eyebrow,
  Header,
  Mono,
  StatusBadge,
} from '@proveria/ui';
import { use, useEffect, useState } from 'react';

import {
  api,
  downloadJsonArtifact,
  downloadVerificationPdf,
  type AttestationReceipt,
  type LookupResultPackage,
  type ResolvedLink,
} from '../../../lib/api';

interface PageProps {
  params: Promise<{ linkId: string }>;
}

export default function VerificationLinkPage({
  params,
}: PageProps): React.JSX.Element {
  const { linkId } = use(params);
  const [resolved, setResolved] = useState<ResolvedLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'expired' | 'unavailable' | null>(
    null,
  );
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .resolveLink(linkId)
      .then((r) => {
        if (alive) setResolved(r);
      })
      .catch((err: { status?: number; body?: { error?: string } }) => {
        if (!alive) return;
        if (err.status === 410) {
          setErrorKind('expired');
          setError('This verification link has expired.');
          return;
        }
        if (err.status === 404) {
          setErrorKind('unavailable');
          setError('This verification link is no longer available.');
          return;
        }
        setError('Could not load the verification link.');
      });
    return () => {
      alive = false;
    };
  }, [linkId]);

  const downloadPdf = async (): Promise<void> => {
    setPdfError(null);
    setPdfBusy(true);
    try {
      await downloadVerificationPdf(linkId);
    } catch (err) {
      setPdfError((err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <Header />
      <Container className="py-12 sm:py-16">
        {error ? (
          <>
            <Eyebrow>Verification</Eyebrow>
            <h1 className="mt-2 text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
              {errorKind === 'expired'
                ? 'Link expired'
                : errorKind === 'unavailable'
                  ? 'Link unavailable'
                  : 'Could not load'}
            </h1>
            <p className="mt-4 max-w-[640px] text-[16px] text-neutral-700">
              {error}
            </p>
            {errorKind === 'expired' && (
              <p className="mt-3 text-[14px] text-neutral-500">
                The underlying signed package may still be valid. Ask the
                producer for a fresh verification link.
              </p>
            )}
          </>
        ) : !resolved ? (
          <p className="mt-12 text-[14px] text-neutral-500">Loading…</p>
        ) : resolved.targetType === 'receipt' ? (
          <ReceiptView
            receipt={resolved.payload as AttestationReceipt}
            link={resolved.link}
            signatureValid={resolved.signatureValid}
            linkId={linkId}
            downloadPdf={downloadPdf}
            pdfBusy={pdfBusy}
            pdfError={pdfError}
          />
        ) : (
          <ResultView
            pkg={resolved.payload as LookupResultPackage}
            link={resolved.link}
            signed={resolved.signed}
            signatureValid={resolved.signatureValid}
            linkId={linkId}
            downloadPdf={downloadPdf}
            pdfBusy={pdfBusy}
            pdfError={pdfError}
          />
        )}
      </Container>
    </>
  );
}

function PdfBar({
  downloadPdf,
  pdfBusy,
  pdfError,
  linkId,
  payload,
}: {
  downloadPdf: () => Promise<void>;
  pdfBusy: boolean;
  pdfError: string | null;
  linkId: string;
  payload: AttestationReceipt | LookupResultPackage;
}): React.JSX.Element {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <button
        type="button"
        onClick={downloadPdf}
        disabled={pdfBusy}
        className="text-[14px] text-[var(--color-accent)] hover:underline disabled:opacity-50"
      >
        {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
      </button>
      <button
        type="button"
        onClick={() => downloadJsonArtifact(payload)}
        className="text-[14px] text-[var(--color-accent)] hover:underline"
      >
        Download JSON
      </button>
      <span className="text-[13px] text-neutral-500">
        reference <Mono>{linkId}</Mono>
      </span>
      {pdfError && (
        <p className="basis-full text-[14px] text-neutral-900">{pdfError}</p>
      )}
    </div>
  );
}

function ReceiptView({
  receipt,
  link,
  signatureValid,
  linkId,
  downloadPdf,
  pdfBusy,
  pdfError,
}: {
  receipt: AttestationReceipt;
  link: ResolvedLink['link'];
  signatureValid: boolean | null;
  linkId: string;
  downloadPdf: () => Promise<void>;
  pdfBusy: boolean;
  pdfError: string | null;
}): React.JSX.Element {
  return (
    <>
      <Eyebrow>Attestation receipt</Eyebrow>
      <h1 className="mt-2 break-words text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
        {receipt.attestation_label}
      </h1>
      <div className="mt-3">
        <StatusBadge kind={signatureValid ? 'done' : 'failed'}>
          {signatureValid ? 'verified' : 'INVALID — signature does not match'}
        </StatusBadge>
      </div>
      <PdfBar
        downloadPdf={downloadPdf}
        pdfBusy={pdfBusy}
        pdfError={pdfError}
        linkId={linkId}
        payload={receipt}
      />
      <Card className="mt-8" padding="6">
        <dl className="space-y-4">
          <LinkMetadataRows link={link} packageId={receipt.package_id} />
          <div>
            <dt className="text-[13px] text-neutral-500">Merkle root</dt>
            <dd className="mt-1 break-all">
              <Mono>{receipt.merkle_root}</Mono>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-neutral-500">
              Manifest canonical SHA-256
            </dt>
            <dd className="mt-1 break-all">
              <Mono>{receipt.manifest_canonical_sha256}</Mono>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-neutral-500">Coverage</dt>
            <dd className="mt-1 text-[15px] text-neutral-800">
              {receipt.leaf_counts.file} whole-file hash
              {receipt.leaf_counts.file === 1 ? '' : 'es'}
              {receipt.leaf_counts.shingle > 0
                ? ` · ${receipt.leaf_counts.shingle} text content proof hash${
                    receipt.leaf_counts.shingle === 1 ? '' : 'es'
                  }`
                : ''}
              {receipt.leaf_counts.component > 0
                ? ` · ${receipt.leaf_counts.component} exact image proof hash${
                    receipt.leaf_counts.component === 1 ? '' : 'es'
                  }`
                : ''}
            </dd>
          </div>
          {(receipt.extraction_methods?.length ?? 0) > 0 && (
            <div>
              <dt className="text-[13px] text-neutral-500">
                Text extraction
              </dt>
              <dd className="mt-1 text-[15px] text-neutral-800">
                {receipt.extraction_methods
                  ?.map(extractionMethodLabel)
                  .join(', ')}
              </dd>
            </div>
          )}
          {(receipt.component_methods?.length ?? 0) > 0 && (
            <div>
              <dt className="text-[13px] text-neutral-500">Image proof</dt>
              <dd className="mt-1 text-[15px] text-neutral-800">
                {receipt.component_methods?.map(componentMethodLabel).join(', ')}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[13px] text-neutral-500">Confirmed</dt>
            <dd className="mt-1 text-[15px] text-neutral-800">
              {new Date(receipt.confirmed_at).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-neutral-500">
              Producer device signature
            </dt>
            <dd className="mt-1 text-[15px] text-neutral-800">
              {receipt.device_signature.verified ? 'Verified' : 'Not verified'}
            </dd>
          </div>
        </dl>
        <JsonPreview title="Receipt JSON" payload={receipt} />
      </Card>
    </>
  );
}

function ResultView({
  pkg,
  link,
  signed,
  signatureValid,
  linkId,
  downloadPdf,
  pdfBusy,
  pdfError,
}: {
  pkg: LookupResultPackage;
  link: ResolvedLink['link'];
  signed: boolean;
  signatureValid: boolean | null;
  linkId: string;
  downloadPdf: () => Promise<void>;
  pdfBusy: boolean;
  pdfError: string | null;
}): React.JSX.Element {
  const integrityKind: 'done' | 'failed' = 'done';
  const integrityLabel = 'self-verifiable';
  const isContentMatch =
    pkg.result_type === 'match' &&
    pkg.match?.leaf_type === 'shingle/sha256/v1';
  const isOcrContentMatch =
    isContentMatch &&
    pkg.match?.source_extraction_method === 'ocr-tesseract/v1';
  const isExactImageMatch =
    pkg.result_type === 'match' &&
    pkg.match?.leaf_type === 'component/sha256/v1' &&
    pkg.match?.component_method === 'exact-image-sha256/v1';
  const matchStatement = isContentMatch
    ? CONTENT_MATCH_RESULT_STATEMENT
    : isExactImageMatch
      ? EXACT_IMAGE_MATCH_RESULT_STATEMENT
    : MATCH_RESULT_STATEMENT;
  return (
    <>
      <Eyebrow>Verification result</Eyebrow>
      <h1 className="mt-2 text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
        {pkg.result_type === 'match'
          ? isOcrContentMatch
            ? 'OCR content match'
            : isExactImageMatch
              ? 'Exact image match'
            : isContentMatch
              ? 'Content match'
            : 'Whole-file match'
          : 'No match'}
      </h1>
      <p className="mt-3 break-words text-[16px] text-neutral-700">
        for attestation{' '}
        <span className="font-medium">{pkg.attestation.label}</span>
      </p>
      <p className="mt-3 max-w-[760px] text-[14px] leading-6 text-neutral-600">
        {pkg.result_type === 'match'
          ? isOcrContentMatch
            ? 'This signed result says the checked passage matched OCR text coverage committed for this attestation. The source passage itself is not included in this package.'
            : isExactImageMatch
              ? 'This signed result says the checked PNG/JPEG image exactly matched image coverage committed for this attestation.'
            : isContentMatch
              ? 'This signed result says the checked passage matched text coverage committed for this attestation. The source passage itself is not included in this package.'
            : 'This signed result says the checked whole-file SHA-256 matched coverage committed for this attestation.'
          : 'This signed result says the checked item was not found in this specific attestation at lookup time.'}
      </p>
      <div className="mt-3">
        <StatusBadge kind={integrityKind}>{integrityLabel}</StatusBadge>
      </div>
      <PdfBar
        downloadPdf={downloadPdf}
        pdfBusy={pdfBusy}
        pdfError={pdfError}
        linkId={linkId}
        payload={pkg}
      />
      <Card className="mt-8" padding="6">
        <dl className="space-y-4">
          <LinkMetadataRows link={link} packageId={pkg.package_id} />
          <div>
            <dt className="text-[13px] text-neutral-500">
              {isContentMatch
                ? 'Matched content proof hash'
                : isExactImageMatch
                  ? 'Matched exact image proof hash'
                  : 'Submitted hash'}{' '}
              ({pkg.hash_algorithm})
            </dt>
            <dd className="mt-1 break-all">
              <Mono>{pkg.submitted_hash}</Mono>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-neutral-500">Merkle root</dt>
            <dd className="mt-1 break-all">
              <Mono>{pkg.attestation.merkle_root}</Mono>
            </dd>
          </div>
          {pkg.result_type === 'no_match' && pkg.no_match_statement && (
            <div>
              <dt className="text-[13px] text-neutral-500">Statement</dt>
              <dd className="mt-1 text-[15px] italic text-neutral-800">
                &ldquo;{pkg.no_match_statement}&rdquo;
              </dd>
              <p className="mt-2 text-[13px] leading-6 text-neutral-500">
                This is scoped to the attestation named above. It is not a
                statement about other attestations, other projects, or material
                the producer did not commit.
              </p>
            </div>
          )}
          {pkg.result_type === 'match' && pkg.match && (
            <>
              <div>
                <dt className="text-[13px] text-neutral-500">Statement</dt>
                <dd className="mt-1 text-[15px] italic text-neutral-800">
                  &ldquo;{matchStatement}&rdquo;
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-neutral-500">
                  Matched proof type
                </dt>
                <dd className="mt-1 break-all">
                  <Mono>{matchProofLabel(pkg.match)}</Mono>
                </dd>
              </div>
              {pkg.match.source_extraction_method && (
                <div>
                  <dt className="text-[13px] text-neutral-500">
                    Extraction method
                  </dt>
                  <dd className="mt-1 break-all">
                    <Mono>
                      {extractionMethodLabel(pkg.match.source_extraction_method)}
                    </Mono>
                  </dd>
                </div>
              )}
              {pkg.match.component_method && (
                <div>
                  <dt className="text-[13px] text-neutral-500">
                    Image proof
                  </dt>
                  <dd className="mt-1 break-all">
                    <Mono>{componentMethodLabel(pkg.match.component_method)}</Mono>
                  </dd>
                </div>
              )}
              {pkg.match.media_type && (
                <div>
                  <dt className="text-[13px] text-neutral-500">
                    Image format
                  </dt>
                  <dd className="mt-1 break-all">
                    <Mono>{imageMediaTypeLabel(pkg.match.media_type)}</Mono>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[13px] text-neutral-500">Matched leaf</dt>
                <dd className="mt-1 break-all">
                  <Mono>{pkg.match.leaf_id}</Mono>
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-neutral-500">Proof depth</dt>
                <dd className="mt-1 text-[15px] text-neutral-800">
                  {pkg.match.proof_path.length} step
                  {pkg.match.proof_path.length === 1 ? '' : 's'} from leaf to root
                </dd>
              </div>
            </>
          )}
          <SignatureRows
            signatures={pkg.signatures}
            signatureValid={signatureValid}
            unsignedLabel="No platform attestor"
          />
        </dl>
        <JsonPreview title="Result package JSON" payload={pkg} />
      </Card>
    </>
  );
}

const MATCH_RESULT_STATEMENT =
  "This submitted hash was present in this specific attestation's committed proof set.";

const CONTENT_MATCH_RESULT_STATEMENT =
  "This matched content proof hash was present in this specific attestation's committed proof set.";

const EXACT_IMAGE_MATCH_RESULT_STATEMENT =
  "This exact image proof hash was present in this specific attestation's committed proof set.";

const leafTypeLabel = (leafType: string): string => {
  if (leafType === 'file/sha256/v1') return 'Whole-file SHA-256';
  if (leafType === 'shingle/sha256/v1') return 'Text content proof';
  if (leafType === 'component/sha256/v1') return 'Component proof';
  return leafType;
};

const matchProofLabel = (match: NonNullable<LookupResultPackage['match']>): string => {
  if (
    match.leaf_type === 'shingle/sha256/v1' &&
    match.source_extraction_method === 'ocr-tesseract/v1'
  ) {
    return 'OCR text content proof';
  }
  if (
    match.leaf_type === 'component/sha256/v1' &&
    match.component_method === 'exact-image-sha256/v1'
  ) {
    return 'Exact image proof';
  }
  return leafTypeLabel(match.leaf_type);
};

const extractionMethodLabel = (method: string): string => {
  if (method === 'plain-text/v1') return 'Plain text';
  if (method === 'pdf-text-layer/v1') return 'Native PDF text';
  if (method === 'ocr-tesseract/v1') return 'OCR text';
  return method;
};

const componentMethodLabel = (method: string): string => {
  if (method === 'exact-image-sha256/v1') return 'Exact image SHA-256';
  return method;
};

const imageMediaTypeLabel = (mediaType: string): string => {
  if (mediaType === 'image/png') return 'PNG';
  if (mediaType === 'image/jpeg') return 'JPEG';
  return mediaType;
};

function LinkMetadataRows({
  link,
  packageId,
}: {
  link: ResolvedLink['link'];
  packageId: string;
}): React.JSX.Element {
  return (
    <>
      <div>
        <dt className="text-[13px] text-neutral-500">Package id</dt>
        <dd className="mt-1 break-all">
          <Mono>{packageId}</Mono>
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-neutral-500">Link issued</dt>
        <dd className="mt-1 text-[15px] text-neutral-800">
          {new Date(link.createdAt).toLocaleString()}
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-neutral-500">Link expires</dt>
        <dd className="mt-1 text-[15px] text-neutral-800">
          {link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never'}
        </dd>
      </div>
    </>
  );
}

function SignatureRows({
  signatures,
  signatureValid,
  unsignedLabel = 'Unsigned',
}: {
  signatures: Array<{
    signer_kind: string;
    key_id: string;
    algorithm: string;
    signature: string;
  }>;
  signatureValid: boolean | null;
  unsignedLabel?: string;
}): React.JSX.Element {
  if (signatures.length === 0) {
    return (
      <div>
        <dt className="text-[13px] text-neutral-500">Platform attestor</dt>
        <dd className="mt-1 text-[15px] text-neutral-800">{unsignedLabel}</dd>
      </div>
    );
  }

  return (
    <>
      <div>
        <dt className="text-[13px] text-neutral-500">Signature check</dt>
        <dd className="mt-1 text-[15px] text-neutral-800">
          {signatureValid ? 'Valid' : 'Invalid'}
        </dd>
      </div>
      {signatures.map((sig) => (
        <div key={`${sig.signer_kind}:${sig.key_id}`}>
          <dt className="text-[13px] text-neutral-500">
            Signature ({sig.signer_kind})
          </dt>
          <dd className="mt-1 break-all text-[15px] text-neutral-800">
            <Mono>{sig.algorithm}</Mono> · key <Mono>{sig.key_id}</Mono>
          </dd>
        </div>
      ))}
    </>
  );
}

function JsonPreview({
  title,
  payload,
}: {
  title: string;
  payload: AttestationReceipt | LookupResultPackage;
}): React.JSX.Element {
  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => downloadJsonArtifact(payload)}
          className="border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-neutral-700 hover:border-neutral-700"
        >
          Download JSON
        </button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[14px] text-[var(--color-accent)] hover:underline">
          Show JSON artifact
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto border border-[var(--color-border)] bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-700">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
