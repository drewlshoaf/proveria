// Session lifecycle: create / lookup / revoke. Session id is a UUID stored in
// the sessions row; the cookie carries that id signed with the api's session
// secret (see @fastify/cookie wiring in server.ts).

import { and, eq, gt, isNull } from 'drizzle-orm';
import { sessions, type DrizzleClient, type Session } from '@proveria/db';

import { config } from '../config.js';

const sessionLifetimeMs = (): number =>
  config.sessionLifetimeDays * 24 * 60 * 60 * 1000;

export interface CreateSessionInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export const createSession = async (
  db: DrizzleClient,
  input: CreateSessionInput,
): Promise<Session> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionLifetimeMs());
  const rows = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('failed to create session row');
  }
  return row;
};

/** Returns the active session for the given id, or null if missing/expired/revoked. */
export const getActiveSession = async (
  db: DrizzleClient,
  sessionId: string,
): Promise<Session | null> => {
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

export const revokeSession = async (
  db: DrizzleClient,
  sessionId: string,
): Promise<void> => {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
};

export const touchSession = async (
  db: DrizzleClient,
  sessionId: string,
): Promise<void> => {
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, sessionId));
};

export const sessionCookieMaxAgeSeconds = (): number =>
  Math.floor(sessionLifetimeMs() / 1000);
