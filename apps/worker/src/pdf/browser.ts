// Singleton Playwright Chromium instance for PDF rendering. Launching the
// browser is ~500ms; we keep one alive for the worker's lifetime and reuse
// across jobs. Each render runs in a fresh page (cheap).
//
// The worker's index.ts shutdown handler closes this on SIGINT/SIGTERM.

import { chromium, type Browser } from 'playwright';

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

const launch = async (): Promise<Browser> => {
  return chromium.launch({
    headless: true,
    // --no-sandbox is conventional in containerized worker images; safe
    // here since the worker only renders trusted HTML strings we built.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
};

export const getBrowser = async (): Promise<Browser> => {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = launch().then((b) => {
      browser = b;
      launching = null;
      return b;
    });
  }
  return launching;
};

export const closeBrowser = async (): Promise<void> => {
  if (browser) {
    await browser.close();
    browser = null;
  }
};

/** Render an HTML string to a PDF byte buffer (A4 portrait, small margins). */
export const renderHtmlToPdf = async (html: string): Promise<Buffer> => {
  const b = await getBrowser();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
    });
    return pdf;
  } finally {
    await page.close();
    await ctx.close();
  }
};
