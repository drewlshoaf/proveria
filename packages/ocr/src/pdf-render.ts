// Render PDF pages to PNG raster buffers — the producer-side bridge from
// pdfjs-dist to @proveria/ocr's image-input runOcr.
//
// Picked @napi-rs/canvas as the rasterizer because it ships prebuilt
// platform binaries for the desktop targets we care about (darwin-arm64,
// darwin-x64, win32-x64, win32-arm64). No compilation at install time, no
// new code-signing burden — install just unpacks the right .node file.
//
// Scale 2 ≈ 144 DPI per ocr-v1.md §3. Higher gives Tesseract more pixels
// to chew on but balloons memory; lower starts costing accuracy.

import { createCanvas } from '@napi-rs/canvas';

const DEFAULT_SCALE = 2;

// pdfjs's legacy build (the Node-supported entry per its own warning) needs
// a real worker file path on GlobalWorkerOptions.workerSrc, or it tries to
// "set up a fake worker" and fails. We resolve the worker module that ships
// alongside the legacy build at runtime so this stays robust to dep bumps.
//
// This file must work in two ABI contexts:
//   - Electron main process: CJS — top-level `require` available
//   - tsx-loaded walkthrough: strict ESM — `require` does NOT exist
// `import.meta` would be the obvious bridge but using it as static syntax
// breaks the desktop's CJS tsconfig parse. Instead we resolve via createRequire
// anchored on process.cwd(), which works in both contexts without any module-
// system-specific syntax.
const resolvePdfjsWorkerSrc = async (): Promise<string> => {
  const { createRequire } = await import('node:module');
  const r = createRequire(process.cwd() + '/');
  return r.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
};

export interface RenderPdfOptions {
  /** PDF user-unit → pixel multiplier. Default 2 (~144 DPI). */
  scale?: number;
}

/**
 * Render every page of a PDF to a PNG-encoded Uint8Array. Pages are returned
 * in page-number order; index 0 is page 1. Each buffer is suitable as direct
 * input to runOcr().
 */
export const renderPdfPages = async (
  pdfBytes: Uint8Array,
  options: RenderPdfOptions = {},
): Promise<Uint8Array[]> => {
  const scale = options.scale ?? DEFAULT_SCALE;

  // Lazy import so callers that never touch PDFs don't pay the pdfjs init.
  // pdfjs explicitly asks for the legacy build in Node (per its own warning).
  const pdfjs = (await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  )) as unknown as {
    getDocument: (params: object) => { promise: Promise<PdfDoc> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  pdfjs.GlobalWorkerOptions.workerSrc = await resolvePdfjsWorkerSrc();

  const doc: PdfDoc = await pdfjs.getDocument({ data: pdfBytes }).promise;

  const pageImages: Uint8Array[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx as unknown as object,
        viewport,
        canvas: canvas as unknown as object,
      }).promise;
      const png = canvas.toBuffer('image/png');
      pageImages.push(new Uint8Array(png));
    }
  } finally {
    await doc.destroy();
  }

  return pageImages;
};

// --- minimal structural typing for pdfjs's runtime surface --------------
// We don't pull in pdfjs-dist's official types because they tie everything
// to the DOM lib. Only the methods we actually call are typed.

interface PdfDoc {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: object;
    viewport: object;
    canvas: object;
  }): { promise: Promise<void> };
}
