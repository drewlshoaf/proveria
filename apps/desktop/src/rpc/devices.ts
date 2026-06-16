import { BrowserWindow } from 'electron';

import { signedRequest } from '../api-client.js';
import { loadSession } from '../session-store.js';

import { fail, ok, registerRpc } from './handlers.js';
import type {
  DeviceSummary,
  ExternalIdentitySummary,
  TenantDeviceSummary,
} from './types.js';

interface DevicesResponse {
  devices: DeviceSummary[];
}

interface TenantDevicesResponse {
  devices: TenantDeviceSummary[];
}

interface ExternalIdentitiesResponse {
  identities: ExternalIdentitySummary[];
}

interface OidcStartResponse {
  authorizationUrl: string;
}

export const registerDeviceRpc = (): void => {
  registerRpc('devices.list', async () => {
    try {
      const response = await signedRequest<DevicesResponse>({
        method: 'GET',
        path: '/me/devices',
      });
      return ok(response);
    } catch (err) {
      return fail(
        'devices_list_failed',
        err instanceof Error ? err.message : 'Could not load trusted devices.',
      );
    }
  });

  registerRpc('devices.listForWorkspace', async () => {
    const session = await loadSession();
    if (!session) {
      return fail('not_signed_in', 'Sign in to view trusted devices.');
    }
    try {
      const response = await signedRequest<TenantDevicesResponse>({
        method: 'GET',
        path: `/tenants/${session.activeWorkspace.slug}/devices`,
      });
      return ok(response);
    } catch (err) {
      return fail(
        'workspace_devices_list_failed',
        err instanceof Error
          ? err.message
          : 'Could not load workspace trusted devices.',
      );
    }
  });

  registerRpc('devices.revoke', async ({ deviceId }) => {
    try {
      await signedRequest({
        method: 'POST',
        path: `/me/devices/${deviceId}/revoke`,
        body: {},
      });
      return ok({ ok: true } as const);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      if (body?.error === 'already_revoked') {
        return fail('already_revoked', 'That device is already revoked.');
      }
      return fail(
        body?.error ?? 'device_revoke_failed',
        err instanceof Error ? err.message : 'Could not revoke device.',
      );
    }
  });

  registerRpc('devices.revokeForWorkspace', async ({ deviceId }) => {
    const session = await loadSession();
    if (!session) {
      return fail('not_signed_in', 'Sign in to revoke trusted devices.');
    }
    try {
      await signedRequest({
        method: 'POST',
        path: `/tenants/${session.activeWorkspace.slug}/devices/${deviceId}/revoke`,
        body: {},
      });
      return ok({ ok: true } as const);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      if (body?.error === 'already_revoked') {
        return fail('already_revoked', 'That device is already revoked.');
      }
      return fail(
        body?.error ?? 'workspace_device_revoke_failed',
        err instanceof Error ? err.message : 'Could not revoke trusted device.',
      );
    }
  });

  registerRpc('externalIdentities.list', async () => {
    try {
      const response = await signedRequest<ExternalIdentitiesResponse>({
        method: 'GET',
        path: '/me/external-identities',
      });
      return ok(response);
    } catch (err) {
      return fail(
        'external_identities_list_failed',
        err instanceof Error
          ? err.message
          : 'Could not load connected sign-in methods.',
      );
    }
  });

  registerRpc('externalIdentities.connect', async ({ provider }) => {
    const session = await loadSession();
    if (!session) {
      return fail('not_signed_in', 'Sign in before connecting a sign-in method.');
    }
    let started: OidcStartResponse;
    try {
      started = await signedRequest<OidcStartResponse>({
        method: 'GET',
        path: `/me/external-identities/${encodeURIComponent(provider)}/connect/start`,
      });
    } catch (err) {
      return fail(
        'external_identity_connect_start_failed',
        err instanceof Error
          ? err.message
          : 'Could not start provider connection.',
      );
    }
    try {
      await runOidcBrowserFlow({
        apiUrl: session.apiUrl,
        authorizationUrl: started.authorizationUrl,
      });
      return ok({ ok: true } as const);
    } catch (err) {
      return fail(
        'external_identity_connect_failed',
        err instanceof Error
          ? err.message
          : 'Provider connection did not complete.',
      );
    }
  });

  registerRpc('externalIdentities.disconnect', async ({ identityId }) => {
    try {
      await signedRequest({
        method: 'POST',
        path: `/me/external-identities/${identityId}/disconnect`,
        body: {},
      });
      return ok({ ok: true } as const);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      if (body?.error === 'last_external_identity') {
        return fail(
          'last_external_identity',
          'Add another sign-in method before disconnecting this one.',
        );
      }
      if (body?.error === 'already_disconnected') {
        return fail(
          'already_disconnected',
          'That sign-in method is already disconnected.',
        );
      }
      return fail(
        body?.error ?? 'external_identity_disconnect_failed',
        err instanceof Error
          ? err.message
          : 'Could not disconnect sign-in method.',
      );
    }
  });
};

const runOidcBrowserFlow = async (input: {
  apiUrl: string;
  authorizationUrl: string;
}): Promise<void> => {
  const apiOrigin = new URL(input.apiUrl).origin;
  const authWindow = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Connect sign-in method',
    parent: BrowserWindow.getFocusedWindow() ?? undefined,
    modal: false,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      authWindow.close();
      resolve();
    };
    const failFlow = (err: Error): void => {
      if (settled) return;
      settled = true;
      authWindow.close();
      reject(err);
    };
    const checkForCallback = (url: string): void => {
      if (url.startsWith(apiOrigin)) finish();
    };

    authWindow.on('closed', () => {
      if (!settled) {
        settled = true;
        reject(new Error('Sign-in window was closed before completion.'));
      }
    });
    authWindow.webContents.on('did-navigate', (_event, url) => {
      checkForCallback(url);
    });
    authWindow.webContents.on('did-navigate-in-page', (_event, url) => {
      checkForCallback(url);
    });
    authWindow.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
      checkForCallback(url);
    });

    authWindow.loadURL(input.authorizationUrl).catch(failFlow);
  });
};
