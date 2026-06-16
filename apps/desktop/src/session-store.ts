import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DesktopSession {
  userId: string;
  userEmail: string;
  userDisplayName?: string | null;
  deviceId: string;
  publicKey: string;
  apiUrl: string;
  signedInAt: string;
  activeWorkspace: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    projectNoun?: string;
    role: 'tenant_admin' | 'producer' | 'consumer';
    organizationId?: string | null;
    archivedAt?: string | null;
  };
  organizations?: Array<{
    id: string;
    name: string;
    projectNoun?: string;
    role: string;
    workspaceAccessMode: string;
  }>;
  workspaces?: Array<{
    id: string;
    slug: string;
    name: string;
    plan: string;
    projectNoun?: string;
    role: 'tenant_admin' | 'producer' | 'consumer';
    organizationId?: string | null;
    archivedAt?: string | null;
  }>;
}

const sessionPath = (): string =>
  join(app.getPath('userData'), 'session', 'session.json');

export const loadSession = async (): Promise<DesktopSession | null> => {
  try {
    const raw = await readFile(sessionPath(), 'utf8');
    return JSON.parse(raw) as DesktopSession;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

export const saveSession = async (session: DesktopSession): Promise<void> => {
  const filePath = sessionPath();
  mkdirSync(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(session, null, 2), { mode: 0o600 });
};

export const clearSession = async (): Promise<void> => {
  try {
    await unlink(sessionPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
};
