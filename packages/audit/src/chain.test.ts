import { describe, it, expect } from 'vitest';

import type { AuditEvent } from '@proveria/db';

import {
  CHAIN_GENESIS_HEX,
  canonicalAuditEventBytes,
  computeChainHash,
} from './chain.js';

const fixture = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
  actorUserId: '33333333-3333-3333-3333-333333333333',
  actorDeviceId: null,
  category: 'attestation_lifecycle',
  action: 'attestation.confirmed',
  targetType: 'attestation',
  targetId: '44444444-4444-4444-4444-444444444444',
  payload: { merkleRoot: 'abc' },
  createdAt: new Date('2026-05-16T12:00:00.000Z'),
  ...overrides,
});

describe('canonicalAuditEventBytes', () => {
  it('produces a deterministic RFC 8785 canonical serialization', () => {
    const a = canonicalAuditEventBytes(fixture());
    const b = canonicalAuditEventBytes(fixture());
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });

  it('changes when any audit field changes', () => {
    const base = canonicalAuditEventBytes(fixture());
    const mutated = canonicalAuditEventBytes(
      fixture({ action: 'attestation.canceled' }),
    );
    expect(Buffer.from(base)).not.toEqual(Buffer.from(mutated));
  });

  it('uses ISO 8601 for createdAt regardless of input Date precision', () => {
    const a = canonicalAuditEventBytes(
      fixture({ createdAt: new Date('2026-05-16T12:00:00Z') }),
    );
    const b = canonicalAuditEventBytes(
      fixture({ createdAt: new Date('2026-05-16T12:00:00.000Z') }),
    );
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });
});

describe('computeChainHash', () => {
  it('is deterministic for the same prev + event', () => {
    const h1 = computeChainHash(CHAIN_GENESIS_HEX, fixture());
    const h2 = computeChainHash(CHAIN_GENESIS_HEX, fixture());
    expect(h1).toBe(h2);
  });

  it('returns a 64-char lowercase hex string', () => {
    const h = computeChainHash(CHAIN_GENESIS_HEX, fixture());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when prev_hash changes (chain link)', () => {
    const event = fixture();
    const h1 = computeChainHash(CHAIN_GENESIS_HEX, event);
    const h2 = computeChainHash('ff'.repeat(32), event);
    expect(h1).not.toBe(h2);
  });

  it('differs when any audit field changes (tamper detection)', () => {
    const base = computeChainHash(CHAIN_GENESIS_HEX, fixture());
    const tampered = computeChainHash(
      CHAIN_GENESIS_HEX,
      fixture({ payload: { merkleRoot: 'tampered' } }),
    );
    expect(base).not.toBe(tampered);
  });

  it('a 3-element chain walk re-derives every this_hash from prev_hash + event', () => {
    const e1 = fixture({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    const e2 = fixture({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      action: 'attestation.created',
    });
    const e3 = fixture({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: 'attestation.canceled',
    });
    const h1 = computeChainHash(CHAIN_GENESIS_HEX, e1);
    const h2 = computeChainHash(h1, e2);
    const h3 = computeChainHash(h2, e3);
    // Verifier re-walk.
    const v1 = computeChainHash(CHAIN_GENESIS_HEX, e1);
    const v2 = computeChainHash(v1, e2);
    const v3 = computeChainHash(v2, e3);
    expect(v1).toBe(h1);
    expect(v2).toBe(h2);
    expect(v3).toBe(h3);
    // Any single-event tamper breaks h2 + h3 (cascade).
    const tamperedE2 = { ...e2, action: 'attestation.confirmed' };
    const t2 = computeChainHash(h1, tamperedE2);
    const t3 = computeChainHash(t2, e3);
    expect(t2).not.toBe(h2);
    expect(t3).not.toBe(h3);
  });
});
