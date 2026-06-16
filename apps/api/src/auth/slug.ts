// Personal-tenant slug generator. Tries the local-part of the email first,
// falls back to a short random suffix if that's taken.

import { randomBytes } from 'node:crypto';

const BASE_RE = /[^a-z0-9]+/g;

export const baseSlugFromEmail = (email: string): string => {
  const local = email.split('@')[0] ?? 'user';
  const base = local.toLowerCase().replace(BASE_RE, '-').replace(/^-+|-+$/g, '');
  if (base.length === 0) return 'user';
  return base.slice(0, 32);
};

export const randomSlugSuffix = (): string => {
  return randomBytes(4).toString('hex');
};
