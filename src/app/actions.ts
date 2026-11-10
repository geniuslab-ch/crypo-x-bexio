'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CLASSIFICATIONS, type Classification } from '@/core/types';
import { clearSessionCookie, requireCtx, SESSION_COOKIE, setSessionCookie } from '@/server/auth/next';
import { login, logout, registerUser, switchOrg } from '@/server/auth/service';
import { audit } from '@/server/audit';
import { BexioHttpError } from '@/integrations/bexio/client';
import { AppError } from '@/server/context';
import { getDb } from '@/server/db';
import { accountingPolicies, memberships, organizations, users } from '@/server/db/schema';
import { disconnect, refreshBexioData, setMapping, syncEntries } from '@/server/services/bexio';
import { markPolicyReviewed, runCalculation, setEntriesValidated, updatePolicy } from '@/server/services/calculation';
import { reclassify, setManualClassification } from '@/server/services/classification';
import { createSource, importFile } from '@/server/services/imports';
import { importRates, revalue } from '@/server/services/valuation';

/** Error codes raised when the server cannot reach or log in to PostgreSQL (configuration problem, not user input). */
const DB_UNAVAILABLE = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', '28P01', '28000', '3D000', '42P01',
]);

/** Maps an error to a message code for the UI. Internal details are logged server-side and never shown to the user. */
function msg(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e && typeof e === 'object' && 'issues' in e) return 'invalid_input';
  console.error(e);
  const code = (e as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === 'string' && DB_UNAVAILABLE.has(code)) return 'database_unavailable';
  if (e instanceof Error && /DATABASE_URL|APP_ENCRYPTION_KEY/.test(e.message)) return 'server_not_configured';
  // Errors reported by external services (bexio, CoinGecko) are useful to the user and contain no internal detail.
  if (e instanceof BexioHttpError || (e instanceof Error && /^(bexio|CoinGecko) /.test(e.message))) return e.message;
  return 'unexpected_error';
}

function back(path: string, kind: 'ok' | 'error', text: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}${kind}=${encodeURIComponent(text)}`);
}

// ---------- Auth ----------

/** Non-secret registration fields echoed back after an error so the form does not have to be retyped. Passwords never are. */
const REGISTER_KEEP = ['name', 'email', 'orgName', 'orgKind', 'canton', 'locale'] as const;

function registerBack(form: FormData, error: string): never {
  const q = new URLSearchParams({ error });
  for (const k of REGISTER_KEEP) {
    const v = String(form.get(k) ?? '').slice(0, 200);
    if (v) q.set(k, v);
  }
  redirect(`/register?${q.toString()}`);
}

export async function registerAction(form: FormData) {
  if (String(form.get('password') ?? '') !== String(form.get('passwordConfirm') ?? '')) registerBack(form, 'password_mismatch');
  let ok = false;
  try {
    const db = getDb();
    await registerUser(db, {
      email: String(form.get('email') ?? ''), password: String(form.get('password') ?? ''), name: String(form.get('name') ?? ''),
      orgName: String(form.get('orgName') ?? ''), orgKind: String(form.get('orgKind') ?? 'company') as 'company',
      canton: String(form.get('canton') ?? '') || null, locale: (String(form.get('locale') ?? 'fr') as 'fr'),
    });
    const { token } = await login(db, String(form.get('email')), String(form.get('password')));
    await setSessionCookie(token);
    ok = true;
  } catch (e) {
    registerBack(form, msg(e));
  }
  if (ok) redirect('/dashboard');
}

export async function loginAction(form: FormData) {
  try {
    const { token } = await login(getDb(), String(form.get('email') ?? ''), String(form.get('password') ?? ''));
    await setSessionCookie(token);
  } catch (e) {
    back('/login', 'error', msg(e));
  }
  redirect('/dashboard');
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(getDb(), token);
  await clearSessionCookie();
  redirect('/login');
}

export async function switchOrgAction(form: FormData) {
  const { session } = await requireCtx();
  await switchOrg(getDb(), session.sessionId, session.userId, String(form.get('orgId')));
  redirect('/dashboard');
}

export async function createClientOrgAction(form: FormData) {
  const { ctx } = await requireCtx();
  const name = String(form.get('name') ?? '').trim();
  const kind = String(form.get('kind') ?? 'company') as 'company' | 'sole_trader' | 'private';
  if (!name || !['company', 'sole_trader', 'private'].includes(kind)) back('/fiduciary', 'error', 'invalid_input');
  await ctx.db.transaction(async (db) => {
    const [o] = await db.insert(organizations).values({ name, kind, canton: String(form.get('canton') ?? '') || null }).returning({ id: organizations.id });
    // The creator of a client file acts as its fiduciary.
    await db.insert(memberships).values({ orgId: o!.id, userId: ctx.userId, role: 'fiduciary' });
    await db.insert(accountingPolicies).values({ orgId: o!.id });
    await audit(db, { orgId: o!.id, actorUserId: ctx.userId, action: 'organization.created', entity: 'organization', entityId: o!.id, after: { name, kind } });
  });
  back('/fiduciary', 'ok', 'client_created');
}

export async function setLocaleAction(form: FormData) {
  const { ctx } = await requireCtx();
  const locale = String(form.get('locale'));
  if (['fr', 'en', 'de'].includes(locale)) await ctx.db.update(users).set({ locale }).where(eq(users.id, ctx.userId));
  revalidatePath('/', 'layout');
  back('/settings', 'ok', 'saved');
}

// ---------- Sources & import ----------

export async function createSourceAction(form: FormData) {
  const { ctx } = await requireCtx();
  try {
    await createSource(ctx, { provider: String(form.get('provider')), label: String(form.get('label') ?? ''), kind: String(form.get('kind')) as 'exchange' });
  } catch (e) {
    back('/sources', 'error', msg(e));
  }
  back('/sources', 'ok', 'source_created');
}

export async function importFileAction(form: FormData) {
  const { ctx } = await requireCtx();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) back('/sources', 'error', 'no_file');
  let text = '';
  try {
    const r = await importFile(ctx, {
      sourceId: String(form.get('sourceId')), fileName: file.name, content: await file.text(), parserId: String(form.get('parserId') ?? '') || null,
    });
    text = `imported:${r.imported}|duplicates:${r.duplicates}|issues:${r.issues.length}`;
  } catch (e) {
    back('/sources', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/sources', 'ok', text);
}

// ---------- Transactions ----------

export async function classifyAction(form: FormData) {
  const { ctx } = await requireCtx();
  const txId = String(form.get('txId'));
  const raw = String(form.get('classification') ?? '');
  const classification = raw === '' ? null : (raw as Classification);
  const returnTo = String(form.get('returnTo') ?? `/transactions/${txId}`);
  try {
    if (classification && !CLASSIFICATIONS.includes(classification)) throw new AppError('invalid', 'invalid_classification');
    await setManualClassification(ctx, txId, classification, form.get('remember') === 'on');
    await reclassify(ctx);
    await revalue(ctx, { fetchMissing: true });
  } catch (e) {
    back(returnTo, 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(returnTo, 'ok', 'saved');
}

export async function confirmClassificationsAction(form: FormData) {
  const { ctx } = await requireCtx();
  const ids = form.getAll('txId').map(String);
  const loaded = await import('@/server/services/transactions').then((m) => m.loadTransactions(ctx, ids));
  try {
    for (const l of loaded) await setManualClassification(ctx, l.tx.id, l.tx.classification as Classification, false);
    await reclassify(ctx);
    await revalue(ctx, { fetchMissing: true });
  } catch (e) {
    back('/review', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/review', 'ok', `confirmed:${loaded.length}`);
}

// ---------- Accounting ----------

export async function runCalculationAction() {
  const { ctx } = await requireCtx();
  let text = '';
  try {
    await revalue(ctx, { fetchMissing: true });
    const r = await runCalculation(ctx);
    text = r.status === 'complete' ? `run_complete|created:${r.created}|unchanged:${r.unchanged}` : `run_blocked|issues:${r.issues.length}`;
  } catch (e) {
    back('/accounting', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/accounting', 'ok', text);
}

export async function validateEntriesAction(form: FormData) {
  const { ctx } = await requireCtx();
  const ids = form.getAll('entryId').map(String);
  const validated = form.get('mode') !== 'unvalidate';
  let n = 0;
  try {
    n = await setEntriesValidated(ctx, ids, validated);
  } catch (e) {
    back('/accounting', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/accounting', 'ok', `${validated ? 'validated' : 'unvalidated'}:${n}`);
}

export async function importRatesAction(form: FormData) {
  const { ctx } = await requireCtx();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) back('/accounting', 'error', 'no_file');
  let text = '';
  try {
    const r = await importRates(ctx, await file.text(), form.get('replace') === 'on');
    await revalue(ctx);
    text = `rates_inserted:${r.inserted}|replaced:${r.replaced}|skipped:${r.skipped}|errors:${r.errors.length}`;
  } catch (e) {
    back('/accounting', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/accounting', 'ok', text);
}

export async function updatePolicyAction(form: FormData) {
  const { ctx } = await requireCtx();
  try {
    await updatePolicy(ctx, {
      costBasisMethod: form.get('costBasisMethod') === 'wac' ? 'wac' : 'fifo',
      tradingFeeTreatment: form.get('tradingFeeTreatment') === 'expense' ? 'expense' : 'capitalize',
      transferWindowHours: Number(form.get('transferWindowHours') ?? 48),
    });
    await reclassify(ctx);
  } catch (e) {
    back('/settings', 'error', msg(e));
  }
  back('/settings', 'ok', 'saved');
}

export async function markPolicyReviewedAction() {
  const { ctx } = await requireCtx();
  try {
    await markPolicyReviewed(ctx);
  } catch (e) {
    back('/settings', 'error', msg(e));
  }
  back('/settings', 'ok', 'saved');
}

// ---------- bexio ----------

export async function refreshBexioAction() {
  const { ctx } = await requireCtx();
  let text = '';
  try {
    const r = await refreshBexioData(ctx);
    text = `accounts:${r.accounts}|years:${r.years}`;
  } catch (e) {
    back('/bexio', 'error', msg(e));
  }
  back('/bexio', 'ok', text);
}

export async function saveMappingsAction(form: FormData) {
  const { ctx } = await requireCtx();
  try {
    for (const [k, v] of form.entries()) {
      if (!k.startsWith('map:')) continue;
      const key = k.slice(4);
      const val = String(v);
      await setMapping(ctx, key, val === '' ? null : Number(val));
    }
  } catch (e) {
    back('/bexio', 'error', msg(e));
  }
  back('/bexio', 'ok', 'saved');
}

export async function syncBexioAction() {
  const { ctx } = await requireCtx();
  let text = '';
  try {
    const r = await syncEntries(ctx);
    text = `synced:${r.synced}|failed:${r.failed}|recovered:${r.recovered}`;
  } catch (e) {
    back('/bexio', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/bexio', 'ok', text);
}

export async function disconnectBexioAction() {
  const { ctx } = await requireCtx();
  await disconnect(ctx);
  back('/bexio', 'ok', 'disconnected');
}
