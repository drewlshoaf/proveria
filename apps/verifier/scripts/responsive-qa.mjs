import { chromium } from 'playwright';

const baseUrl = process.env.PROVERIA_VERIFIER_BASE_URL ?? 'http://localhost:3003';
const longHash =
  'c0a9acf68a3b0a044bdc477d1e66048d458f4a42482418831dbdcdb2106a90fd';
const merkleRoot = '4f'.repeat(32);

const lookupPackage = {
  schema_version: '1.0',
  protocol_version: 'v1',
  package_id: 'pkg_responsive_viewport_qa_1234567890abcdef',
  result_type: 'match',
  submitted_hash: longHash,
  hash_algorithm: 'sha256',
  lookup_scope: {
    tenant_id: 'ten_responsive',
    project_id: 'prj_responsive',
    attestation_id: 'att_responsive',
  },
  attestation: {
    label: 'Quarterly chain-of-custody attestation with a deliberately long label',
    confirmed_at: '2026-05-21T10:00:00.000Z',
    merkle_root: merkleRoot,
    protocol_version: 'v1',
  },
  match: {
    leaf_id: `leaf_${longHash}`,
    leaf_type: 'shingle/sha256/v1',
    proof_path: [{ sibling: merkleRoot, position: 'left' }],
  },
  no_match_statement: null,
  signatures: [
    {
      signer_kind: 'platform',
      key_id: 'key_responsive_long_identifier_1234567890',
      algorithm: 'ed25519',
      signature: `sig_${longHash}`,
    },
  ],
  created_at: '2026-05-21T11:00:00.000Z',
};

const receiptPackage = {
  receipt_version: '1.0',
  receipt_type: 'attestation_receipt',
  package_id: 'pkg_receipt_responsive_1234567890abcdef',
  attestation_id: 'att_responsive',
  attestation_label:
    'Quarterly chain-of-custody attestation with a deliberately long label',
  merkle_root: merkleRoot,
  manifest_canonical_sha256: longHash,
  leaf_counts: { file: 1, shingle: 0, component: 0 },
  extraction_methods: [],
  hash_algorithm: 'sha256',
  protocol_version: 'v1',
  device_signature: {
    key_id: 'dev_key_responsive_1234567890',
    algorithm: 'ed25519',
    verified: true,
  },
  confirmed_at: '2026-05-21T10:00:00.000Z',
  issued_at: '2026-05-21T10:01:00.000Z',
  signatures: lookupPackage.signatures,
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    await installApiMocks(context);
    const page = await context.newPage();

    for (const path of [
      '/',
      '/login',
      '/register',
      '/lookups/att_responsive',
      '/v/vrf_responsive_qa',
      '/v/vrf_receipt_responsive_qa',
    ]) {
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
      if (path === '/lookups/att_responsive') {
        await page.getByRole('button', { name: 'Paste SHA-256' }).click();
        await page.getByLabel('SHA-256 (64-char lowercase hex)').fill(longHash);
        await page.getByRole('button', { name: 'Verify' }).click();
        await page
          .getByText('Verification result')
          .waitFor({ state: 'visible', timeout: 5000 });
      }
      results.push({
        viewport: viewport.name,
        ...(await collectResponsiveMetrics(page)),
      });
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter(
  (result) =>
    result.overflowX > 1 ||
    result.tooWideControls.length > 0 ||
    result.tooWideElements.length > 0,
);

if (failures.length > 0) {
  console.error(
    `[verifier:responsive] ${failures.length} viewport failure(s):`,
  );
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log(
  `[verifier:responsive] passed ${results.length} page checks across mobile and desktop`,
);

async function installApiMocks(context) {
  await context.route('**/api/auth/me', (route) =>
    route.fulfill(
      json({
        user: {
          id: 'usr_eval_verifier',
          email:
            'very.long.verifier.email.address@example-company-with-a-long-domain.test',
          displayName: null,
          emailVerifiedAt: null,
          createdAt: '2026-05-21T00:00:00.000Z',
        },
        memberships: [],
      }),
    ),
  );
  await context.route('**/api/me/attestation-access', (route) =>
    route.fulfill(
      json({
        grants: [
          {
            grantId: 'grant_responsive',
            grantedAt: '2026-05-21T09:00:00.000Z',
            attestation: {
              id: 'att_responsive',
              label:
                'Quarterly chain-of-custody attestation with a deliberately long label',
              state: 'confirmed',
              confirmedAt: '2026-05-21T10:00:00.000Z',
            },
            project: {
              slug: 'responsive-qa',
              name: 'Responsive QA Project With Long Name',
            },
            tenant: {
              slug: 'proveria-eval',
              name: 'Proveria Evaluation Workspace',
            },
          },
        ],
      }),
    ),
  );
  await context.route('**/api/attestations/att_responsive/lookup', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill(
        json({
          package: lookupPackage,
          packageId: lookupPackage.package_id,
          linkId: 'vrf_responsive_qa',
          signed: true,
          retrieveUrl: '/api/v/vrf_responsive_qa',
          verificationUrl: `${baseUrl}/v/vrf_responsive_qa`,
        }),
      );
      return;
    }
    route.fulfill(
      json({
        attestation: {
          id: 'att_responsive',
          label:
            'Quarterly chain-of-custody attestation with a deliberately long label',
          confirmedAt: '2026-05-21T10:00:00.000Z',
          coverageType: 'whole-file + native text shingles',
          shinglingPresets: ['standard'],
          extractionMethods: ['plain-text/v1'],
          hashAlgorithm: 'sha256',
          hashAlgorithmVersion: '1',
          signatureStatus: 'signed',
          blockchainAnchoring: 'disabled_for_v1',
        },
        project: {
          slug: 'responsive-qa',
          name: 'Responsive QA Project With Long Name',
        },
        tenant: {
          slug: 'proveria-eval',
          name: 'Proveria Evaluation Workspace',
        },
      }),
    );
  });
  await context.route('**/api/v/vrf_responsive_qa', (route) =>
    route.fulfill(
      json({
        link: {
          id: 'vrf_responsive_qa',
          createdAt: '2026-05-21T11:00:00.000Z',
          expiresAt: null,
        },
        targetType: 'lookup_result',
        payload: lookupPackage,
        signed: true,
        signatureValid: true,
      }),
    ),
  );
  await context.route('**/api/v/vrf_receipt_responsive_qa', (route) =>
    route.fulfill(
      json({
        link: {
          id: 'vrf_receipt_responsive_qa',
          createdAt: '2026-05-21T11:00:00.000Z',
          expiresAt: null,
        },
        targetType: 'receipt',
        payload: receiptPackage,
        signed: true,
        signatureValid: true,
      }),
    ),
  );
}

async function collectResponsiveMetrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const overflowX =
      Math.max(doc.scrollWidth, body.scrollWidth) - window.innerWidth;
    const elementMetrics = [...document.querySelectorAll('body *')].map(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.getAttribute('class') ?? '').slice(0, 120),
          text: (element.textContent ?? '').trim().slice(0, 80),
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      },
    );
    const tooWideControls = elementMetrics
      .filter((rect) => ['a', 'button'].includes(rect.tag))
      .filter(
        (rect) =>
          rect.left < window.innerWidth &&
          rect.right > 0 &&
          (rect.width > window.innerWidth ||
            rect.left < -1 ||
            rect.right > window.innerWidth + 1),
      );
    const tooWideElements = elementMetrics
      .filter(
        (rect) =>
          rect.left < window.innerWidth &&
          rect.right > 0 &&
          (rect.left < -1 || rect.right > window.innerWidth + 1),
      )
      .slice(0, 8);
    return {
      path: window.location.pathname,
      width: window.innerWidth,
      overflowX,
      tooWideControls,
      tooWideElements,
    };
  });
}
