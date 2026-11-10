import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit';
import { AppError, type Role } from '../context';
import { hashToken, randomToken } from '../crypto';
import type { DB } from '../db';
import { accountingPolicies, memberships, organizations, sessions, subscriptions, users } from '../db/schema';

const SESSION_DAYS = 14;
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 30);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'password_too_short').max(200),
  name: z.string().trim().min(1).max(120),
  orgName: z.string().trim().min(1).max(160),
  orgKind: z.enum(['company', 'sole_trader', 'private']),
  canton: z.string().trim().max(2).optional().nullable(),
  locale: z.enum(['fr', 'en', 'de']).default('fr'),
});

export type RegisterInput = z.input<typeof registerSchema>;

export async function registerUser(db: DB, input: RegisterInput): Promise<{ userId: string; orgId: string }> {
  const data = registerSchema.parse(input);
  const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${data.email}`);
  if (existing.length > 0) throw new AppError('conflict', 'email_taken');
  const passwordHash = await hash(data.password);
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: data.email, passwordHash, name: data.name, locale: data.locale }).returning({ id: users.id });
    const [o] = await tx.insert(organizations).values({ name: data.orgName, kind: data.orgKind, canton: data.canton ?? null }).returning({ id: organizations.id });
    await tx.insert(memberships).values({ orgId: o!.id, userId: u!.id, role: 'owner' });
    await tx.insert(accountingPolicies).values({ orgId: o!.id });
    await tx.insert(subscriptions).values({
      orgId: o!.id, planId: 'pro', status: 'trialing', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000),
    });
    await audit(tx, { orgId: o!.id, actorUserId: u!.id, action: 'user.registered', entity: 'user', entityId: u!.id, after: { email: data.email } });
    return { userId: u!.id, orgId: o!.id };
  });
}

/** Simple per-process brute-force protection. Replace with a shared store when running several instances. */
const attempts = new Map<string, { count: number; until: number }>();
function throttle(key: string): void {
  const a = attempts.get(key);
  if (a && a.count >= 5 && a.until > Date.now()) throw new AppError('forbidden', 'too_many_attempts');
}
function fail(key: string): void {
  const a = attempts.get(key);
  const count = a && a.until > Date.now() ? a.count + 1 : 1;
  attempts.set(key, { count, until: Date.now() + 15 * 60_000 });
}

export async function login(db: DB, email: string, password: string): Promise<{ token: string; userId: string }> {
  const key = email.trim().toLowerCase();
  throttle(key);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${key}`);
  // Verify against a dummy hash when the user is unknown, to keep timing similar.
  const ok = u ? await verify(u.passwordHash, password) : (await hash(password), false);
  if (!u || !ok) {
    fail(key);
    throw new AppError('forbidden', 'invalid_credentials');
  }
  attempts.delete(key);
  const token = randomToken();
  const [m] = await db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, u.id)).limit(1);
  await db.insert(sessions).values({
    userId: u.id, tokenHash: hashToken(token), activeOrgId: m?.orgId ?? null,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
  });
  await audit(db, { orgId: m?.orgId ?? null, actorUserId: u.id, action: 'user.login', entity: 'user', entityId: u.id });
  return { token, userId: u.id };
}

export async function logout(db: DB, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
  locale: string;
  orgId: string | null;
  role: Role | null;
  orgName: string | null;
  orgs: { id: string; name: string; role: Role }[];
}

export async function getSession(db: DB, token: string): Promise<SessionInfo | null> {
  const [s] = await db.select().from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!s) return null;
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!u) return null;
  const orgs = await db.select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, u.id)).orderBy(organizations.name);
  const active = orgs.find((o) => o.id === s.activeOrgId) ?? orgs[0] ?? null;
  return {
    sessionId: s.id, userId: u.id, email: u.email, name: u.name, locale: u.locale,
    orgId: active?.id ?? null, role: active?.role ?? null, orgName: active?.name ?? null, orgs,
  };
}

export async function switchOrg(db: DB, sessionId: string, userId: string, orgId: string): Promise<void> {
  const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  if (!m) throw new AppError('forbidden', 'not_a_member');
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, sessionId));
}
