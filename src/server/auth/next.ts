import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Ctx } from '../context';
import { getDb } from '../db';
import { getSession, type SessionInfo } from './service';

export const SESSION_COOKIE = 'c2b_session';

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 14 * 86400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export const currentSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSession(getDb(), token);
});

/** For pages and actions: requires a logged-in user with an active organization. */
export async function requireCtx(): Promise<{ ctx: Ctx; session: SessionInfo }> {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (!session.orgId || !session.role) redirect('/login');
  return { ctx: { db: getDb(), userId: session.userId, orgId: session.orgId, role: session.role }, session };
}
