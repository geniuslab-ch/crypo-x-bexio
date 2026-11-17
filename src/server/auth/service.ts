import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { LEGAL_FORMS } from '@/core/legalForms';
import { audit } from '../audit';
import { AppError, type Role } from '../context';
import { hashToken, randomToken } from '../crypto';
import type { DB } from '../db';
import { legalFormColumns } from '../services/organization';
import { accountingPolicies, memberships, organizations, passwordResets, sessions, subscriptions, users } from '../db/schema';

const SESSION_DAYS = 14;
const RESET_MINUTES = 60;
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 30);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'password_too_short').max(200),
  name: z.string().trim().min(1).max(120),
  orgName: z.string().trim().min(1).max(160),
  /** Precise legal form (sa, sarl, foundation, …); 'company' kept for callers that do not distinguish SA and Sàrl. */
  orgKind: z.enum([...LEGAL_FORMS, 'company']),
  canton: z.string().trim().max(2).optional().nullable(),
  locale: z.enum(['fr', 'en', 'de', 'it']).default('fr'),
});

export type RegisterInput = z.input<typeof registerSchema>;

export async function registerUser(db: DB, input: RegisterInput): Promise<{ userId: string; orgId: string }> {
  const data = registerSchema.parse(input);
  const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${data.email}`);
  if (existing.length > 0) throw new AppError('conflict', 'email_taken');
  const passwordHash = await hash(data.password);
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: data.email, passwordHash, name: data.name, locale: data.locale }).returning({ id: users.id });
    const form = data.orgKind === 'company' ? { kind: 'company' as const, legalForm: null, taxStatus: 'ordinary' } : legalFormColumns(data.orgKind);
    const [o] = await tx.insert(organizations).values({ name: data.orgName, ...form, canton: data.canton ?? null }).returning({ id: organizations.id });
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

// ---------- Password reset ----------

const passwordSchema = z.string().min(10, 'password_too_short').max(200);

/** At most 3 reset e-mails per address every 15 minutes (per process, like the login throttle). */
const resetRequests = new Map<string, { count: number; until: number }>();

export interface ResetRequest { token: string; userId: string; email: string; name: string | null; locale: string }

/**
 * Creates a one-time reset link for this e-mail. Returns null when no account uses it, so the caller
 * shows the same answer either way and never reveals whether an address is registered.
 */
/** Counts a reset request for this address; throws too_many_attempts past 3 in 15 minutes. Same for known and unknown addresses. */
export function throttleResetRequest(email: string): void {
  const key = email.trim().toLowerCase();
  if (!key || key.length > 254) throw new AppError('invalid', 'invalid_input');
  const r = resetRequests.get(key);
  const live = r && r.until > Date.now();
  if (live && r.count >= 3) throw new AppError('forbidden', 'too_many_attempts');
  resetRequests.set(key, { count: live ? r.count + 1 : 1, until: live ? r.until : Date.now() + 15 * 60_000 });
}

export async function requestPasswordReset(db: DB, email: string): Promise<ResetRequest | null> {
  const key = email.trim().toLowerCase();
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${key}`);
  if (!u) return null;
  const token = randomToken();
  await db.insert(passwordResets).values({ userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) });
  await audit(db, { orgId: null, actorUserId: u.id, action: 'user.password_reset_requested', entity: 'user', entityId: u.id });
  return { token, userId: u.id, email: u.email, name: u.name, locale: u.locale };
}

/** True when the link can still be used (shown before the new-password form). */
export async function isResetTokenValid(db: DB, token: string): Promise<boolean> {
  if (!token) return false;
  const [row] = await db.select({ id: passwordResets.id }).from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  return Boolean(row);
}

/** Sets the new password, burns every open reset link of the user and logs out all their sessions. */
export async function resetPassword(db: DB, token: string, password: string): Promise<{ userId: string; email: string }> {
  const pw = passwordSchema.parse(password);
  // Reject unknown or spent links before the costly Argon2 hash, so made-up tokens cost the server nothing.
  if (!(await isResetTokenValid(db, token))) throw new AppError('forbidden', 'reset_link_invalid');
  const passwordHash = await hash(pw);
  return db.transaction(async (tx) => {
    const now = new Date();
    // Marking the row used in the same statement that checks it makes a link single-use even under concurrent submits.
    const [row] = await tx.update(passwordResets).set({ usedAt: now })
      .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now)))
      .returning({ userId: passwordResets.userId });
    if (!row) throw new AppError('forbidden', 'reset_link_invalid');
    const [u] = await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId)).returning({ id: users.id, email: users.email });
    await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, row.userId), isNull(passwordResets.usedAt)));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await audit(tx, { orgId: null, actorUserId: row.userId, action: 'user.password_reset', entity: 'user', entityId: row.userId });
    attempts.delete(u!.email.toLowerCase());
    return { userId: u!.id, email: u!.email };
  });
}
