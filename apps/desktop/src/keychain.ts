import { app, safeStorage } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ensureEncryptionAvailable = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level secure storage is unavailable on this system. ' +
        'Proveria will not persist a private key without encryption.',
    );
  }
};

const keyPath = (): string =>
  join(app.getPath('userData'), 'session', 'private.key.enc');

export const storePrivateKey = async (
  privateKeyBase64Url: string,
): Promise<void> => {
  ensureEncryptionAvailable();
  const filePath = keyPath();
  mkdirSync(dirname(filePath), { recursive: true });
  const ciphertext = safeStorage.encryptString(privateKeyBase64Url);
  await writeFile(filePath, ciphertext, { mode: 0o600 });
};

export const readPrivateKey = async (): Promise<string | null> => {
  ensureEncryptionAvailable();
  try {
    const ciphertext = await readFile(keyPath());
    return safeStorage.decryptString(ciphertext);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

export const clearPrivateKey = async (): Promise<void> => {
  try {
    await unlink(keyPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
};
