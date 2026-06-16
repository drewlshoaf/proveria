// Helpers for device pairing — short code generation, attempt status mapping.

import { randomBytes } from 'node:crypto';

// 8 chars from a 32-symbol alphabet without ambiguous glyphs. Crockford-ish
// but uppercase only. Plenty of entropy for a short-lived pairing code.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const generatePairingCode = (length = 8): string => {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i]!;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
};

export const PAIRING_TTL_MINUTES = 10;

export type PairingState =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired';

export const resolvePairingState = (attempt: {
  approvedAt: Date | null;
  deniedAt: Date | null;
  expiresAt: Date;
  consumedAt: Date | null;
}): PairingState => {
  if (attempt.deniedAt) return 'denied';
  if (attempt.approvedAt || attempt.consumedAt) return 'approved';
  if (attempt.expiresAt.getTime() < Date.now()) return 'expired';
  return 'pending';
};
