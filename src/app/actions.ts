'use server';

import { eq } from 'drizzle-orm';
import { safeNextPath } from '@/server/auth/nextPath';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isLegalForm, isTaxStatus, type LegalForm } from '@/core/legalForms';
import { CLASSIFICATIONS, type Classification } from '@/core/types';
import { clearSessionCookie, requireCtx, SESSION_COOKIE, setSessionCookie } from '@/server/auth/next';
import { login, logout, registerUser, requestPasswordReset, resetPassword, switchOrg } from '@/server/auth/service';
import { mailConfigured, sendMail } from '@/server/mail';
import { translator } from '@/i18n/dictionaries';
import { fill } from '@/i18n/ui';
import { audit } from '@/server/audit';
import { BexioHttpError } from '@/integrations/bexio/client';
import { AppError } from '@/server/context';
import { getDb } from '@/server/db';
import { accountingPolicies, memberships, organizations, users } from '@/server/db/schema';
import { disconnect, refreshBexioData, setMapping, setVatCode, syncEntries } from '@/server/services/bexio';
import { markPolicyReviewed, runCalculation, setEntriesValidated, updatePolicy } from '@/server/services/calculation';
import { reclassify, setManualClassification } from '@/server/services/classification';
import { createSource, importFile, listSources } from '@/server/services/imports';
import { legalFormColumns, updateOrgProfile } from '@/server/services/organization';
import { removeConnection, saveConnection, syncSource } from '@/server/services/sync';
import { importRates, importTaxValues, revalue } from '@/server/services/valuation';
import { isRateBasis, isValuationMethod } from '@/core/accounting/closing';
import { deleteReportedBalance, importReportedBalances, saveReportedBalance, uniqueLabels } from '@/server/services/reconciliation';
import { createPlatformRequest } from '@/server/services/platformRequests';
import { addOpeningBalances, closeYear, deleteOpeningBalance, parseOpeningCsv, reopenYear } from '@/server/services/closing';

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
      orgName: String(form.get('orgName') ?? ''), orgKind: String(form.get('orgKind') ?? 'sa') as LegalForm,
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
  const next = safeNextPath(form.get('next'));
  try {
    const { token } = await login(getDb(), String(form.get('email') ?? ''), String(form.get('password') ?? ''));
    await setSessionCookie(token);
  } catch (e) {
    back(next === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(next)}`, 'error', msg(e));
  }
  redirect(next);
}

/** Public origin for links sent by e-mail: APP_URL in production, else the host the request came in on. */
async function publicOrigin(): Promise<string> {
  const app = process.env.APP_URL?.replace(/\/+$/, '');
  if (app) return app;
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'}`;
}

export async function forgotPasswordAction(form: FormData) {
  if (!mailConfigured()) back('/forgot-password', 'error', 'mail_not_configured');
  try {
    const r = await requestPasswordReset(getDb(), String(form.get('email') ?? ''));
    if (r) {
      const t = translator(r.locale);
      const link = `${await publicOrigin()}/reset-password?token=${encodeURIComponent(r.token)}`;
      await sendMail({ to: r.email, subject: t('pw.mailSubject'), text: fill(t('pw.mailBody'), { name: r.name ?? '', email: r.email, link }) });
    }
  } catch (e) {
    back('/forgot-password', 'error', msg(e));
  }
  // Same answer whether or not the address has an account.
  back('/forgot-password', 'ok', 'reset_link_sent');
}

export async function resetPasswordAction(form: FormData) {
  const token = String(form.get('token') ?? '');
  const here = `/reset-password?token=${encodeURIComponent(token)}`;
  if (String(form.get('password') ?? '') !== String(form.get('passwordConfirm') ?? '')) back(here, 'error', 'password_mismatch');
  try {
    await resetPassword(getDb(), token, String(form.get('password') ?? ''));
  } catch (e) {
    back(here, 'error', msg(e));
  }
  await clearSessionCookie();
  back('/login', 'ok', 'password_reset_done');
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
  // Stay on the same section after switching client; detail pages (/x/<id>) belong to the previous client.
  const next = String(form.get('next') ?? '');
  const section = /^\/[a-z-]+/.exec(next)?.[0];
  // Every page and the shared layout depend on the active client: drop the client-side router cache.
  revalidatePath('/', 'layout');
  redirect(section ?? '/dashboard');
}

export async function createClientOrgAction(form: FormData) {
  const { ctx } = await requireCtx();
  const name = String(form.get('name') ?? '').trim();
  const legalForm = String(form.get('kind') ?? '');
  if (!name || !isLegalForm(legalForm)) back('/fiduciary', 'error', 'invalid_input');
  const taxStatus = String(form.get('taxStatus') ?? 'ordinary');
  const columns = legalFormColumns(legalForm as LegalForm, isTaxStatus(taxStatus) ? taxStatus : 'ordinary');
  const kind = columns.kind;
  await ctx.db.transaction(async (db) => {
    const [o] = await db.insert(organizations).values({ name, ...columns, canton: String(form.get('canton') ?? '') || null }).returning({ id: organizations.id });
    // The creator of a client file acts as its fiduciary.
    await db.insert(memberships).values({ orgId: o!.id, userId: ctx.userId, role: 'fiduciary' });
    await db.insert(accountingPolicies).values({ orgId: o!.id });
    await audit(db, { orgId: o!.id, actorUserId: ctx.userId, action: 'organization.created', entity: 'organization', entityId: o!.id, after: { name, kind, legalForm: columns.legalForm, taxStatus: columns.taxStatus } });
  });
  back('/fiduciary', 'ok', 'client_created');
}

export async function setLocaleAction(form: FormData) {
  const { ctx } = await requireCtx();
  const locale = String(form.get('locale'));
  if (['fr', 'en', 'de', 'it'].includes(locale)) await ctx.db.update(users).set({ locale }).where(eq(users.id, ctx.userId));
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

export async function connectSourceAction(form: FormData) {
  const { ctx } = await requireCtx();
  const sourceId = String(form.get('sourceId') ?? '');
  const input: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith('cred_') && typeof v === 'string') input[k.slice(5)] = v;
  let text = '';
  try {
    const r = await saveConnection(ctx, sourceId, input);
    text = r.kind === 'wallet' ? 'addresses_saved' : r.readOnly === 'verified' ? 'connection_saved_verified' : 'connection_saved';
  } catch (e) {
    back('/sources', 'error', msg(e));
  }
  back('/sources', 'ok', text);
}

export async function disconnectSourceAction(form: FormData) {
  const { ctx } = await requireCtx();
  try {
    await removeConnection(ctx, String(form.get('sourceId') ?? ''));
  } catch (e) {
    back('/sources', 'error', msg(e));
  }
  back('/sources', 'ok', 'connection_removed');
}

export async function syncSourceAction(form: FormData) {
  const { ctx } = await requireCtx();
  let text = '';
  try {
    const r = await syncSource(ctx, String(form.get('sourceId') ?? ''));
    text = r.complete ? `imported:${r.imported}|duplicates:${r.duplicates}|issues:${r.issues}` : 'sync_partial';
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

export async function importTaxValuesAction(form: FormData) {
  const { ctx } = await requireCtx();
  const file = form.get('file');
  const year = String(form.get('year') ?? '');
  const to = `/reports${/^\d{4}$/.test(year) ? `?year=${year}` : ''}`;
  if (!(file instanceof File) || file.size === 0) back(to, 'error', 'no_file');
  let text = '';
  try {
    const r = await importTaxValues(ctx, await file.text(), form.get('replace') === 'on');
    text = `tax_values_inserted:${r.inserted}|replaced:${r.replaced}|skipped:${r.skipped}|errors:${r.errors.length}`;
  } catch (e) {
    back(to, 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(to, 'ok', text);
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

export async function updateLegalFormAction(form: FormData) {
  const { ctx } = await requireCtx();
  const legalForm = String(form.get('legalForm') ?? '');
  const taxStatus = String(form.get('taxStatus') ?? 'ordinary');
  try {
    if (!isLegalForm(legalForm) || !isTaxStatus(taxStatus)) throw new AppError('invalid', 'invalid_input');
    await updateOrgProfile(ctx, legalForm, taxStatus);
    await reclassify(ctx);
  } catch (e) {
    back('/settings', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
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
    // VAT codes after the accounts, since a code needs a mapped account.
    for (const [k, v] of form.entries()) {
      if (!k.startsWith('vat:')) continue;
      const val = String(v);
      await setVatCode(ctx, k.slice(4), val === '' ? null : Number(val));
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

// ---------- Year-end closing ----------

export async function closeYearAction(form: FormData) {
  const { ctx } = await requireCtx();
  const year = Number(form.get('year'));
  const method = form.get('method');
  const basis = form.get('basis');
  const to = `/closing?year=${year}&method=${String(method)}&basis=${String(basis)}`;
  if (!isValuationMethod(method) || !isRateBasis(basis)) back(to, 'error', 'invalid_input');
  let text = '';
  try {
    const r = await closeYear(ctx, year, method, basis);
    text = `year_closed|closing_entries:${r.entries}`;
  } catch (e) {
    back(to, 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(to, 'ok', text);
}

export async function reopenYearAction(form: FormData) {
  const { ctx } = await requireCtx();
  const year = Number(form.get('year'));
  try {
    await reopenYear(ctx, year);
  } catch (e) {
    back('/closing', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(`/closing?year=${year}`, 'ok', 'year_reopened');
}

export async function addOpeningBalancesAction(form: FormData) {
  const { ctx } = await requireCtx();
  const year = Number(form.get('openingYear'));
  const to = '/closing';
  let text = '';
  try {
    const rows = [];
    const errors: string[] = [];
    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > 2 * 1024 * 1024) throw new AppError('invalid', 'file_too_large');
      const byLabel = uniqueLabels(await listSources(ctx));
      const parsed = parseOpeningCsv(await file.text(), byLabel);
      rows.push(...parsed.rows);
      errors.push(...parsed.errors);
    }
    const asset = String(form.get('asset') ?? '').trim();
    if (asset) rows.push({ sourceId: String(form.get('sourceId') ?? ''), asset, quantity: String(form.get('quantity') ?? ''), costChf: String(form.get('costChf') ?? '') });
    if (rows.length === 0 && errors.length === 0) throw new AppError('invalid', 'invalid_input');
    const r = await addOpeningBalances(ctx, year, rows);
    errors.push(...r.errors);
    text = [`opening_added:${r.added}`, `duplicates:${r.duplicates}`, `errors:${errors.length}`, ...errors.slice(0, 3)].join('|');
  } catch (e) {
    back(to, 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(to, 'ok', text);
}

export async function deleteOpeningBalanceAction(form: FormData) {
  const { ctx } = await requireCtx();
  try {
    await deleteOpeningBalance(ctx, String(form.get('txId') ?? ''));
  } catch (e) {
    back('/closing', 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back('/closing', 'ok', 'opening_deleted');
}

// ---------- Reconciliation ----------

export async function saveReportedBalancesAction(form: FormData) {
  const { ctx } = await requireCtx();
  const date = String(form.get('date') ?? '');
  const to = `/reconciliation${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''}`;
  let text = '';
  try {
    const file = form.get('file');
    let saved = 0;
    const errors: string[] = [];
    if (file instanceof File && file.size > 0) {
      if (file.size > 2 * 1024 * 1024) throw new AppError('invalid', 'file_too_large');
      const r = await importReportedBalances(ctx, await file.text());
      saved += r.saved;
      errors.push(...r.errors);
    }
    const asset = String(form.get('asset') ?? '').trim();
    if (asset) {
      await saveReportedBalance(ctx, { sourceId: String(form.get('sourceId') ?? ''), asset, date, quantity: String(form.get('quantity') ?? ''), evidence: String(form.get('evidence') ?? '') });
      saved++;
    }
    if (saved === 0 && errors.length === 0) throw new AppError('invalid', 'invalid_input');
    text = [`balances_saved:${saved}`, `errors:${errors.length}`, ...errors.slice(0, 3)].join('|');
  } catch (e) {
    back(to, 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(to, 'ok', text);
}

export async function deleteReportedBalanceAction(form: FormData) {
  const { ctx } = await requireCtx();
  const date = String(form.get('date') ?? '');
  const to = `/reconciliation${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''}`;
  try {
    await deleteReportedBalance(ctx, String(form.get('id') ?? ''));
  } catch (e) {
    back(to, 'error', msg(e));
  }
  revalidatePath('/', 'layout');
  back(to, 'ok', 'saved');
}

// ---------- Platform requests ----------

export async function requestPlatformAction(form: FormData) {
  const { ctx } = await requireCtx();
  try {
    const file = form.get('file');
    const sample = file instanceof File && file.size > 0 ? { name: file.name, content: await file.text() } : null;
    await createPlatformRequest(ctx, {
      platform: String(form.get('platform') ?? ''), kind: String(form.get('kind') ?? 'exchange') as 'exchange',
      wanted: String(form.get('wanted') ?? 'either') as 'either', note: String(form.get('note') ?? ''),
    }, sample);
  } catch (e) {
    back('/sources', 'error', msg(e));
  }
  back('/sources', 'ok', 'platform_requested');
}
