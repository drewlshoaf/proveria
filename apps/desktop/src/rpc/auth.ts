import os from 'node:os';
import { hostname, platform } from 'node:os';
import { BrowserWindow } from 'electron';

import { generateEd25519Keypair } from '@proveria/crypto-core';

import {
  signedRequest,
  sessionPost,
  unsignedGet,
  unsignedPost,
  unsignedPostWithHeaders,
} from '../api-client.js';
import { clearPrivateKey, storePrivateKey } from '../keychain.js';
import { clearSession, loadSession, saveSession } from '../session-store.js';

import { fail, ok, registerRpc } from './handlers.js';
import type { OrganizationSummary, WorkspaceSummary } from './types.js';

interface DeviceMintResponse {
  device: { id: string; name: string; platform: string };
  user: { id: string; email: string; displayName?: string | null };
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    role: 'tenant_admin' | 'producer' | 'consumer';
    organizationId?: string | null;
  };
  organizations?: OrganizationSummary[];
  workspaces?: WorkspaceSummary[];
}

interface RegisterResponse {
  user: { id: string; email: string; displayName: string | null };
  tenant: { id: string; slug: string; plan: string } | null;
}

interface WorkspaceCreateResponse {
  tenant: { id: string; slug: string; name: string; plan: string };
}

interface CurrentSessionResponse {
  user: { id: string; email: string; displayName?: string | null };
  organizations?: OrganizationSummary[];
  workspaces: WorkspaceSummary[];
}

interface OidcProvidersResponse {
  providers: Array<{
    slug: string;
    displayName: string;
    issuerUrl: string;
    scopes: string[];
  }>;
}

interface OidcStartResponse {
  authorizationUrl: string;
}

const defaultDeviceName = (): string => {
  try {
    const h = hostname();
    return h && h.length > 0 ? h : `${platform()}-${os.userInfo().username}`;
  } catch {
    return platform();
  }
};

const electronPlatform = (): 'darwin' | 'win32' => {
  switch (process.platform) {
    case 'win32':
      return 'win32';
    case 'darwin':
    default:
      return 'darwin';
  }
};

export const registerAuthRpc = (): void => {
  registerRpc(
    'auth.register',
    async ({
      email,
      password,
      displayName,
      workspaceName,
      apiUrl,
      invitationToken,
    }) => {
      const trimmedApiUrl = apiUrl.replace(/\/$/, '');
      const trimmedEmail = email.trim();
      const trimmedWorkspaceName = workspaceName.trim();
      if (!trimmedWorkspaceName && !invitationToken?.trim()) {
        return fail('workspace_name_required', 'Name your workspace to continue.');
      }

      let registered: RegisterResponse;
      let cookieHeader: string | null = null;
      try {
        const response = await unsignedPostWithHeaders<RegisterResponse>(
          trimmedApiUrl,
          '/auth/register',
          {
            email: trimmedEmail,
            password,
            ...(displayName?.trim()
              ? { displayName: displayName.trim() }
              : {}),
            ...(invitationToken?.trim()
              ? { invitationToken: invitationToken.trim() }
              : {}),
          },
        );
        registered = response.body;
        cookieHeader = extractCookieHeader(response.headers);
      } catch (err) {
        const status = (err as { status?: number }).status;
        const body = (err as { body?: { error?: string } }).body;
        if (status === 409 && body?.error === 'email_taken') {
          return fail('email_taken', 'An account already exists for that email.');
        }
        if (status === 400 && body?.error === 'invalid_email') {
          return fail('invalid_email', 'Enter a valid email address.');
        }
        if (status === 400) {
          return fail(
            body?.error ?? 'registration_invalid',
            'Registration details were not accepted.',
          );
        }
        return fail(
          'registration_failed',
          err instanceof Error ? err.message : 'Registration failed.',
          );
      }

      let tenant = registered.tenant;
      if (!tenant && !invitationToken?.trim()) {
        if (!cookieHeader) {
          return fail(
            'registration_session_missing',
            'Registration succeeded, but the server did not return a session.',
          );
        }
        try {
          const created = await sessionPost<WorkspaceCreateResponse>(
            trimmedApiUrl,
            '/tenants',
            { name: trimmedWorkspaceName },
            cookieHeader,
          );
          tenant = created.tenant;
        } catch (err) {
          const body = (err as { body?: { error?: string } }).body;
          return fail(
            body?.error ?? 'workspace_create_failed',
            err instanceof Error ? err.message : 'Workspace creation failed.',
          );
        }
      }

      const minted = await mintDevice({
        apiUrl: trimmedApiUrl,
        email: trimmedEmail,
        password,
      });
      if (!minted.ok) return minted;

      return ok({
        user: registered.user,
        activeWorkspace: minted.value.activeWorkspace,
        organizations: minted.value.organizations,
        workspaces: minted.value.workspaces,
        profileId: minted.value.deviceId,
        deviceId: minted.value.deviceId,
      });
    },
  );

  registerRpc('auth.signIn', async ({ email, password, apiUrl }) => {
    const trimmedApiUrl = apiUrl.replace(/\/$/, '');
    const minted = await mintDevice({
      apiUrl: trimmedApiUrl,
      email: email.trim(),
      password,
    });
    if (!minted.ok) return minted;
    return ok(minted.value);
  });

  registerRpc('auth.oidcProviders', async ({ apiUrl }) => {
    const trimmedApiUrl = apiUrl.replace(/\/$/, '');
    try {
      return ok(
        await unsignedGet<OidcProvidersResponse>(
          trimmedApiUrl,
          '/auth/oidc/providers',
        ),
      );
    } catch (err) {
      return fail(
        'oidc_providers_failed',
        err instanceof Error ? err.message : 'OIDC providers could not load.',
      );
    }
  });

  registerRpc('auth.oidcSignIn', async ({ apiUrl, provider }) => {
    const trimmedApiUrl = apiUrl.replace(/\/$/, '');
    let started: OidcStartResponse;
    try {
      started = await unsignedGet<OidcStartResponse>(
        trimmedApiUrl,
        `/auth/oidc/${encodeURIComponent(provider)}/start?redirectTo=%2F`,
      );
    } catch (err) {
      return fail(
        'oidc_start_failed',
        err instanceof Error ? err.message : 'OIDC sign-in could not start.',
      );
    }

    let cookieHeader: string;
    try {
      cookieHeader = await runOidcBrowserFlow({
        apiUrl: trimmedApiUrl,
        authorizationUrl: started.authorizationUrl,
      });
    } catch (err) {
      return fail(
        'oidc_browser_flow_failed',
        err instanceof Error ? err.message : 'OIDC sign-in did not complete.',
      );
    }

    return await mintDeviceFromSession({
      apiUrl: trimmedApiUrl,
      cookieHeader,
    });
  });

  registerRpc('auth.signOut', async () => {
    const session = await loadSession();
    if (session) {
      try {
        await signedRequest({
          method: 'POST',
          path: `/me/devices/${session.deviceId}/revoke`,
          body: {},
        });
      } catch {
        // Sign-out is allowed to complete even if server revocation fails.
      }
    }
    await clearPrivateKey();
    await clearSession();
    return ok({ ok: true } as const);
  });

  registerRpc('auth.switchWorkspace', async ({ workspaceId }) => {
    const session = await loadSession();
    if (!session) {
      return fail('not_signed_in', 'Sign in before switching workspaces.');
    }
    const workspaces = session.workspaces ?? [session.activeWorkspace];
    const activeWorkspace = workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
    if (!activeWorkspace) {
      return fail(
        'workspace_not_available',
        'That workspace is not available to this desktop session.',
      );
    }
    const nextSession = {
      ...session,
      activeWorkspace,
      workspaces,
      organizations: session.organizations ?? [],
    };
    await saveSession(nextSession);
    return ok({
      activeWorkspace,
      organizations: nextSession.organizations,
      workspaces,
    });
  });

  registerRpc('auth.currentSession', async () => {
    const session = await loadSession();
    if (!session) return ok(null);
    let refreshedSession = session;
    try {
      const current = await signedRequest<CurrentSessionResponse>({
        method: 'GET',
        path: '/me/session',
        clearSessionOnUnauthorized: false,
      });
      const workspaces =
        current.workspaces.length > 0
          ? current.workspaces
          : session.workspaces ?? [session.activeWorkspace];
      const activeWorkspace =
        workspaces.find(
          (workspace) => workspace.id === session.activeWorkspace.id,
        ) ?? workspaces[0] ?? session.activeWorkspace;
      refreshedSession = {
        ...session,
        userDisplayName: current.user.displayName ?? null,
        activeWorkspace,
        organizations: current.organizations ?? [],
        workspaces,
      };
      await saveSession(refreshedSession);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const status = (err as { status?: number }).status;
      if (code === 'session_expired' || status === 401) {
        await clearPrivateKey();
        await clearSession();
        return ok(null);
      }
      refreshedSession = session;
    }
    return ok({
      user: {
        id: refreshedSession.userId,
        email: refreshedSession.userEmail,
        displayName: refreshedSession.userDisplayName ?? null,
      },
      profileId: refreshedSession.deviceId,
      deviceId: refreshedSession.deviceId,
      activeWorkspace: refreshedSession.activeWorkspace,
      organizations: refreshedSession.organizations ?? [],
      workspaces: refreshedSession.workspaces ?? [
        refreshedSession.activeWorkspace,
      ],
      apiUrl: refreshedSession.apiUrl,
    });
  });
};

const extractCookieHeader = (headers: Headers): string | null => {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join('; ');
};

const mintDevice = async (input: {
  apiUrl: string;
  email: string;
  password: string;
}): ReturnType<Parameters<typeof registerRpc<'auth.signIn'>>[1]> => {
  let keypair;
  try {
    keypair = await generateEd25519Keypair();
  } catch (err) {
    return fail(
      'keypair_gen_failed',
      err instanceof Error ? err.message : String(err),
    );
  }

  let minted: DeviceMintResponse;
  try {
    minted = await unsignedPost<DeviceMintResponse>(
      input.apiUrl,
      '/auth/device/mint',
      {
        email: input.email,
        password: input.password,
        publicKey: keypair.publicKey,
        deviceName: defaultDeviceName(),
        platform: electronPlatform(),
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: string } }).body;
    if (status === 401) {
      return fail('invalid_credentials', 'Email or password is incorrect.');
    }
    if (status === 403 && body?.error === 'no_tenant_membership') {
      return fail(
        'no_tenant_membership',
        'This account is not assigned to a producer workspace. Use a producer or admin producer account, or rerun pnpm eval:seed for local QA.',
      );
    }
    if (status === 409 && body?.error === 'multiple_tenants_not_supported') {
      return fail(
        'multiple_tenants_not_supported',
        'This account belongs to multiple workspaces. Desktop switching is not available yet.',
      );
    }
    return fail(
      'device_mint_failed',
      err instanceof Error ? err.message : 'Desktop registration failed.',
    );
  }

  await storePrivateKey(keypair.privateKey);
  const workspaces = normalizeWorkspaces(minted);
  const organizations = minted.organizations ?? [];
  await saveSession({
    userId: minted.user.id,
    userEmail: minted.user.email,
    userDisplayName: minted.user.displayName ?? null,
    deviceId: minted.device.id,
    publicKey: keypair.publicKey,
    apiUrl: input.apiUrl,
    signedInAt: new Date().toISOString(),
    activeWorkspace: minted.tenant,
    organizations,
    workspaces,
  });

  return ok({
    user: minted.user,
    activeWorkspace: minted.tenant,
    organizations,
    workspaces,
    profileId: minted.device.id,
    deviceId: minted.device.id,
  });
};

const mintDeviceFromSession = async (input: {
  apiUrl: string;
  cookieHeader: string;
}): ReturnType<Parameters<typeof registerRpc<'auth.signIn'>>[1]> => {
  let keypair;
  try {
    keypair = await generateEd25519Keypair();
  } catch (err) {
    return fail(
      'keypair_gen_failed',
      err instanceof Error ? err.message : String(err),
    );
  }

  let minted: DeviceMintResponse;
  try {
    minted = await sessionPost<DeviceMintResponse>(
      input.apiUrl,
      '/auth/device/mint-session',
      {
        publicKey: keypair.publicKey,
        deviceName: defaultDeviceName(),
        platform: electronPlatform(),
      },
      input.cookieHeader,
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: string } }).body;
    if (status === 403 && body?.error === 'no_tenant_membership') {
      return fail(
        'no_tenant_membership',
        'This account is not assigned to a producer workspace.',
      );
    }
    return fail(
      'device_mint_failed',
      err instanceof Error ? err.message : 'Desktop registration failed.',
    );
  }

  await storePrivateKey(keypair.privateKey);
  const workspaces = normalizeWorkspaces(minted);
  const organizations = minted.organizations ?? [];
  await saveSession({
    userId: minted.user.id,
    userEmail: minted.user.email,
    userDisplayName: minted.user.displayName ?? null,
    deviceId: minted.device.id,
    publicKey: keypair.publicKey,
    apiUrl: input.apiUrl,
    signedInAt: new Date().toISOString(),
    activeWorkspace: minted.tenant,
    organizations,
    workspaces,
  });

  return ok({
    user: minted.user,
    activeWorkspace: minted.tenant,
    organizations,
    workspaces,
    profileId: minted.device.id,
    deviceId: minted.device.id,
  });
};

const runOidcBrowserFlow = async (input: {
  apiUrl: string;
  authorizationUrl: string;
}): Promise<string> => {
  const apiOrigin = new URL(input.apiUrl).origin;
  const authWindow = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Sign in to Proveria',
    parent: BrowserWindow.getFocusedWindow() ?? undefined,
    modal: false,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (cookieHeader: string): void => {
      if (settled) return;
      settled = true;
      authWindow.close();
      resolve(cookieHeader);
    };
    const failFlow = (err: Error): void => {
      if (settled) return;
      settled = true;
      authWindow.close();
      reject(err);
    };
    const checkForSessionCookie = async (): Promise<void> => {
      const cookies = await authWindow.webContents.session.cookies.get({
        url: apiOrigin,
        name: 'proveria_session',
      });
      const cookie = cookies[0];
      if (cookie?.value) {
        finish(`proveria_session=${cookie.value}`);
      }
    };

    authWindow.on('closed', () => {
      if (!settled) {
        settled = true;
        reject(new Error('Sign-in window was closed before completion.'));
      }
    });
    authWindow.webContents.on('did-navigate', (_event, url) => {
      if (url.startsWith(apiOrigin)) {
        void checkForSessionCookie().catch(failFlow);
      }
    });
    authWindow.webContents.on('did-navigate-in-page', (_event, url) => {
      if (url.startsWith(apiOrigin)) {
        void checkForSessionCookie().catch(failFlow);
      }
    });
    authWindow.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
      if (url.startsWith(apiOrigin)) {
        void checkForSessionCookie().catch(failFlow);
      }
    });

    authWindow.loadURL(input.authorizationUrl).catch(failFlow);
  });
};

const normalizeWorkspaces = (minted: DeviceMintResponse): WorkspaceSummary[] => {
  const workspaces = minted.workspaces ?? [];
  if (workspaces.some((workspace) => workspace.id === minted.tenant.id)) {
    return workspaces;
  }
  return [minted.tenant, ...workspaces];
};
