import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let config = {
  baseUrl: process.env.PROVERIA_VERIFIER_URL ?? 'http://localhost:3003',
  email: process.env.PROVERIA_VERIFIER_EMAIL,
  password: process.env.PROVERIA_VERIFIER_PASSWORD,
  attestationId: process.env.PROVERIA_VERIFIER_ATTESTATION_ID,
  submittedHash: process.env.PROVERIA_VERIFIER_SUBMITTED_HASH,
  fileText: process.env.PROVERIA_VERIFIER_FILE_TEXT,
};

const NO_MATCH_HASH =
  process.env.PROVERIA_VERIFIER_NO_MATCH_HASH ?? 'f'.repeat(64);

const required = [
  ['PROVERIA_VERIFIER_EMAIL', config.email],
  ['PROVERIA_VERIFIER_PASSWORD', config.password],
  ['PROVERIA_VERIFIER_ATTESTATION_ID', config.attestationId],
  ['PROVERIA_VERIFIER_SUBMITTED_HASH', config.submittedHash],
  ['PROVERIA_VERIFIER_FILE_TEXT', config.fileText],
];

const missing = required
  .filter(([, value]) => !value)
  .map(([name]) => name);

const log = (message, details) => {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[verifier:smoke] ${message}${suffix}`);
};

const runSeeder = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proveria-verifier-smoke-'));
  const resultPath = join(dir, 'seed.json');
  try {
    log('seeding attestation');
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        'pnpm',
        ['--filter', '@proveria/desktop', 'smoke:happy-path'],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PROVERIA_SMOKE_RESULT_PATH: resultPath,
          },
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      );
      child.on('error', rejectPromise);
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        rejectPromise(
          new Error(
            signal
              ? `desktop seeder exited by signal ${signal}`
              : `desktop seeder exited with ${code}`,
          ),
        );
      });
    });
    const seeded = JSON.parse(await readFile(resultPath, 'utf8'));
    return {
      email: seeded.email,
      password: seeded.password,
      attestationId: seeded.attestationId,
      submittedHash: seeded.submittedHash,
      fileText: seeded.fileText,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const loadConfig = async () => {
  if (missing.length === 0) return;
  if (process.env.PROVERIA_VERIFIER_SEED === '0') {
    console.error(`[verifier:smoke] missing env: ${missing.join(', ')}`);
    process.exit(2);
  }
  const seeded = await runSeeder();
  config = { ...config, ...seeded };
};

const expectBody = async (page, text) => {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const body = await page.locator('body').innerText();
    if (body.includes(text)) return;
    await page.waitForTimeout(250);
  }
  const body = await page.locator('body').innerText();
  throw new Error(`missing text: ${text}\n${body}`);
};

const main = async () => {
  await loadConfig();

  if (!/^[0-9a-f]{64}$/.test(config.submittedHash)) {
    console.error(
      '[verifier:smoke] PROVERIA_VERIFIER_SUBMITTED_HASH must be 64 lowercase hex chars',
    );
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    log('opening lookup while signed out', {
      attestationId: config.attestationId,
    });
    await page.goto(`${config.baseUrl}/lookups/${config.attestationId}`);
    await page.waitForURL(/\/login\?next=/, { timeout: 10_000 });
    await page.locator('#email').fill(config.email);
    await page.locator('#password').fill(config.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${config.baseUrl}/lookups/${config.attestationId}`, {
      timeout: 10_000,
    });
    await expectBody(page, 'PRE-LOOKUP METADATA');
    await expectBody(page, 'whole-file');
    await expectBody(page, 'sha256 · v1.0');

    log('checking pasted hash');
    await page.getByRole('button', { name: 'Paste SHA-256' }).click();
    await page.locator('#submitted-hash').fill(config.submittedHash);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectBody(page, 'Match');
    await expectBody(page, 'Result meaning');
    await expectBody(page, 'present in the committed leaf set');
    await expectBody(page, config.submittedHash);
    await expectBody(page, 'RESULT PACKAGE JSON');
    await expectBody(page, 'Download JSON');
    await expectBody(page, 'package_id');
    await expectBody(page, 'Public verification link');
    const verificationHref = await page
      .locator('a[href^="/v/"]')
      .first()
      .getAttribute('href');
    if (!verificationHref) {
      throw new Error('missing public verification link href');
    }

    log('checking browser file hashing');
    await page.getByRole('button', { name: 'Choose file' }).click();
    await page.locator('#lookup-file').setInputFiles({
      name: 'proveria-verifier-smoke.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(config.fileText),
    });
    await expectBody(page, config.submittedHash);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectBody(page, 'Match');
    await expectBody(page, 'Proof depth');

    log('checking pasted no-match hash');
    await page.getByRole('button', { name: 'Paste SHA-256' }).click();
    await page.locator('#submitted-hash').fill(NO_MATCH_HASH);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectBody(page, 'No match');
    await expectBody(page, NO_MATCH_HASH);
    await expectBody(page, 'not found in this specific attestation');
    await expectBody(page, 'Public verification link');

    log('checking public verification link');
    await page.goto(new URL(verificationHref, config.baseUrl).toString());
    await expectBody(page, 'Verification result');
    await expectBody(page, 'Package id');
    await expectBody(page, 'Link issued');
    await expectBody(page, 'Link expires');
    await expectBody(page, 'Signature');
    await expectBody(page, 'Download PDF');
    await expectBody(page, 'Download JSON');
    await expectBody(page, 'RESULT PACKAGE JSON');

    log('passed', {
      checked: [
        'login',
        'prelookup',
        'paste-hash-match',
        'file-hash-match',
        'paste-hash-no-match',
        'public-verification-link',
      ],
    });
  } finally {
    await browser.close();
  }
};

main().catch((err) => {
  console.error('[verifier:smoke] failed:', err);
  process.exit(1);
});
