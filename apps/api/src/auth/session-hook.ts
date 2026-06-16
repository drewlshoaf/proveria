// Shared preHandler: load the active session + user from a signed cookie and
// attach them to the request. Used by both the auth plugin (for /auth/me etc.)
// and the tenant plugin (for /tenants/*). Returns 401 with the cookie cleared
// when missing/invalid/expired/revoked.

import { eq } from 'drizzle-orm';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { users, type DrizzleClient, type User } from '@proveria/db';

import { config } from '../config.js';
import { getActiveSession, touchSession } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
    currentSessionId?: string;
  }
}

export const requireSessionFactory = (
  db: DrizzleClient,
): preHandlerAsyncHookHandler => {
  return async (req, reply) => {
    const raw = req.cookies?.[config.sessionCookieName];
    if (!raw) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const session = await getActiveSession(db, unsigned.value);
    if (!session) {
      reply.clearCookie(config.sessionCookieName, { path: '/' });
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const user = userRows[0];
    if (!user || user.deactivatedAt) {
      reply.clearCookie(config.sessionCookieName, { path: '/' });
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    req.currentUser = user;
    req.currentSessionId = session.id;
    // Best-effort last-seen touch; failures don't block the request.
    touchSession(db, session.id).catch(() => undefined);
  };
};
