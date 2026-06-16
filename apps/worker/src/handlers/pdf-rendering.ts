// pdf-rendering worker handler (M8 / C31).
//
// On-demand PDF rendering for lookup-result packages. Receipt PDFs are
// already rendered at issuance (C30); this handler exists primarily for
// result packages, but can re-render either kind by linkId.
//
// Job data: { linkId } — the handler resolves the link to find the target
// (receipt or lookup_result), loads the source JSON from object storage,
// renders + writes the PDF to a deterministic cache key, and updates the
// row's pdf_object_key column when applicable.
//
// V1 limitation: cache keys are by *target*, not by link. If a link is
// rotated, the cached PDF's QR points to the original (now revoked) link.
// Per-link PDFs are a future refinement.

import { eq } from 'drizzle-orm';
import {
  attestations,
  verificationLinks,
  verificationResults,
  type DrizzleClient,
} from '@proveria/db';
import type { ResultPackage } from '@proveria/proofs';
import type { AttestationReceipt } from '@proveria/receipt';

import type { PutObject } from './attestation-validation.js';

export interface PdfRenderingResult {
  ok: boolean;
  objectKey?: string;
  error?: string;
}

export interface PdfRenderingDeps {
  db: DrizzleClient;
  fetchJson: (objectKey: string) => Promise<string>;
  putObject: PutObject;
  renderReceiptPdf: (
    receipt: AttestationReceipt,
    linkId: string,
  ) => Promise<Buffer>;
  renderResultPdf: (pkg: ResultPackage, linkId: string) => Promise<Buffer>;
}

const siblingKey = (objectKey: string, filename: string): string =>
  objectKey.replace(/[^/]+$/, filename);

export const renderPdfForLink = async (
  deps: PdfRenderingDeps,
  linkId: string,
): Promise<PdfRenderingResult> => {
  const { db, fetchJson, putObject, renderReceiptPdf, renderResultPdf } = deps;

  const linkRows = await db
    .select()
    .from(verificationLinks)
    .where(eq(verificationLinks.id, linkId))
    .limit(1);
  const link = linkRows[0];
  if (!link) return { ok: false, error: 'link_not_found' };

  if (link.targetType === 'receipt') {
    const rows = await db
      .select()
      .from(attestations)
      .where(eq(attestations.id, link.targetRef))
      .limit(1);
    const att = rows[0];
    if (!att || !att.receiptJsonObjectKey) {
      return { ok: false, error: 'receipt_not_available' };
    }
    const receipt = JSON.parse(
      await fetchJson(att.receiptJsonObjectKey),
    ) as AttestationReceipt;
    const pdf = await renderReceiptPdf(receipt, linkId);
    const pdfKey = siblingKey(att.receiptJsonObjectKey, 'receipt.pdf');
    await putObject(pdfKey, pdf, 'application/pdf');
    await db
      .update(attestations)
      .set({ receiptPdfObjectKey: pdfKey })
      .where(eq(attestations.id, att.id));
    return { ok: true, objectKey: pdfKey };
  }

  if (link.targetType === 'lookup_result') {
    const rows = await db
      .select()
      .from(verificationResults)
      .where(eq(verificationResults.packageId, link.targetRef))
      .limit(1);
    const res = rows[0];
    if (!res) return { ok: false, error: 'result_not_found' };
    const pkg = JSON.parse(
      await fetchJson(res.resultObjectKey),
    ) as ResultPackage;
    const pdf = await renderResultPdf(pkg, linkId);
    const pdfKey = siblingKey(res.resultObjectKey, 'result.pdf');
    await putObject(pdfKey, pdf, 'application/pdf');
    return { ok: true, objectKey: pdfKey };
  }

  return { ok: false, error: `unknown_target_type:${link.targetType}` };
};
