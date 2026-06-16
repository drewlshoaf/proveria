import { app, type BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ok, registerRpc } from './rpc/handlers.js';
import type {
  AttestationAccessGrantSummary,
  AttestationAccessRequestSummary,
  AttestationSummary,
  DeviceSummary,
  OrganizationSummary,
  ProjectSummary,
  TenantAuditEventSummary,
  TenantDeviceSummary,
  TenantInvitationSummary,
  TenantMemberSummary,
  WorkspaceSummary,
} from './rpc/types.js';

export type SmokeMode = 'signed-out' | 'auth' | 'auth-producer';

export const runSmokeTest = (win: BrowserWindow, mode: SmokeMode): void => {
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void runSmoke(win, mode)
        .then(() => {
          console.log(`[desktop:smoke] ${mode} renderer passed`);
          app.exit(0);
        })
        .catch((err) => {
          console.error('[desktop:smoke] failed:', err);
          app.exit(1);
        });
    }, 250);
  });
};

const runSmoke = async (win: BrowserWindow, mode: SmokeMode): Promise<void> => {
  if (mode === 'auth' && process.env.PROVERIA_DESKTOP_SCREENSHOT_DIR) {
    await captureAuthenticatedScreenshots(win, process.env.PROVERIA_DESKTOP_SCREENSHOT_DIR);
  }

  await win.webContents.executeJavaScript(
    mode === 'auth'
      ? authenticatedSmokeScript
      : mode === 'auth-producer'
        ? producerSmokeScript
        : signedOutSmokeScript,
  );
};

const captureAuthenticatedScreenshots = async (win: BrowserWindow, dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await waitForRendererText(win, 'Workspace session');

  const views = [
    { button: null, file: 'overview', text: 'Start here' },
    { button: 'Workspaces', file: 'workspaces', text: 'Acme Labs' },
    { button: 'Projects', file: 'projects', text: 'Evidence Archive' },
    {
      button: 'Attestations',
      file: 'attestations',
      text: 'Launch evidence',
    },
    { button: 'Users', file: 'users', text: 'owner@example.com' },
    { button: 'Events', file: 'events', text: 'Device Revoked' },
  ] as const;

  for (const view of views) {
    if (view.button) {
      await clickRendererButton(win, view.button);
      await waitForRendererText(win, view.text);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));

    const image = await win.webContents.capturePage();
    await writeFile(join(dir, `${view.file}.png`), image.toPNG());
  }

  await clickRendererButton(win, 'Overview');
  await waitForRendererText(win, 'Workspace session');
};

const waitForRendererText = async (win: BrowserWindow, expected: string): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const text = (await win.webContents.executeJavaScript('document.body.innerText')) as string;
    if (text.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`missing screenshot text: ${expected}`);
};

const clickRendererButton = async (win: BrowserWindow, label: string): Promise<void> => {
  const serializedLabel = JSON.stringify(label);
  await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.innerText === ${serializedLabel});
      if (!button) throw new Error('button missing: ' + ${serializedLabel});
      button.click();
    })()
  `);
};

const signedOutSmokeScript = `
  (async () => {
    const text = document.body.innerText;
    if (typeof window.proveria?.rpc !== 'function') {
      throw new Error('preload rpc bridge was not available');
    }
    for (const expected of ['Proveria', 'Create account', 'Sign in']) {
      if (!text.includes(expected)) {
        throw new Error('missing signed-out text: ' + expected + '\\n' + text);
      }
    }
  })()
`;

const authenticatedSmokeScript = `
  (async () => {
    const waitForText = async (expected) => {
      const started = Date.now();
      while (Date.now() - started < 5000) {
        const text = document.body.innerText;
        if (text.includes(expected)) return text;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('missing authenticated text: ' + expected + '\\n' + document.body.innerText);
    };
    const waitForMissingText = async (unexpected) => {
      const started = Date.now();
      while (Date.now() - started < 5000) {
        const text = document.body.innerText;
        if (!text.includes(unexpected)) return text;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('stale authenticated text: ' + unexpected + '\\n' + document.body.innerText);
    };

    if (typeof window.proveria?.rpc !== 'function') {
      throw new Error('preload rpc bridge was not available');
    }

    await waitForText('Acme Labs');

    const clickButton = (label) => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.innerText.trim() === label);
      if (!button) {
        throw new Error(
          'button missing: ' + label + '\\n' + document.body.innerText.slice(0, 1200),
        );
      }
      button.click();
      return button;
    };
    const setValue = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('missing input: ' + selector);
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el),
        'value'
      )?.set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const waitForInput = async (selector, timeoutMs = 5000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const el = document.querySelector(selector);
        if (el) return el;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('missing input: ' + selector);
    };
    const clickWorkspaceChange = () => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) =>
          candidate.getAttribute('aria-label') === 'Change workspace'
        );
      if (!button) throw new Error('workspace change button missing');
      button.click();
      return button;
    };
    const clickWorkspaceOption = (workspaceName) => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) =>
          candidate.getAttribute('role') === 'option' &&
          candidate.innerText.trim() === workspaceName
        );
      if (!button) throw new Error('workspace option missing: ' + workspaceName);
      button.click();
      return button;
    };
    const waitForActiveWorkspace = async (workspaceName) => {
      const started = Date.now();
      while (Date.now() - started < 5000) {
        const element = [...document.querySelectorAll('[aria-label="Active workspace"]')]
          .find((candidate) =>
            candidate.innerText.includes(workspaceName)
          );
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('active workspace missing: ' + workspaceName + '\\n' + document.body.innerText);
    };

    for (const expected of ['Overview', 'Workspaces', 'Projects', 'Attestations', 'Users', 'Events', 'Workspace session', 'Start here', 'Recent local attestations', 'Launch evidence', 'Evidence Archive', 'Create project', 'Submit attestation', 'Grant access when ready']) {
      const text = document.body.innerText;
      if (!text.includes(expected)) {
        throw new Error('missing authenticated text: ' + expected + '\\n' + text);
      }
    }

    clickWorkspaceChange();
    await waitForText('Acme Legal');
    clickWorkspaceOption('Acme Legal');
    await waitForActiveWorkspace('Acme Legal');
    clickWorkspaceChange();
    await waitForText('Acme Labs');
    clickWorkspaceOption('Acme Labs');
    await waitForActiveWorkspace('Acme Labs');
    clickButton('Workspaces');
    await waitForText('Manage organization workspaces');
    clickButton('New workspace');
    await waitForInput('input[aria-label="New workspace name"]');
    setValue('input[aria-label="New workspace name"]', 'Acme Research');
    clickButton('Create workspace');
    await waitForActiveWorkspace('Acme Research');
    await waitForText('Acme Research');
    clickWorkspaceChange();
    await waitForText('Acme Research');
    clickWorkspaceOption('Acme Labs');
    await waitForActiveWorkspace('Acme Labs');
    clickButton('Workspaces');
    const archiveWorkspaceButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label')?.includes('Archive Acme Legal'));
    if (!archiveWorkspaceButton) throw new Error('archive workspace button missing');
    archiveWorkspaceButton.click();
    await waitForText('archived');
    const restoreWorkspaceButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label')?.includes('Restore Acme Legal'));
    if (!restoreWorkspaceButton) throw new Error('restore workspace button missing');
    restoreWorkspaceButton.click();
    await waitForText('available');
    clickButton('Overview');
    await waitForText('Recent local attestations');

    const recentButton = [...document.querySelectorAll('button')]
      .find((button) =>
        button.innerText.includes('Launch evidence') &&
        button.innerText.includes('Evidence Archive')
      );
    if (!recentButton) throw new Error('recent attestation button missing');
    recentButton.click();
    await waitForText('Full record with receipt proof, verifier access, attempts, and events for this attestation.');

    clickButton('owner@example.com');
    await waitForText('Trusted devices');
    await waitForText('Backup Mac');
    const revokeButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText === 'Revoke');
    if (!revokeButton) throw new Error('revoke button missing');
    revokeButton.click();
    await waitForText('Device revoked.');
    clickButton('Users');
    await waitForText('Members');
    await waitForText('Pending invitations');

    clickButton('Members');
    await waitForText('owner@example.com');
    await waitForText('producer@example.com');
    await waitForText('Acme Research');
    const producerRow = [...document.querySelectorAll('tr')]
      .find((row) => row.innerText.includes('producer@example.com'));
    if (!producerRow) throw new Error('producer member row missing');
    producerRow.click();
    await waitForText('Workspace access is selected workspaces only.');
    await waitForText('Delete user');
    const workspaceAdminChoice = document.querySelector(
      'input[name="role"][value="tenant_admin"]',
    );
    if (!workspaceAdminChoice) throw new Error('workspace admin choice missing');
    workspaceAdminChoice.click();
    workspaceAdminChoice.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForText('Save changes');
    clickButton('Cancel');
    clickButton('New member');
    await waitForText('Invite member');

    setValue('#inviteEmail', 'new-producer@example.com');
    setValue('#inviteRole', 'producer');
    clickButton('Send invite');

    clickButton('Pending invitations');
    await waitForText('Invitation created.');
    await waitForText('new-producer@example.com');
    await waitForText('pending@example.com');

    const revokeInviteButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText === 'Revoke invite');
    if (!revokeInviteButton) throw new Error('revoke invite button missing');
    revokeInviteButton.click();
    await waitForText('Invitation revoked.');

    clickButton('Projects');
    await waitForText('Evidence Archive');
    await waitForText('Retired Evidence');
    await waitForText('Archived');
    const restoreButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label')?.includes('Restore'));
    if (!restoreButton) throw new Error('restore project button missing');
    restoreButton.click();
    await waitForText('2 active');
    const archiveButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label')?.includes('Archive'));
    if (!archiveButton) throw new Error('archive project button missing');
    archiveButton.click();
    await waitForText('1 active');
    clickButton('New project');
    await waitForInput('#projectName');
    setValue('#projectName', 'New Smoke Project');
    clickButton('Create project');
    await waitForText('New Smoke Project');

    const requestsButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText.includes('Verification Requests'));
    if (!requestsButton) throw new Error('requests button missing');
    requestsButton.click();
    await waitForText('Verifier approval requests');
    await waitForText('Showing 8 of 11 matching requests');
    clickButton('Next');
    await waitForText('late-requester@example.com');
    clickButton('Previous');
    setValue('#requestSearch', 'pending-requester-3');
    await waitForText('pending-requester-3@example.com');
    await waitForMissingText('verifier-requester@example.com');
    setValue('#requestSearch', '');
    setValue('#requestStatusFilter', 'denied');
    await waitForText('denied-requester@example.com');
    await waitForText('Closed');
    await waitForMissingText('pending-requester-1@example.com');
    setValue('#requestStatusFilter', 'all');
    const requestSortButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === 'Sort by Verifier');
    if (!requestSortButton) throw new Error('request sort button missing');
    requestSortButton.click();
    await waitForText('alpha-requester@example.com');
    const approveWithoutReason = [...document.querySelectorAll('button')]
      .find((button) => button.innerText === 'Approve');
    if (!approveWithoutReason) throw new Error('approve request button missing');
    approveWithoutReason.click();
    await waitForText('Enter a reason before approving access.');
    setValue('#requestReason-request_alpha', 'Verified business need.');
    approveWithoutReason.click();
    await waitForText('Verifier access approved.');
    setValue('#requestStatusFilter', 'approved');
    await waitForText('Verified business need.');
    setValue('#requestStatusFilter', 'pending');
    setValue('#requestReason-request_late', 'Insufficient context.');
    const denyButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText === 'Deny');
    if (!denyButton) throw new Error('deny request button missing');
    denyButton.click();
    await waitForText('Verifier access request denied.');
    setValue('#requestStatusFilter', 'denied');
    await waitForText('Insufficient context.');

    clickButton('Attestations');
    await waitForText('New attestation');
    await waitForText('Search');
    await waitForText('Launch evidence');
    const detailsRow = [...document.querySelectorAll('tbody tr')].find((row) =>
      row.innerText.includes('Launch evidence'),
    );
    if (!detailsRow) throw new Error('attestation details row missing');
    detailsRow.click();
    await waitForText('Full record with receipt proof, verifier access, attempts, and events for this attestation.');
    await waitForText('Available');
    await waitForText('pkg_smoke');
    await waitForText('Receipt bundle');
    await waitForText('http://127.0.0.1:3003/v/vrf_smoke');
    await waitForText('PDF:');
    await waitForText('Verifications');
    const technicalReceiptSummary = [...document.querySelectorAll('summary')].find((summary) =>
      summary.innerText.includes('Technical receipt data'),
    );
    if (!technicalReceiptSummary) throw new Error('technical receipt summary missing');
    technicalReceiptSummary.click();
    const receiptButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText.includes('Load data'));
    if (!receiptButton || receiptButton.disabled) {
      throw new Error('receipt button missing or disabled');
    }
    receiptButton.click();
    await waitForText('Receipt loaded.');
    await waitForText('Receipt evidence summary');
    const receiptEvidenceSummary = [...document.querySelectorAll('summary')].find((summary) =>
      summary.innerText.includes('Receipt evidence summary'),
    );
    if (!receiptEvidenceSummary) throw new Error('receipt evidence summary missing');
    receiptEvidenceSummary.click();
    await waitForText('Receipt package');
    await waitForText('Receipt Merkle root');
    await waitForText('Manifest SHA-256');
    await waitForText('Device signature');
    await waitForText('Receipt JSON');
    const receiptJsonSummary = [...document.querySelectorAll('summary')].find((summary) =>
      summary.innerText.includes('Receipt JSON'),
    );
    if (!receiptJsonSummary) throw new Error('receipt JSON summary missing');
    receiptJsonSummary.click();
    await waitForText('Download JSON');
    await waitForText('attestation_id');

    clickButton('Verifications');
    await waitForText('Verifier access');
    await waitForText('verifier@example.com');
    await waitForText('Showing 8 of 11 matching verifiers');
    clickButton('Next');
    await waitForText('late-verifier@example.com');
    clickButton('Previous');
    setValue('#verifierSearch', 'pending-verifier-3');
    await waitForText('pending-verifier-3@example.com');
    await waitForMissingText('verifier@example.com');
    setValue('#verifierSearch', '');
    setValue('#verifierStatusFilter', 'claimed');
    await waitForText('verifier@example.com');
    await waitForMissingText('pending-verifier-1@example.com');
    setValue('#verifierStatusFilter', 'all');
    const verifierSortButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === 'Sort by Verifier');
    if (!verifierSortButton) throw new Error('verifier sort button missing');
    verifierSortButton.click();
    await waitForText('alpha-verifier@example.com');
    clickButton('New verifier');
    await waitForInput('#grantEmail');
    setValue('#grantEmail', 'new-verifier@example.com');
    await waitForText('Private verifier lookup:');
    await waitForText('http://127.0.0.1:3003/lookups/att_smoke');
    const grantNote = document.querySelector('#grantNote');
    if (!grantNote?.value.includes('This private lookup checks one attestation; it is not the public receipt page.')) {
      throw new Error('private verifier lookup handoff copy missing distinction from public receipt');
    }
    clickButton('Grant access');
    await waitForText('Access grant created.');
    await waitForText('new-verifier@example.com');
    const revokeAccessButton = [...document.querySelectorAll('button')]
      .filter((button) => button.getAttribute('aria-label')?.includes('Revoke'))
      .at(-1);
    if (!revokeAccessButton) throw new Error('revoke access button missing');
    revokeAccessButton.click();
    await waitForText('Access grant revoked.');

    clickButton('Attestations');
    await waitForText('New attestation');
    clickButton('New attestation');
    await waitForText('Select one or more files to compute SHA-256');
    setValue('#attestationLabel', 'Smoke upload');
    const dropZone = document.querySelector('[data-testid="attestation-dropzone"]');
    if (!dropZone) throw new Error('attestation drop zone missing');
    const file = new File(['smoke fixture bytes'], 'smoke.txt', {
      type: 'text/plain'
    });
    const secondFile = new File(['second smoke fixture bytes'], 'smoke-two.txt', {
      type: 'text/plain'
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    transfer.items.add(secondFile);
    dropZone.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
    await waitForText('6f8e688902081dafe076cfc693909a4a411b86c0c48f8242e6829f2e51d7c1e3');
    await waitForText('smoke-two');

    const submitButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText === 'Submit attestation');
    if (!submitButton || submitButton.disabled) {
      throw new Error('submit attestation button missing or disabled');
    }
    submitButton.click();
    await waitForText('Attestation Detail');
    await waitForText('Smoke upload');
    await waitForText('Available');

    clickButton('Attestations');
    await waitForText('Search');
    await waitForText('New attestation');
    clickButton('New attestation');
    await waitForText('File + content proof');
    await waitForText('Select one or more files to compute SHA-256');
    await waitForMissingText('smoke.txt');
    await waitForMissingText('smoke-two');
    const pasteHashButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText.includes('External SHA-256 only'));
    if (!pasteHashButton) throw new Error('paste hash button missing');
    pasteHashButton.click();
    await waitForText('Results');
    setValue('#attestationLabel', 'External hash smoke');
    setValue('#externalHash', 'd'.repeat(64));
    await waitForText('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
    const submitExternalButton = [...document.querySelectorAll('button')]
      .find((button) => button.innerText === 'Submit attestation');
    if (!submitExternalButton || submitExternalButton.disabled) {
      throw new Error('external submit button missing or disabled');
    }
    submitExternalButton.click();
    await waitForText('Prepared');
    await waitForText('Submitted');
    await waitForText('Confirmed');
    await waitForText('Failed');
    await waitForText('External hash smoke');
    await waitForText('Attestation status: validating');

    clickButton('Events');
    await waitForText('Events');
    await waitForText('Full workspace audit');
    await waitForText('Device Revoked');
    await waitForText('owner@example.com');
    await waitForText('device_backup');
    clickButton('Exports');
    await waitForText('Export filters');
    await waitForText('Recent evidence exports');
    clickButton('Records');
    await waitForText('EVENT RECORDS');
  })()
`;

const producerSmokeScript = `
  (async () => {
    const waitForText = async (needle, timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (document.body.innerText.includes(needle)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('missing text: ' + needle + '\\n' + document.body.innerText);
    };
    const clickButton = (label) => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.innerText.includes(label));
      if (!button) throw new Error('missing button: ' + label);
      button.click();
      return button;
    };

    await waitForText('Workspace session');
    await waitForText('Role');
    await waitForText('Workspace member');
    await waitForText('Recent local attestations');
    await waitForText('Launch evidence');
    clickButton('producer@example.com');
    await waitForText('Trusted devices');
    await waitForText('Workspace access');
    if (document.body.innerText.includes('Users')) {
      throw new Error('producer navigation exposed users menu');
    }
    if (document.body.innerText.includes('Invite member')) {
      throw new Error('producer account view exposed invite form');
    }
    if (document.body.innerText.includes('Pending invitations')) {
      throw new Error('producer account view exposed invitations list');
    }
    if (document.body.innerText.includes('owner@example.com')) {
      throw new Error('producer account view fetched admin member list');
    }

    clickButton('Projects');
    await waitForText('Evidence Archive');
    if (document.body.innerText.includes('Retired Evidence')) {
      throw new Error('producer project list included archived projects');
    }
    if ([...document.querySelectorAll('button')].some((button) => button.innerText === 'Archive')) {
      throw new Error('producer project view exposed archive controls');
    }

    clickButton('Events');
    await waitForText('Events');
    await waitForText('Limited producer audit');
    await waitForText('Device Revoked');
  })()
`;

export const registerSmokeRpc = (mode: SmokeMode = 'auth'): void => {
  const now = new Date('2026-05-20T12:00:00.000Z').toISOString();
  const isProducerSmoke = mode === 'auth-producer';
  const projects: ProjectSummary[] = [
    {
      id: 'project_smoke',
      slug: 'evidence-archive',
      name: 'Evidence Archive',
      description: null,
      visibility: 'public',
      createdAt: now,
      archivedAt: null,
    },
    {
      id: 'project_archived',
      slug: 'retired-evidence',
      name: 'Retired Evidence',
      description: null,
      visibility: 'private',
      createdAt: now,
      archivedAt: now,
    },
  ];
  const attestations: AttestationSummary[] = [
    {
      id: 'att_smoke',
      label: 'Launch evidence',
      description: null,
      state: 'confirmed',
      createdAt: now,
      confirmedAt: now,
      projectSlug: 'evaluation-evidence',
      projectName: 'Evaluation Evidence',
    },
  ];
  const devices: DeviceSummary[] = [
    {
      id: 'device_smoke',
      isCurrent: true,
      tenantId: 'tenant_smoke',
      tenantSlug: 'acme-labs',
      tenantName: 'Acme Labs',
      profileId: 'device_smoke',
      name: 'Smoke Mac',
      platform: 'darwin',
      appVersion: 'smoke',
      pairedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
    {
      id: 'device_backup',
      isCurrent: false,
      tenantId: 'tenant_smoke',
      tenantSlug: 'acme-labs',
      tenantName: 'Acme Labs',
      profileId: 'device_backup',
      name: 'Backup Mac',
      platform: 'darwin',
      appVersion: 'smoke',
      pairedAt: now,
      lastSeenAt: null,
      revokedAt: null,
    },
  ];
  const tenantDevices: TenantDeviceSummary[] = [
    {
      id: 'device_smoke',
      userId: 'user_smoke',
      profileId: 'device_smoke',
      name: 'Smoke Mac',
      platform: 'darwin',
      appVersion: 'smoke',
      pairedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
    {
      id: 'device_producer',
      userId: 'user_producer',
      profileId: 'device_producer',
      name: 'Producer Laptop',
      platform: 'darwin',
      appVersion: 'smoke',
      pairedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  ];
  const smokeMemberWorkspaces = [
    {
      id: 'tenant_smoke',
      slug: 'acme-labs',
      name: 'Acme Labs',
      role: 'tenant_admin',
    },
    {
      id: 'tenant_legal',
      slug: 'acme-legal',
      name: 'Acme Legal',
      role: 'tenant_admin',
    },
  ];
  const members: TenantMemberSummary[] = [
    {
      userId: 'user_smoke',
      email: 'owner@example.com',
      displayName: null,
      role: 'tenant_admin',
      organizationRole: 'organization_admin',
      workspaceAccessMode: 'selected_workspaces',
      joinedAt: now,
      workspaces: smokeMemberWorkspaces,
    },
    {
      userId: 'user_producer',
      email: 'producer@example.com',
      displayName: 'Smoke Producer',
      role: 'producer',
      organizationRole: 'member',
      workspaceAccessMode: 'selected_workspaces',
      joinedAt: now,
      workspaces: [
        {
          id: 'tenant_smoke',
          slug: 'acme-labs',
          name: 'Acme Labs',
          role: 'producer',
        },
      ],
    },
  ];
  const invitations: TenantInvitationSummary[] = [
    {
      id: 'invite_smoke',
      email: 'pending@example.com',
      role: 'producer',
      createdAt: now,
      expiresAt: now,
    },
  ];
  const accessGrants: AttestationAccessGrantSummary[] = [
    {
      id: 'grant_smoke',
      grantedToEmail: 'verifier@example.com',
      createdAt: now,
      pending: false,
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `grant_pending_${index + 1}`,
      grantedToEmail: `pending-verifier-${index + 1}@example.com`,
      createdAt: now,
      pending: true,
    })),
    {
      id: 'grant_alpha',
      grantedToEmail: 'alpha-verifier@example.com',
      createdAt: now,
      pending: true,
    },
    {
      id: 'grant_late',
      grantedToEmail: 'late-verifier@example.com',
      createdAt: now,
      pending: true,
    },
  ];
  const accessRequests: AttestationAccessRequestSummary[] = [
    {
      id: 'request_smoke',
      attestationId: 'att_smoke',
      requestedByEmail: 'verifier-requester@example.com',
      message: 'Need access for audit review.',
      status: 'pending',
      resolutionReason: null,
      createdAt: now,
      resolvedAt: null,
      attestation: { id: 'att_smoke', label: 'Launch evidence' },
      project: { slug: 'evidence-archive', name: 'Evidence Archive' },
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `request_pending_${index + 1}`,
      attestationId: 'att_smoke',
      requestedByEmail: `pending-requester-${index + 1}@example.com`,
      message: null,
      status: 'pending',
      resolutionReason: null,
      createdAt: now,
      resolvedAt: null,
      attestation: { id: 'att_smoke', label: 'Launch evidence' },
      project: { slug: 'evidence-archive', name: 'Evidence Archive' },
    })),
    {
      id: 'request_alpha',
      attestationId: 'att_smoke',
      requestedByEmail: 'alpha-requester@example.com',
      message: null,
      status: 'pending',
      resolutionReason: null,
      createdAt: now,
      resolvedAt: null,
      attestation: { id: 'att_smoke', label: 'Launch evidence' },
      project: { slug: 'evidence-archive', name: 'Evidence Archive' },
    },
    {
      id: 'request_late',
      attestationId: 'att_smoke',
      requestedByEmail: 'late-requester@example.com',
      message: null,
      status: 'pending',
      resolutionReason: null,
      createdAt: now,
      resolvedAt: null,
      attestation: { id: 'att_smoke', label: 'Launch evidence' },
      project: { slug: 'evidence-archive', name: 'Evidence Archive' },
    },
    {
      id: 'request_denied',
      attestationId: 'att_smoke',
      requestedByEmail: 'denied-requester@example.com',
      message: null,
      status: 'denied',
      resolutionReason: 'Denied by policy.',
      createdAt: now,
      resolvedAt: now,
      attestation: { id: 'att_smoke', label: 'Launch evidence' },
      project: { slug: 'evidence-archive', name: 'Evidence Archive' },
    },
  ];
  const auditEvents: TenantAuditEventSummary[] = [
    {
      id: 'audit_device_revoked',
      category: 'basic_admin',
      action: 'device_revoked',
      targetType: 'device',
      targetId: 'device_backup',
      payload: {},
      actorUserId: 'user_smoke',
      actorDeviceId: 'device_smoke',
      actorEmail: 'owner@example.com',
      createdAt: now,
    },
    {
      id: 'audit_invitation_created',
      category: 'basic_admin',
      action: 'tenant_invitation_created',
      targetType: 'tenant_invitation',
      targetId: 'invite_smoke',
      payload: {},
      actorUserId: 'user_smoke',
      actorDeviceId: 'device_smoke',
      actorEmail: 'owner@example.com',
      createdAt: now,
    },
  ];

  let activeSmokeWorkspaceId = 'tenant_smoke';
  const smokeWorkspaces: WorkspaceSummary[] = [
    {
      id: 'tenant_smoke',
      slug: 'acme-labs',
      name: 'Acme Labs',
      plan: 'team_pro',
      role: isProducerSmoke ? 'producer' : 'tenant_admin',
      organizationId: 'org_smoke',
      archivedAt: null,
    },
    {
      id: 'tenant_legal_smoke',
      slug: 'acme-legal',
      name: 'Acme Legal',
      plan: 'team_pro',
      role: isProducerSmoke ? 'producer' : 'tenant_admin',
      organizationId: 'org_smoke',
      archivedAt: null,
    },
  ];
  const smokeOrganizations: OrganizationSummary[] = [
    {
      id: 'org_smoke',
      name: 'Acme Organization',
      role: isProducerSmoke ? 'member' : 'organization_admin',
      workspaceAccessMode: 'selected_workspaces',
    },
  ];

  registerRpc('auth.currentSession', async () => {
    const activeWorkspace =
      smokeWorkspaces.find((workspace) => workspace.id === activeSmokeWorkspaceId) ??
      smokeWorkspaces[0]!;
    return ok({
      user: {
        id: isProducerSmoke ? 'user_producer' : 'user_smoke',
        email: isProducerSmoke ? 'producer@example.com' : 'owner@example.com',
      },
      activeWorkspace,
      organizations: smokeOrganizations,
      workspaces: smokeWorkspaces,
      profileId: 'device_smoke',
      deviceId: 'device_smoke',
      apiUrl: 'http://127.0.0.1:3001',
    });
  });
  registerRpc('auth.switchWorkspace', async ({ workspaceId }) => {
    activeSmokeWorkspaceId = workspaceId;
    const activeWorkspace =
      smokeWorkspaces.find((workspace) => workspace.id === activeSmokeWorkspaceId) ??
      smokeWorkspaces[0]!;
    return ok({
      activeWorkspace,
      organizations: smokeOrganizations,
      workspaces: smokeWorkspaces,
    });
  });
  registerRpc('auth.signOut', async () => ok({ ok: true } as const));
  registerRpc('tenant.workspaces.create', async ({ name }) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const workspace: WorkspaceSummary = {
      id: `tenant_${slug}`,
      slug,
      name,
      plan: 'team_pro',
      role: 'tenant_admin',
      organizationId: 'org_smoke',
      archivedAt: null,
    };
    smokeWorkspaces.push(workspace);
    smokeMemberWorkspaces.push({
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      role: workspace.role,
    });
    const owner = members.find((member) => member.userId === 'user_smoke');
    if (owner) owner.workspaces = smokeMemberWorkspaces;
    activeSmokeWorkspaceId = workspace.id;
    return ok({ tenant: workspace });
  });
  registerRpc('tenant.workspaces.archive', async ({ workspaceId }) => {
    const workspace = smokeWorkspaces.find((candidate) => candidate.id === workspaceId);
    if (workspace) workspace.archivedAt = now;
    return ok({ tenant: workspace ?? smokeWorkspaces[0]! });
  });
  registerRpc('tenant.workspaces.restore', async ({ workspaceId }) => {
    const workspace = smokeWorkspaces.find((candidate) => candidate.id === workspaceId);
    if (workspace) workspace.archivedAt = null;
    return ok({ tenant: workspace ?? smokeWorkspaces[0]! });
  });
  registerRpc('projects.list', async ({ includeArchived }) =>
    ok({
      projects:
        includeArchived && !isProducerSmoke
          ? projects
          : projects.filter((project) => !project.archivedAt),
    }),
  );
  registerRpc('projects.create', async ({ slug, name }) => {
    const project: ProjectSummary = {
      id: `project_${projects.length + 1}`,
      slug,
      name,
      description: null,
      visibility: 'public',
      createdAt: now,
      archivedAt: null,
    };
    projects.push(project);
    return ok({ project });
  });
  registerRpc('projects.archive', async ({ projectSlug }) => {
    const project = projects.find((candidate) => candidate.slug === projectSlug);
    if (project) project.archivedAt = now;
    return ok({ project: project ?? projects[0]! });
  });
  registerRpc('projects.restore', async ({ projectSlug }) => {
    const project = projects.find((candidate) => candidate.slug === projectSlug);
    if (project) project.archivedAt = null;
    return ok({ project: project ?? projects[0]! });
  });
  registerRpc('attestations.list', async () => ok({ attestations }));
  registerRpc('attestations.recent', async () =>
    ok({
      attestations: attestations.map((attestation) => ({
        ...attestation,
        failedAt: null,
        projectSlug: 'evidence-archive',
        projectName: 'Evidence Archive',
      })),
    }),
  );
  registerRpc('attestations.get', async ({ attestationId }) => {
    const attestation = attestations.find((a) => a.id === attestationId);
    const confirmed = attestation?.state === 'confirmed';
    return ok({
      attestation: {
        id: attestationId,
        label: attestation?.label ?? 'Unknown',
        state: attestation?.state ?? 'pending',
        confirmedAttemptId: confirmed ? 'attempt_smoke' : null,
        manifestObjectKey: 'tenants/tenant_smoke/projects/project_smoke/att_smoke/manifest.json',
        merkleRoot: confirmed ? 'a'.repeat(64) : null,
        packageId: confirmed ? 'pkg_smoke' : null,
        receiptAvailable: confirmed,
        verificationLinkId: confirmed ? 'vrf_smoke' : null,
        createdAt: now,
        confirmedAt: confirmed ? now : null,
        tenantSlug: 'acme-labs',
        coverageType: 'whole-file',
        shinglingPresets: [],
        extractionMethods: [],
      },
      attempts: [
        {
          id: 'attempt_smoke',
          state: confirmed ? 'validated' : 'uploaded',
          validationError: null,
          isConfirmed: confirmed,
          createdAt: now,
          uploadedAt: now,
          validatedAt: confirmed ? now : null,
          failedAt: null,
          sourceMetadata: null,
        },
      ],
    });
  });
  registerRpc('attestations.createWholeFile', async ({ label, sha256Hex }) => {
    const id = `att_${attestations.length + 1}`;
    const confirmed = label === 'Smoke upload' || label === 'smoke-two';
    attestations.push({
      id,
      label,
      description: null,
      state: confirmed ? 'confirmed' : 'validating',
      createdAt: now,
      confirmedAt: confirmed ? now : null,
      projectSlug: 'evaluation-evidence',
      projectName: 'Evaluation Evidence',
    });
    return ok({
      attestationId: id,
      attemptId: `attempt_${attestations.length}`,
      state: confirmed ? 'confirmed' : 'validating',
      merkleRoot: 'b'.repeat(64),
      leafHash: 'c'.repeat(64),
      submittedHash: sha256Hex,
      shingleCount: 0,
      componentCount: 0,
    });
  });
  registerRpc('attestations.receipt', async () =>
    ok({
      signatureValid: true,
      receipt: {
        attestation_id: 'att_smoke',
        package_id: 'pkg_smoke',
        merkle_root: 'a'.repeat(64),
        manifest_canonical_sha256: 'b'.repeat(64),
        confirmed_at: now,
        issued_at: now,
        device_signature: {
          key_id: 'device_smoke',
          algorithm: 'ed25519',
          verified: true,
        },
        signatures: [
          {
            signer_kind: 'proveria',
            key_id: 'proveria-test-key',
            algorithm: 'ed25519',
            signature: 'smoke-signature',
          },
        ],
      },
    }),
  );
  registerRpc('attestations.accessGrants.list', async () => ok({ grants: accessGrants }));
  registerRpc('attestations.accessGrants.create', async ({ email }) => {
    const grant: AttestationAccessGrantSummary = {
      id: `grant_${accessGrants.length + 1}`,
      grantedToEmail: email,
      createdAt: now,
      pending: true,
    };
    accessGrants.push(grant);
    return ok({ grant });
  });
  registerRpc('attestations.accessGrants.revoke', async ({ grantId }) => {
    const index = accessGrants.findIndex((grant) => grant.id === grantId);
    if (index >= 0) accessGrants.splice(index, 1);
    return ok({ ok: true } as const);
  });
  registerRpc('attestations.accessRequests.list', async ({ status }) =>
    ok({
      requests:
        status && status !== 'all'
          ? accessRequests.filter((request) => request.status === status)
          : accessRequests,
    }),
  );
  registerRpc('attestations.accessRequests.approve', async ({ requestId, reason }) => {
    const request = accessRequests.find((candidate) => candidate.id === requestId);
    if (request) {
      request.status = 'approved';
      request.resolutionReason = reason;
      request.resolvedAt = now;
    }
    const grant: AttestationAccessGrantSummary = {
      id: `grant_${accessGrants.length + 1}`,
      grantedToEmail: request?.requestedByEmail ?? 'approved@example.com',
      createdAt: now,
      pending: true,
    };
    accessGrants.push(grant);
    return ok({
      request: { id: requestId, status: 'approved', resolvedAt: now },
      grant,
    });
  });
  registerRpc('attestations.accessRequests.deny', async ({ requestId, reason }) => {
    const request = accessRequests.find((candidate) => candidate.id === requestId);
    if (request) {
      request.status = 'denied';
      request.resolutionReason = reason;
      request.resolvedAt = now;
    }
    return ok({
      request: { id: requestId, status: 'denied', resolvedAt: now },
    });
  });
  registerRpc('devices.list', async () => ok({ devices }));
  registerRpc('devices.listForWorkspace', async () => ok({ devices: tenantDevices }));
  registerRpc('devices.revoke', async ({ deviceId }) => {
    const device = devices.find((d) => d.id === deviceId);
    if (device) device.revokedAt = now;
    const tenantDevice = tenantDevices.find((d) => d.id === deviceId);
    if (tenantDevice) tenantDevice.revokedAt = now;
    return ok({ ok: true } as const);
  });
  registerRpc('devices.revokeForWorkspace', async ({ deviceId }) => {
    const device = devices.find((d) => d.id === deviceId);
    if (device) device.revokedAt = now;
    const tenantDevice = tenantDevices.find((d) => d.id === deviceId);
    if (tenantDevice) tenantDevice.revokedAt = now;
    return ok({ ok: true } as const);
  });
  registerRpc('tenant.members.list', async () => {
    if (isProducerSmoke) {
      throw new Error('producer smoke must not call tenant.members.list');
    }
    return ok({ members });
  });
  registerRpc('tenant.members.remove', async ({ userId }) => {
    const index = members.findIndex((member) => member.userId === userId);
    if (index >= 0) members.splice(index, 1);
    return ok({ ok: true } as const);
  });
  registerRpc(
    'tenant.members.updateAccess',
    async ({
      userId,
      role,
      organizationRole,
      workspaceAccessMode,
      workspaceIds,
    }) => {
      const member = members.find((candidate) => candidate.userId === userId);
      if (member) {
        if (role) member.role = role;
        if (organizationRole) member.organizationRole = organizationRole;
        if (workspaceAccessMode) member.workspaceAccessMode = workspaceAccessMode;
        if (workspaceIds) {
          member.workspaces = workspaceIds.map((workspaceId: string) => {
            const workspace =
              smokeMemberWorkspaces.find((candidate) => candidate.id === workspaceId) ??
              {
                id: workspaceId,
                slug: workspaceId,
                name: workspaceId,
                role: role ?? member.role,
              };
            return {
              ...workspace,
              role: role ?? member.role,
            };
          });
        }
      }
      return ok({
        member: {
          userId,
          role:
            workspaceAccessMode === 'none'
              ? null
              : (role ?? member?.role ?? null),
          organizationRole:
            organizationRole ?? member?.organizationRole ?? 'member',
          workspaceAccessMode:
            workspaceAccessMode ??
            member?.workspaceAccessMode ??
            'selected_workspaces',
          revoked: workspaceAccessMode === 'none',
        },
      });
    },
  );
  registerRpc('tenant.invitations.list', async () => {
    if (isProducerSmoke) {
      throw new Error('producer smoke must not call tenant.invitations.list');
    }
    return ok({ invitations });
  });
  registerRpc('tenant.invitations.create', async ({ email, role }) => {
    const invitation: TenantInvitationSummary = {
      id: `invite_${invitations.length + 1}`,
      email,
      role,
      createdAt: now,
      expiresAt: now,
    };
    invitations.push(invitation);
    return ok({ invitation });
  });
  registerRpc('tenant.invitations.revoke', async ({ invitationId }) => {
    const index = invitations.findIndex((invitation) => invitation.id === invitationId);
    if (index >= 0) invitations.splice(index, 1);
    return ok({ ok: true } as const);
  });
  registerRpc('tenant.audit.list', async () =>
    ok({
      events: auditEvents,
      scope: isProducerSmoke ? ('limited' as const) : ('full' as const),
    }),
  );
  registerRpc('tenant.audit.export', async ({ format }) =>
    ok({
      filename: `proveria-events-smoke.${format}`,
      contentType: format === 'csv' ? 'text/csv' : 'application/json',
      body:
        format === 'csv'
          ? 'id,createdAt,category,action\n'
          : JSON.stringify({ events: auditEvents }),
    }),
  );
  registerRpc('tenant.evidenceExport.manifest', async () =>
    ok({
      filename: 'proveria-evidence-manifest-smoke.json',
      contentType: 'application/json',
      body: JSON.stringify({
        export: { type: 'evidence_manifest' },
        attestations,
      }),
    }),
  );
  registerRpc('tenant.evidenceExport.jobs.create', async () =>
    ok({
      job: {
        id: 'export_job_smoke',
        kind: 'evidence_bundle',
        status: 'completed',
        filters: {},
        artifactCount: 2,
        rowCount: attestations.length,
        resultObjectKey: null,
        error: null,
        progressPercent: 100,
        retryCount: 0,
        maxRetries: 3,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        retentionPolicy: {
          retention_days: 30,
          delete_after_expiration: true,
        },
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      filename: 'proveria-evidence-export-smoke.json',
      contentType: 'application/json',
      body: JSON.stringify({
        export: { type: 'evidence_export_job_manifest' },
        attestations,
      }),
    }),
  );
  registerRpc('tenant.evidenceExport.jobs.list', async () =>
    ok({
      jobs: [
        {
          id: 'export_job_smoke',
          kind: 'evidence_bundle',
          status: 'completed',
          filters: {},
          artifactCount: 2,
          rowCount: attestations.length,
          resultObjectKey: null,
          error: null,
          progressPercent: 100,
          retryCount: 0,
          maxRetries: 3,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          retentionPolicy: {
            retention_days: 30,
            delete_after_expiration: true,
          },
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ],
    }),
  );
};
