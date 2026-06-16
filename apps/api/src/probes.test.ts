import { describe, it, expect } from 'vitest';
import { probeMinio, probeRedis } from './probes.js';

describe('probeMinio', () => {
  it('returns ok:false with an error message for an unreachable endpoint', async () => {
    // Use a port nothing is listening on. fetch will fail fast.
    const result = await probeMinio('http://127.0.0.1:1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false for a 4xx response', async () => {
    // example.com responds 200 to /, 404 to /minio/health/live — exercises the
    // non-ok branch without depending on a real MinIO being up.
    const result = await probeMinio('https://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/minio health returned/);
    }
  });
});

describe('probeRedis', () => {
  it('returns ok:false when the client throws', async () => {
    const fakeRedis = {
      ping: async () => {
        throw new Error('boom');
      },
    } as unknown as Parameters<typeof probeRedis>[0];

    const result = await probeRedis(fakeRedis);
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('returns ok:false when ping reply is unexpected', async () => {
    const fakeRedis = {
      ping: async () => 'NOPE',
    } as unknown as Parameters<typeof probeRedis>[0];

    const result = await probeRedis(fakeRedis);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unexpected ping reply/);
    }
  });

  it('returns ok:true on PONG', async () => {
    const fakeRedis = {
      ping: async () => 'PONG',
    } as unknown as Parameters<typeof probeRedis>[0];

    const result = await probeRedis(fakeRedis);
    expect(result).toEqual({ ok: true });
  });
});
