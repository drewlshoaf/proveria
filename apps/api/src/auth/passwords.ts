// Argon2id password hashing.
// Argon2id parameters per OWASP Password Storage Cheat Sheet (2024):
//   memory 19 MiB, iterations 2, parallelism 1.
// These can be raised later by re-hashing on next successful login.

import * as argon2 from 'argon2';

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = async (password: string): Promise<string> => {
  if (password.length === 0) {
    throw new Error('password must be non-empty');
  }
  return await argon2.hash(password, HASH_OPTIONS);
};

export const verifyPassword = async (
  hash: string,
  password: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // argon2.verify throws for malformed hashes; treat as a no-match rather
    // than leaking error details to callers.
    return false;
  }
};

/** Whether the given hash should be rehashed under current parameters. */
export const needsRehash = (hash: string): boolean => {
  try {
    return argon2.needsRehash(hash, HASH_OPTIONS);
  } catch {
    return true;
  }
};
