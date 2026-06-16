// Opaque random tokens for email verification and password reset.
//
// Pattern: generate 32 bytes of CSPRNG output, encode base64url for transport,
// store SHA-256(token) base64url in the database. The plaintext token never
// persists server-side — at consume time we hash the incoming token and look
// up by hash.

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTE_LENGTH = 32;

/** Generate a fresh 32-byte token. Returns { token, hash } as base64url strings. */
export const generateToken = (): { token: string; hash: string } => {
  const buf = randomBytes(TOKEN_BYTE_LENGTH);
  const token = buf.toString('base64url');
  const hash = hashToken(token);
  return { token, hash };
};

/** SHA-256 hash of a token, base64url-encoded. */
export const hashToken = (token: string): string => {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
};

/** Whether `now` is within `[issuedAt, expiresAt]`. */
export const isWithinWindow = (
  expiresAt: Date,
  now: Date = new Date(),
): boolean => {
  return now.getTime() < expiresAt.getTime();
};
