export const DEFAULT_VERIFICATION_BASE_URL = 'http://127.0.0.1:3003';

export const verificationBaseUrlFromEnv = (): string =>
  process.env.PROVERIA_VERIFICATION_BASE_URL ?? DEFAULT_VERIFICATION_BASE_URL;

export const verificationUrlForLink = (
  verificationBaseUrl: string,
  linkId: string,
): string => `${verificationBaseUrl.replace(/\/+$/, '')}/v/${linkId}`;
