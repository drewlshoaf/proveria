import { createHash } from 'node:crypto';

import { signEd25519 } from '@proveria/crypto-core';

import { clearPrivateKey, readPrivateKey } from './keychain.js';
import { clearSession, loadSession } from './session-store.js';

const TEXT_ENCODER = new TextEncoder();
const API_UNAVAILABLE_MESSAGE =
  'Proveria API is unavailable. Confirm the API server is running, then try again.';
const SESSION_EXPIRED_MESSAGE =
  'Your desktop session ended. Sign in again to continue.';

const sigHeaders = async (
  privateKey: string,
  deviceId: string,
  method: string,
  path: string,
  bodyBytes: Uint8Array,
): Promise<Record<string, string>> => {
  const ts = Date.now();
  const bodyHashHex = createHash('sha256').update(bodyBytes).digest('hex');
  const canonical = [
    'proveria-device-v1',
    String(ts),
    method.toUpperCase(),
    path,
    bodyHashHex,
  ].join('\n');
  const signature = await signEd25519(TEXT_ENCODER.encode(canonical), privateKey);
  return {
    'X-Proveria-Device-Id': deviceId,
    'X-Proveria-Timestamp': String(ts),
    'X-Proveria-Signature': signature,
  };
};

export interface SignedRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  clearSessionOnUnauthorized?: boolean;
}

const isNetworkFetchError = (err: unknown): boolean =>
  err instanceof TypeError ||
  (err instanceof Error && err.message.toLowerCase().includes('fetch failed'));

const apiUnavailableError = (cause: unknown): Error & {
  code: string;
  cause?: unknown;
} => {
  const err = new Error(API_UNAVAILABLE_MESSAGE) as Error & {
    code: string;
    cause?: unknown;
  };
  err.code = 'api_unavailable';
  err.cause = cause;
  return err;
};

const fetchApi = async (
  url: string,
  init: RequestInit,
): Promise<Response> => {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (isNetworkFetchError(err)) {
      throw apiUnavailableError(err);
    }
    throw err;
  }
};

const sessionExpiredError = async (): Promise<Error & {
  code: string;
  status: number;
  body: { error: string };
}> => {
  await clearPrivateKey();
  await clearSession();
  const err = new Error(SESSION_EXPIRED_MESSAGE) as Error & {
    code: string;
    status: number;
    body: { error: string };
  };
  err.code = 'session_expired';
  err.status = 401;
  err.body = { error: 'session_expired' };
  return err;
};

export const signedRequest = async <T>(
  opts: SignedRequestOptions,
): Promise<T> => {
  const res = await signedFetch(opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

export const signedRequestText = async (
  opts: SignedRequestOptions,
): Promise<{ body: string; contentType: string | null }> => {
  const res = await signedFetch(opts);
  return {
    body: await res.text(),
    contentType: res.headers.get('content-type'),
  };
};

const signedFetch = async (opts: SignedRequestOptions): Promise<Response> => {
  const session = await loadSession();
  if (!session) throw new Error('no_session');
  const privateKey = await readPrivateKey();
  if (!privateKey) throw new Error('no_private_key');

  const bodyStr = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const bodyBytes = TEXT_ENCODER.encode(bodyStr);
  const headers = await sigHeaders(
    privateKey,
    session.deviceId,
    opts.method,
    opts.path,
    bodyBytes,
  );

  const init: RequestInit = {
    method: opts.method,
    headers:
      opts.body === undefined
        ? headers
        : { 'Content-Type': 'application/json', ...headers },
  };
  if (opts.body !== undefined) init.body = bodyStr;

  const res = await fetchApi(`${session.apiUrl}${opts.path}`, init);
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    if (res.status === 401 && opts.clearSessionOnUnauthorized !== false) {
      throw await sessionExpiredError();
    }
    const err = new Error(
      `${opts.method} ${opts.path} failed: ${res.status}`,
    ) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res;
};

export const unsignedPost = async <T>(
  apiUrl: string,
  path: string,
  body: unknown,
): Promise<T> => {
  const { body: responseBody } = await unsignedPostWithHeaders<T>(
    apiUrl,
    path,
    body,
  );
  return responseBody;
};

export const unsignedPostWithHeaders = async <T>(
  apiUrl: string,
  path: string,
  body: unknown,
): Promise<{ body: T; headers: Headers }> => {
  const res = await fetchApi(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let respBody: unknown = null;
    try {
      respBody = await res.json();
    } catch {
      respBody = await res.text().catch(() => null);
    }
    const err = new Error(`POST ${path} failed: ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = res.status;
    err.body = respBody;
    throw err;
  }
  return { body: (await res.json()) as T, headers: res.headers };
};

export const unsignedGet = async <T>(
  apiUrl: string,
  path: string,
): Promise<T> => {
  const res = await fetchApi(`${apiUrl}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let respBody: unknown = null;
    try {
      respBody = await res.json();
    } catch {
      respBody = await res.text().catch(() => null);
    }
    const err = new Error(`GET ${path} failed: ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = res.status;
    err.body = respBody;
    throw err;
  }
  return (await res.json()) as T;
};

export const sessionPost = async <T>(
  apiUrl: string,
  path: string,
  body: unknown,
  cookieHeader: string,
): Promise<T> => {
  const res = await fetchApi(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let respBody: unknown = null;
    try {
      respBody = await res.json();
    } catch {
      respBody = await res.text().catch(() => null);
    }
    const err = new Error(`POST ${path} failed: ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = res.status;
    err.body = respBody;
    throw err;
  }
  return (await res.json()) as T;
};
