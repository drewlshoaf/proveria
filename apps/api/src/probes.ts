// Lightweight readiness probes for the three V1 backing services.
// Each probe is timeout-bounded so /readyz can't hang the loadbalancer.
// See docs/v1 §6.3, §7, §25.

import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import type postgres from 'postgres';

import { ARTIFACTS_BUCKET, s3 } from './objects/client.js';

export type ProbeResult = { ok: true } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 2000;

const withTimeout = async <T>(
  p: Promise<T>,
  label: string,
  ms = DEFAULT_TIMEOUT_MS,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} probe timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const errString = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const probePostgres = async (
  sql: ReturnType<typeof postgres>,
): Promise<ProbeResult> => {
  try {
    await withTimeout(sql`SELECT 1`.execute(), 'postgres');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errString(err) };
  }
};

export const probeRedis = async (redis: Redis): Promise<ProbeResult> => {
  try {
    const reply = await withTimeout(redis.ping(), 'redis');
    if (reply === 'PONG') return { ok: true };
    return { ok: false, error: `unexpected ping reply: ${reply}` };
  } catch (err) {
    return { ok: false, error: errString(err) };
  }
};

export const probeMinio = async (
  endpoint: string | undefined,
): Promise<ProbeResult> => {
  if (!endpoint) {
    try {
      await withTimeout(
        s3.send(new HeadBucketCommand({ Bucket: ARTIFACTS_BUCKET })),
        's3',
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errString(err) };
    }
  }
  const url = `${endpoint.replace(/\/$/, '')}/minio/health/live`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.ok) return { ok: true };
    return { ok: false, error: `minio health returned ${res.status}` };
  } catch (err) {
    return { ok: false, error: errString(err) };
  } finally {
    clearTimeout(t);
  }
};
