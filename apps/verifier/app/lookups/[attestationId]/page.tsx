'use client';

import {
  Button,
  Card,
  Container,
  Eyebrow,
  Field,
  Header,
  LinkButton,
  MicroLabel,
  Mono,
  TextInput,
} from '@proveria/ui';
import { shinglePlainTextInBrowser } from '@proveria/shingling/browser';
import type {
  ShinglePreset,
  SourceExtractionMethod,
} from '@proveria/shingling';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

import {
  api,
  type ApiError,
  type LookupResponse,
  type LookupResultPackage,
  type PreLookupMetadata,
} from '../../../lib/api';

interface PageProps {
  params: Promise<{ attestationId: string }>;
}

const HEX64 = /^[0-9a-f]{64}$/;

export default function LookupPage({
  params,
}: PageProps): React.JSX.Element {
  const router = useRouter();
  const { attestationId } = use(params);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [meta, setMeta] = useState<PreLookupMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingAccess, setMissingAccess] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [accessRequestMessage, setAccessRequestMessage] = useState<
    string | null
  >(null);
  const [accessRequestStatus, setAccessRequestStatus] = useState<
    string | null
  >(null);
  const [accessRequestResolutionReason, setAccessRequestResolutionReason] =
    useState<string | null>(null);
  const [accessRequestReason, setAccessRequestReason] = useState('');

  const [hash, setHash] = useState('');
  const [hashMode, setHashMode] = useState<
    'file' | 'image' | 'paste' | 'passage'
  >('file');
  const [passageText, setPassageText] = useState('');
  const [passageHashes, setPassageHashes] = useState<PassageHash[]>([]);
  const [passageHashing, setPassageHashing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileHashing, setFileHashing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResultPackage | null>(
    null,
  );
  const [lookupMeta, setLookupMeta] = useState<LookupResponse | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  const resultJson = lookupResult
    ? JSON.stringify(lookupResult, null, 2)
    : null;
  const isContentMatch =
    lookupResult?.result_type === 'match' &&
    lookupResult.match?.leaf_type === 'shingle/sha256/v1';
  const isOcrContentMatch =
    isContentMatch &&
    lookupResult?.match?.source_extraction_method === 'ocr-tesseract/v1';
  const isExactImageMatch =
    lookupResult?.result_type === 'match' &&
    lookupResult.match?.leaf_type === 'component/sha256/v1' &&
    lookupResult.match?.component_method === 'exact-image-sha256/v1';
  const matchStatement = isContentMatch
    ? CONTENT_MATCH_RESULT_STATEMENT
    : isExactImageMatch
      ? EXACT_IMAGE_MATCH_RESULT_STATEMENT
    : MATCH_RESULT_STATEMENT;
  const resultTone =
    lookupResult?.result_type === 'match'
      ? {
          title: isOcrContentMatch
            ? 'OCR content match found'
            : isExactImageMatch
              ? 'Exact image match found'
            : isContentMatch
              ? 'Content match found'
              : 'Whole-file match found',
          body:
            isOcrContentMatch
              ? 'This passage matches OCR text coverage committed by the producer for this attestation. The source passage itself is not sent to Proveria.'
              : isExactImageMatch
              ? 'This PNG/JPEG image exactly matches image coverage committed by the producer for this attestation.'
              : isContentMatch
              ? 'This passage matches text coverage committed by the producer for this attestation. The source passage itself is not sent to Proveria.'
              : 'This file hash matches whole-file coverage committed by the producer for this attestation.',
          className: 'border-[#15803D] bg-[#F0FDF4] text-[#166534]',
        }
      : lookupResult?.result_type === 'no_match'
        ? {
            title: 'No match',
            body:
              hashMode === 'passage'
                ? 'No content match was found for this passage in this attestation. If you copied from the source PDF, try a longer continuous excerpt from the same paragraph.'
                : hashMode === 'image'
                  ? 'No exact image match was found in this attestation. This only means this attestation does not contain that exact PNG/JPEG image.'
                : 'No whole-file match was found for the submitted SHA-256 in this attestation.',
            className: 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]',
          }
        : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (!alive) return;
        setMeEmail(me.user.email);
        const m = await api.attestationLookupMetadata(attestationId);
        if (!alive) return;
        setMeta(m);
        setMissingAccess(false);
      } catch (err) {
        if (!alive) return;
        const status = (err as { status?: number }).status;
        if (status === 401) {
          router.replace(
            `/login?next=${encodeURIComponent(`/lookups/${attestationId}`)}`,
          );
          return;
        }
        if (status === 404) {
          setMissingAccess(true);
          try {
            const statusRes =
              await api.attestationAccessRequestStatus(attestationId);
            if (!alive) return;
            setAccessRequestStatus(statusRes.request?.status ?? null);
            setAccessRequestResolutionReason(
              statusRes.request?.resolutionReason ?? null,
            );
          } catch {
            if (!alive) return;
            setAccessRequestStatus(null);
          }
          setError(
            'This private verifier lookup is not available to your account.',
          );
          return;
        }
        setError('Could not load this attestation.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, attestationId]);

  const requestAccess = async (): Promise<void> => {
    const reason = accessRequestReason.trim();
    if (reason.length < 3) {
      setAccessRequestMessage(
        'Enter a short reason so the producer can decide whether to grant access.',
      );
      return;
    }
    setRequestingAccess(true);
    setAccessRequestMessage(null);
    try {
      const res = await api.requestAttestationAccess(attestationId, reason);
      if (res.request.status === 'granted') {
        setAccessRequestMessage('Access is already active. Reloading...');
        window.location.reload();
        return;
      }
      setAccessRequestStatus(res.request.status);
      setAccessRequestResolutionReason(null);
      setAccessRequestReason('');
      setAccessRequestMessage(
        res.request.status === 'pending'
          ? 'Approval request is pending. This is only needed when the producer sent a link before granting access.'
          : 'Approval request sent. The producer can approve or deny it from the desktop app.',
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      const body = (err as ApiError).body as
        | { error?: string; request?: { resolutionReason?: string | null } }
        | undefined;
      setAccessRequestMessage(
        status === 401
          ? 'Your session expired. Sign in again, then request access.'
          : status === 409 && body?.error === 'access_request_denied_final'
            ? `This approval request was denied and cannot be reconsidered.${
                body.request?.resolutionReason
                  ? ` Reason: ${body.request.resolutionReason}`
                  : ''
              }`
          : 'Could not send the access request. Please try again.',
      );
    } finally {
      setRequestingAccess(false);
    }
  };

  const logout = async (): Promise<void> => {
    await api.logout();
    router.replace('/login');
  };

  const selectFile = async (file: File | null): Promise<void> => {
    setFormError(null);
    setLookupResult(null);
    setLookupMeta(null);
    setLinkMessage(null);
    setHash('');
    setPassageText('');
    setPassageHashes([]);
    if (!file) return;
    setFileHashing(true);
    try {
      setHash(await sha256FileHex(file));
    } catch {
      setFormError('Could not hash that file in this browser.');
    } finally {
      setFileHashing(false);
    }
  };

  const selectImage = async (file: File | null): Promise<void> => {
    setFormError(null);
    setLookupResult(null);
    setLookupMeta(null);
    setLinkMessage(null);
    setHash('');
    setPassageText('');
    setPassageHashes([]);
    if (!file) return;
    if (!isExactImageCandidate(file)) {
      setFormError('Choose a PNG or JPEG image for exact image verification.');
      return;
    }
    setFileHashing(true);
    try {
      setHash(await sha256FileHex(file));
    } catch {
      setFormError('Could not hash that image in this browser.');
    } finally {
      setFileHashing(false);
    }
  };

  const hashPassage = async (text: string): Promise<void> => {
    setPassageText(text);
    setFormError(null);
    setLookupResult(null);
    setLookupMeta(null);
    setLinkMessage(null);
    setPassageHashes([]);
    setHash('');
    const trimmed = text.trim();
    if (!trimmed) return;
    setPassageHashing(true);
    try {
      const methods = contentProofExtractionMethods(
        meta?.attestation.extractionMethods ?? [],
      );
      const presets = contentProofPresets(
        meta?.attestation.shinglingPresets ?? [],
      );
      const results = await Promise.all(
        presets.flatMap((preset) =>
          methods.map(async (sourceExtractionMethod) => ({
            preset,
            sourceExtractionMethod,
            result: await shinglePlainTextInBrowser(trimmed, {
              preset,
              sourceExtractionMethod,
            }),
          })),
        ),
      );
      const seen = new Set<string>();
      const hashes = results.flatMap(({ preset, sourceExtractionMethod, result }) =>
        result.shingles
          .map((shingle) => ({
            preset,
            sourceExtractionMethod,
            sourceIndex: shingle.sourceIndex,
            hash: shingle.canonicalPayloadHash,
          }))
          .filter((shingle) => {
            if (seen.has(shingle.hash)) return false;
            seen.add(shingle.hash);
            return true;
          }),
      );
      setPassageHashes(hashes);
      if (hashes[0]) {
        setHash(hashes[0].hash);
      } else {
        setFormError(
          'That passage is too short for content proof hashing. Use at least 7 words from one continuous passage; a full sentence or paragraph is better.',
        );
      }
    } catch {
      setFormError('Could not hash that passage in this browser.');
    } finally {
      setPassageHashing(false);
    }
  };

  const downloadResultJson = (): void => {
    if (!lookupResult || !resultJson) return;
    const blob = new Blob([`${resultJson}\n`], {
      type: 'application/json',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${lookupResult.package_id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const copyVerificationLink = async (): Promise<void> => {
    if (!lookupMeta) return;
    setLinkMessage(null);
    try {
      await navigator.clipboard.writeText(lookupMeta.verificationUrl);
      setLinkMessage('Verification link copied.');
    } catch {
      setLinkMessage('Could not copy the verification link.');
    }
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setLookupResult(null);
    setLookupMeta(null);
    setLinkMessage(null);
    const normalized = hash.trim().toLowerCase();
    const candidateHashes =
      hashMode === 'passage'
        ? passageHashes.map((candidate) => candidate.hash)
        : undefined;
    const lookupKind =
      hashMode === 'file'
        ? 'whole_file'
        : hashMode === 'passage'
          ? 'content'
          : hashMode === 'image'
            ? 'exact_image'
            : 'any';
    if (!HEX64.test(normalized)) {
      setFormError(
        'Submit a 64-character lowercase hex SHA-256 hash (no leading 0x).',
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.performAttestationLookup(
        attestationId,
        normalized,
        lookupKind,
        candidateHashes,
      );
      setLookupResult(res.package);
      setLookupMeta(res);
    } catch (err) {
      setFormError(lookupErrorMessage(err as ApiError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header
        right={
          <>
            {meEmail && (
              <span className="min-w-0 break-all text-[14px] text-neutral-500">
                {meEmail}
              </span>
            )}
            <LinkButton onClick={logout}>Sign out</LinkButton>
          </>
        }
      />
      <Container className="py-12 sm:py-16">
        <p className="text-[14px] text-neutral-500">
          <a href="/" className="hover:underline">
            ← Home
          </a>
        </p>

        {error ? (
          <Card className="mt-12" padding="6">
            <h1 className="text-[24px] font-medium">
              This link has not been shared with your account
            </h1>
            <p className="mt-3 text-[15px] leading-6 text-neutral-600">
              The producer controls who can verify this attestation. Ask them to
              grant this exact email address access and resend the private
              verifier lookup. If you believe they meant to share it with you,
              you can send an approval request from here.
            </p>
            {missingAccess && (
              <>
                {accessRequestStatus && (
                  <div className="mt-5 border border-[var(--color-border)] bg-neutral-50 px-4 py-3 text-[14px] text-neutral-700">
                    {accessRequestStatus === 'pending'
                      ? 'Your approval request is pending. The normal path is for the producer to grant access before sending this link.'
                      : accessRequestStatus === 'denied'
                        ? 'Your approval request was denied and cannot be reconsidered.'
                        : accessRequestStatus === 'approved'
                          ? 'Your request was approved, but this private verifier lookup is not active right now. Ask the producer to confirm the grant is still active.'
                          : `Request status: ${accessRequestStatus}`}
                    {accessRequestStatus === 'denied' &&
                      accessRequestResolutionReason && (
                        <span className="mt-2 block">
                          Reason: {accessRequestResolutionReason}
                        </span>
                      )}
                  </div>
                )}
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {accessRequestStatus !== 'pending' &&
                    accessRequestStatus !== 'denied' && (
                      <textarea
                        value={accessRequestReason}
                        onChange={(event) =>
                          setAccessRequestReason(event.target.value)
                        }
                        rows={3}
                        placeholder="Why are you requesting approval?"
                        className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] focus:border-neutral-700 focus:outline-none"
                      />
                    )}
                  <Button
                    type="button"
                    onClick={() => void requestAccess()}
                    disabled={
                      requestingAccess ||
                      accessRequestStatus === 'pending' ||
                      accessRequestStatus === 'denied'
                    }
                  >
                    {requestingAccess
                      ? 'Sending request...'
                      : accessRequestStatus === 'pending'
                        ? 'Approval pending'
                        : accessRequestStatus === 'denied'
                          ? 'Request denied'
                        : 'Request producer approval'}
                  </Button>
                  <LinkButton onClick={() => router.replace('/')}>
                    Back to shared attestations
                  </LinkButton>
                </div>
              </>
            )}
            {accessRequestMessage && (
              <p className="mt-4 text-[14px] text-neutral-600">
                {accessRequestMessage}
              </p>
            )}
          </Card>
        ) : !meta ? (
          <p className="mt-12 text-[14px] text-neutral-500">Loading…</p>
        ) : (
          <>
            <Eyebrow>Private verifier lookup</Eyebrow>
            <h1 className="mt-2 text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
              {meta.attestation.label}
            </h1>
            <p className="mt-3 text-[16px] text-neutral-700">
              {meta.tenant.name} · {meta.project.name}
            </p>

            <Card className="mt-10" padding="6">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
                Before you verify
              </h2>
              <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {[
                  ['Producer', meta.tenant.name],
                  ['Project', meta.project.name],
                  ['Attestation', meta.attestation.label],
                  [
                    'Confirmed at',
                    meta.attestation.confirmedAt
                      ? new Date(meta.attestation.confirmedAt).toLocaleString()
                      : '—',
                  ],
                  ['Coverage', meta.attestation.coverageType],
                  ...(meta.attestation.shinglingPresets.length > 0
                    ? ([
                        [
                          'Shingling presets',
                          meta.attestation.shinglingPresets.join(', '),
                        ],
                      ] as [string, string][])
                    : []),
                  ...(meta.attestation.extractionMethods.length > 0
                    ? ([
                        [
                          'Extraction methods',
                          meta.attestation.extractionMethods.join(', '),
                        ],
                      ] as [string, string][])
                    : []),
                  [
                    'Hash algorithm',
                    `${meta.attestation.hashAlgorithm} · v${meta.attestation.hashAlgorithmVersion}`,
                  ],
                  ['Signature', meta.attestation.signatureStatus],
                  ['Anchoring', meta.attestation.blockchainAnchoring],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="grid gap-1 border-b border-[var(--color-border)] py-1.5 text-[14px] sm:grid-cols-[minmax(120px,0.8fr)_minmax(0,1.2fr)] sm:gap-4"
                  >
                    <dt className="text-neutral-500">{k}</dt>
                    <dd className="min-w-0 break-words text-neutral-800 sm:text-right">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[13px] text-neutral-500">
                This is a limited preview. File names, file counts, and the full
                proof set stay hidden until you submit something to verify.
              </p>
            </Card>

            <Card className="mt-6" padding="6">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
                Choose what to verify
              </h2>
              <form onSubmit={submit} className="mt-4">
                <div className="mb-4 grid grid-cols-1 border border-[var(--color-border)] text-[14px] sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('file');
                      setHash('');
                      setPassageText('');
                      setPassageHashes([]);
                      setLookupResult(null);
                      setLookupMeta(null);
                    }}
                    className={`px-3 py-2 ${
                      hashMode === 'file'
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white text-neutral-700'
                    }`}
                  >
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('image');
                      setHash('');
                      setPassageText('');
                      setPassageHashes([]);
                      setLookupResult(null);
                      setLookupMeta(null);
                    }}
                    className={`border-t border-[var(--color-border)] px-3 py-2 sm:border-l sm:border-t-0 ${
                      hashMode === 'image'
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white text-neutral-700'
                    }`}
                  >
                    Choose image
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('paste');
                      setHash('');
                      setPassageText('');
                      setPassageHashes([]);
                      setLookupResult(null);
                      setLookupMeta(null);
                    }}
                    className={`border-t border-[var(--color-border)] px-3 py-2 sm:border-l sm:border-t-0 ${
                      hashMode === 'paste'
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white text-neutral-700'
                    }`}
                  >
                    Paste SHA-256
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHashMode('passage');
                      setHash('');
                      setLookupResult(null);
                      setLookupMeta(null);
                    }}
                    disabled={meta.attestation.shinglingPresets.length === 0}
                    className={`border-t border-[var(--color-border)] px-3 py-2 disabled:bg-neutral-50 disabled:text-neutral-400 sm:border-l sm:border-t-0 ${
                      hashMode === 'passage'
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white text-neutral-700'
                    }`}
                  >
                    Hash passage
                  </button>
                </div>

                {hashMode === 'file' ? (
                  <Field
                    label="File"
                    htmlFor="lookup-file"
                    hint="The browser computes SHA-256 locally. File bytes never leave this page."
                  >
                    <input
                      id="lookup-file"
                      type="file"
                      onChange={(e) =>
                        void selectFile(e.currentTarget.files?.[0] ?? null)
                      }
                      className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] file:mr-4 file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-[13px] file:text-white focus:border-neutral-700 focus:outline-none"
                    />
                  </Field>
                ) : hashMode === 'image' ? (
                  <Field
                    label="Image"
                    htmlFor="lookup-image"
                    hint="The browser computes an exact PNG/JPEG SHA-256 locally. Image bytes never leave this page."
                  >
                    <input
                      id="lookup-image"
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(e) =>
                        void selectImage(e.currentTarget.files?.[0] ?? null)
                      }
                      className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] file:mr-4 file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-[13px] file:text-white focus:border-neutral-700 focus:outline-none"
                    />
                  </Field>
                ) : hashMode === 'paste' ? (
                  <Field
                    label="SHA-256 (64-char lowercase hex)"
                    htmlFor="submitted-hash"
                    hint={
                      meta.attestation.shinglingPresets.length > 0
                        ? 'A whole-file SHA-256 or a text content proof hash.'
                        : 'Produced by an external SHA-256 tool.'
                    }
                  >
                    <TextInput
                      id="submitted-hash"
                      value={hash}
                      onChange={(e) =>
                        setHash(e.target.value.trim().toLowerCase())
                      }
                      placeholder="e.g. c0a9acf68a3b0a044bdc477d1e66048d458f4a42482418831dbdcdb2106a90fd"
                      spellCheck={false}
                    />
                  </Field>
                ) : (
                  <Field
                    label="Text passage"
                    htmlFor="passage-text"
                    hint="Paste exact source text from one continuous passage. A full sentence or paragraph works best; the text never leaves this page."
                  >
                    <textarea
                      id="passage-text"
                      value={passageText}
                      onChange={(e) => void hashPassage(e.target.value)}
                      rows={6}
                      className="w-full resize-y border border-[var(--color-border)] px-3 py-2 text-[14px] leading-6 focus:border-neutral-700 focus:outline-none"
                    />
                  </Field>
                )}

                {hashMode === 'passage' && passageHashes.length > 0 && (
                  <div className="mb-4 border border-[var(--color-border)] bg-white p-3">
                    <div className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
                      Passage checks
                    </div>
                    <p className="mt-2 text-[13px] text-neutral-500">
                      {passageHashes.length} private passage check
                      {passageHashes.length === 1 ? '' : 's'} generated locally.
                      The lookup checks them and returns the first committed
                      match.
                    </p>
                    <div className="mt-3 grid gap-2">
                      {passageHashes.slice(0, 8).map((candidate) => (
                        <button
                          key={`${candidate.sourceIndex}:${candidate.hash}`}
                          type="button"
                          onClick={() => setHash(candidate.hash)}
                          className={`border px-3 py-2 text-left font-mono text-[12px] hover:border-neutral-700 ${
                            hash === candidate.hash
                              ? 'border-neutral-900 bg-neutral-50'
                              : 'border-[var(--color-border)] bg-white'
                          }`}
                        >
                          <span className="mr-2 font-sans text-neutral-500">
                            #{candidate.sourceIndex + 1} ·{' '}
                            {contentProofMethodLabel(
                              candidate.sourceExtractionMethod,
                            )}
                          </span>
                          {candidate.hash}
                        </button>
                      ))}
                    </div>
                    {passageHashes.length > 8 && (
                      <p className="mt-2 text-[13px] text-neutral-500">
                        Showing the first 8 local checks. Only the generated
                        hashes are submitted for verification.
                      </p>
                    )}
                  </div>
                )}

                <div className="mb-4 border border-[var(--color-border)] bg-neutral-50 p-3">
                  <div className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
                    {hashMode === 'passage'
                      ? 'Selected passage check'
                      : 'SHA-256'}
                  </div>
                  <div className="mt-2 break-all font-mono text-[12px] text-neutral-700">
                    {hash ||
                      (hashMode === 'file'
                        ? 'Choose a file to compute its hash.'
                        : hashMode === 'image'
                          ? 'Choose a PNG or JPEG to compute its exact image hash.'
                        : hashMode === 'passage'
                          ? 'Paste a passage to generate content proof hashes.'
                          : 'Paste a SHA-256 digest above.')}
                  </div>
                </div>

                {formError && (
                  <p className="mb-4 text-[14px] text-neutral-900">
                    {formError}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    fileHashing ||
                    passageHashing ||
                    !HEX64.test(hash)
                  }
                >
                  {fileHashing || passageHashing
                    ? 'Hashing...'
                    : submitting
                      ? 'Verifying...'
                      : 'Verify'}
                </Button>
                <p className="mt-3 text-[13px] text-neutral-500">
                  Each lookup creates a signed result package and a public
                  result page you can share after verification.
                </p>
              </form>
            </Card>

            {lookupResult && (
              <Card className="mt-6" padding="6">
                {resultTone && (
                  <div className={`mb-5 border p-4 ${resultTone.className}`}>
                    <div className="text-[16px] font-medium">
                      {resultTone.title}
                    </div>
                    <p className="mt-1 text-[14px]">{resultTone.body}</p>
                  </div>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-[20px] font-medium">
                      Verification result
                    </h2>
                    <p className="mt-2 text-[14px] text-neutral-600">
                      Result package <Mono>{lookupResult.package_id}</Mono>
                    </p>
                  </div>
                  <div className="shrink-0">
                    <MicroLabel>{lookupResult.hash_algorithm}</MicroLabel>
                  </div>
                </div>
                <dl className="mt-5 grid gap-4 text-[14px]">
                  <div className="border border-[var(--color-border)] bg-neutral-50 p-3">
                    <dt className="text-[13px] text-neutral-500">
                      What this result means
                    </dt>
                    <dd className="mt-1 text-[14px] leading-6 text-neutral-700">
                      {lookupResult.result_type === 'match'
                        ? lookupResult.match?.leaf_type === 'shingle/sha256/v1'
                          ? lookupResult.match.source_extraction_method ===
                            'ocr-tesseract/v1'
                            ? 'This result says the passage you checked matches OCR text coverage the producer committed for this attestation. The passage text itself is not included in the public result.'
                            : 'This result says the passage you checked matches text coverage the producer committed for this attestation. The passage text itself is not included in the public result.'
                          : lookupResult.match?.leaf_type ===
                              'component/sha256/v1' &&
                            lookupResult.match.component_method ===
                              'exact-image-sha256/v1'
                            ? 'This result says the PNG/JPEG image you checked exactly matches image coverage the producer committed for this attestation.'
                          : 'This result says the file hash you checked matches whole-file coverage the producer committed for this attestation.'
                        : 'This result says the item you checked was not found in this specific attestation at lookup time. It does not make a claim about other projects, other attestations, or files the producer never committed.'}
                    </dd>
                  </div>
                  {lookupMeta && (
                    <div className="border border-[var(--color-border)] bg-neutral-50 p-3">
                      <dt className="text-[13px] text-neutral-500">
                        Shareable result page
                      </dt>
                      <dd className="mt-1 break-all">
                        <a
                          href={lookupMeta.verificationUrl}
                          className="text-[var(--color-accent)] hover:underline"
                        >
                          {lookupMeta.verificationUrl}
                        </a>
                      </dd>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={lookupMeta.verificationUrl}
                          className="border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] text-neutral-700 hover:border-neutral-700"
                        >
                          Open shareable result page
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyVerificationLink()}
                          className="border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] text-neutral-700 hover:border-neutral-700"
                        >
                          Copy link
                        </button>
                      </div>
                      {linkMessage && (
                        <p className="mt-2 text-[13px] text-neutral-600">
                          {linkMessage}
                        </p>
                      )}
                      <p className="mt-2 text-[13px] text-neutral-500">
                        Share this public link with anyone who needs to confirm
                        this lookup result and download its evidence artifacts.
                      </p>
                    </div>
                  )}
                  <ResultRow
                    label="Submitted hash"
                    value={lookupResult.submitted_hash}
                  />
                  <ResultRow
                    label="Merkle root"
                    value={lookupResult.attestation.merkle_root}
                  />
                  {lookupResult.result_type === 'match' &&
                    lookupResult.match && (
                      <>
                        <div>
                          <dt className="text-[13px] text-neutral-500">
                            Statement
                          </dt>
                          <dd className="mt-1 text-[15px] italic text-neutral-800">
                            &ldquo;{matchStatement}&rdquo;
                          </dd>
                        </div>
                        <ResultRow
                          label="Matched proof type"
                          value={matchProofLabel(lookupResult.match)}
                        />
                        {lookupResult.match.source_extraction_method && (
                          <ResultRow
                            label="Extraction method"
                            value={contentProofMethodLabel(
                              lookupResult.match.source_extraction_method as SourceExtractionMethod,
                            )}
                          />
                        )}
                        {lookupResult.match.component_method && (
                          <ResultRow
                            label="Image proof"
                            value={componentMethodLabel(
                              lookupResult.match.component_method,
                            )}
                          />
                        )}
                        {lookupResult.match.media_type && (
                          <ResultRow
                            label="Image format"
                            value={imageMediaTypeLabel(
                              lookupResult.match.media_type,
                            )}
                          />
                        )}
                        <ResultRow
                          label="Matched leaf"
                          value={lookupResult.match.leaf_id}
                        />
                        <ResultRow
                          label="Proof depth"
                          value={`${lookupResult.match.proof_path.length} step${
                            lookupResult.match.proof_path.length === 1
                              ? ''
                              : 's'
                          }`}
                        />
                      </>
                    )}
                  {lookupResult.result_type === 'no_match' &&
                    lookupResult.no_match_statement && (
                      <div>
                        <dt className="text-[13px] text-neutral-500">
                          Statement
                        </dt>
                        <dd className="mt-1 text-[15px] italic text-neutral-800">
                          &ldquo;{lookupResult.no_match_statement}&rdquo;
                        </dd>
                      </div>
                    )}
                </dl>
                {resultJson && (
                  <div className="mt-6 border-t border-[var(--color-border)] pt-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
                        Result package artifact
                      </h3>
                      <button
                        type="button"
                        onClick={downloadResultJson}
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
                        {resultJson}
                      </pre>
                    </details>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </Container>
    </>
  );
}

interface PassageHash {
  preset: ShinglePreset;
  sourceExtractionMethod: SourceExtractionMethod;
  sourceIndex: number;
  hash: string;
}

const SUPPORTED_CONTENT_METHODS: SourceExtractionMethod[] = [
  'plain-text/v1',
  'pdf-text-layer/v1',
  'ocr-tesseract/v1',
];

const SUPPORTED_CONTENT_PRESETS: ShinglePreset[] = [
  'standard',
  'broad',
  'sensitive',
];

const contentProofExtractionMethods = (
  methods: string[],
): SourceExtractionMethod[] => {
  const filtered = methods.filter((method): method is SourceExtractionMethod =>
    SUPPORTED_CONTENT_METHODS.includes(method as SourceExtractionMethod),
  );
  return [...new Set([...filtered, ...SUPPORTED_CONTENT_METHODS])];
};

const contentProofPresets = (presets: string[]): ShinglePreset[] => {
  const filtered = presets.filter((preset): preset is ShinglePreset =>
    SUPPORTED_CONTENT_PRESETS.includes(preset as ShinglePreset),
  );
  return filtered.length > 0 ? filtered : ['standard'];
};

const contentProofMethodLabel = (method: SourceExtractionMethod): string => {
  if (method === 'pdf-text-layer/v1') return 'PDF text';
  if (method === 'ocr-tesseract/v1') return 'OCR text';
  return 'Plain text';
};

function ResultRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-[13px] text-neutral-500">{label}</dt>
      <dd className="mt-1 break-all">
        <Mono>{value}</Mono>
      </dd>
    </div>
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

const componentMethodLabel = (method: string): string => {
  if (method === 'exact-image-sha256/v1') return 'Exact image SHA-256';
  return method;
};

const imageMediaTypeLabel = (mediaType: string): string => {
  if (mediaType === 'image/png') return 'PNG';
  if (mediaType === 'image/jpeg') return 'JPEG';
  return mediaType;
};

const isExactImageCandidate = (file: File): boolean => {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg')
  );
};

const sha256FileHex = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const lookupErrorMessage = (err: ApiError): string => {
  const code =
    err.body && typeof err.body === 'object' && 'error' in err.body
      ? String((err.body as { error?: unknown }).error)
      : null;
  if (err.status === 400) {
    return 'Submit a valid 64-character lowercase SHA-256 hash.';
  }
  if (err.status === 401) {
    return 'Your session expired. Sign in again, then retry the lookup.';
  }
  if (err.status === 404) {
    return 'This attestation is unavailable, unconfirmed, or no longer shared with this verifier account.';
  }
  if (err.status === 429 || code === 'verification_rate_limit_exceeded') {
    return 'Too many lookups were submitted for this workspace. Wait about a minute, then try again.';
  }
  return 'The lookup failed. Please try again.';
};
