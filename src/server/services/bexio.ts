import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { ACCOUNT_KEYS } from '@/core/accounting/accountKeys';
import { BexioClient, BexioHttpError, type ManualEntryResponse, type TokenProvider } from '@/integrations/bexio/client';
import { authorizationUrl, bexioConfig, exchangeCode, refreshTokens, type BexioTokens } from '@/integrations/bexio/oauth';
import { buildManualEntry, type MappedAccount } from '@/integrations/bexio/payload';
import { audit } from '../audit';
import { AppError, assertCanValidate, assertCanWrite, type Ctx } from '../context';
import { decryptSecret, encryptSecret, randomToken } from '../crypto';
import type { DB } from '../db';
import {
  accountMappings, bexioAccounts, bexioBusinessYears, bexioTaxes, bexioConnections, journalEntries, journalLines, oauthStates, sources, syncAttempts,
} from '../db/schema';

interface StoredTokens { accessToken: string; refreshToken: string | null; expiresAt: number }

export async function getConnection(ctx: Ctx) {
  const [c] = await ctx.db.select().from(bexioConnections).where(eq(bexioConnections.orgId, ctx.orgId));
  return c ?? null;
}

export async function startConnect(ctx: Ctx): Promise<string> {
  assertCanWrite(ctx);
  const cfg = bexioConfig();
  if (!cfg) throw new AppError('invalid', 'bexio_not_configured');
  const state = randomToken();
  const nonce = randomToken(16);
  await ctx.db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await ctx.db.insert(oauthStates).values({ state, nonce, orgId: ctx.orgId, userId: ctx.userId, expiresAt: new Date(Date.now() + 10 * 60_000) });
  return authorizationUrl(cfg, state, nonce);
}

/** OAuth callback. The state must belong to the same logged-in user who started the flow. */
export async function completeConnect(db: DB, userId: string, state: string, code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cfg = bexioConfig();
  if (!cfg) throw new AppError('invalid', 'bexio_not_configured');
  const [s] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
  await db.delete(oauthStates).where(eq(oauthStates.state, state));
  if (!s || s.userId !== userId || s.expiresAt < new Date()) throw new AppError('forbidden', 'invalid_oauth_state');
  const tokens = await exchangeCode(cfg, code, fetchImpl);
  if (tokens.idTokenClaims && tokens.idTokenClaims.nonce !== s.nonce) throw new AppError('forbidden', 'invalid_oauth_nonce');
  if (!tokens.scope.split(' ').includes('accounting')) throw new AppError('forbidden', 'accounting_scope_not_granted');
  const companyName = typeof tokens.idTokenClaims?.company_name === 'string' ? tokens.idTokenClaims.company_name : null;
  const values = {
    orgId: s.orgId, encryptedTokens: encryptSecret(JSON.stringify(toStored(tokens))), scopes: tokens.scope, companyName,
    chfCurrencyId: null, connectedBy: userId, connectedAt: new Date(),
  };
  await db.insert(bexioConnections).values(values).onConflictDoUpdate({ target: bexioConnections.orgId, set: values });
  await audit(db, { orgId: s.orgId, actorUserId: userId, action: 'bexio.connected', entity: 'bexio_connection', after: { scopes: tokens.scope, companyName } });
  return s.orgId;
}

function toStored(t: BexioTokens): StoredTokens {
  return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
}

/** Token provider backed by the encrypted connection row; persists rotated refresh tokens. */
export function connectionTokenProvider(db: DB, orgId: string, fetchImpl: typeof fetch = fetch): TokenProvider {
  return {
    async getAccessToken(force = false) {
      const [c] = await db.select().from(bexioConnections).where(eq(bexioConnections.orgId, orgId));
      if (!c) throw new AppError('invalid', 'bexio_not_connected');
      const stored = JSON.parse(decryptSecret(c.encryptedTokens)) as StoredTokens;
      if (!force && stored.expiresAt - 60_000 > Date.now()) return stored.accessToken;
      const cfg = bexioConfig();
      if (!cfg || !stored.refreshToken) throw new AppError('external', 'bexio_session_expired_reconnect');
      const fresh = await refreshTokens(cfg, stored.refreshToken, fetchImpl);
      const next: StoredTokens = { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken ?? stored.refreshToken, expiresAt: fresh.expiresAt };
      await db.update(bexioConnections).set({ encryptedTokens: encryptSecret(JSON.stringify(next)) }).where(eq(bexioConnections.orgId, orgId));
      return next.accessToken;
    },
  };
}

export function clientFor(ctx: Ctx, fetchImpl: typeof fetch = fetch): BexioClient {
  return new BexioClient(connectionTokenProvider(ctx.db, ctx.orgId, fetchImpl), fetchImpl);
}

/** Loads chart of accounts, business years and the CHF currency id from bexio. */
export async function refreshBexioData(ctx: Ctx, client = clientFor(ctx)): Promise<{ accounts: number; years: number }> {
  assertCanWrite(ctx);
  const [accounts, years, currencies] = await Promise.all([client.accounts(), client.businessYears(), client.currencies()]);
  // VAT codes are optional: a company without VAT (or an authorisation without access) simply has none.
  let taxes: Awaited<ReturnType<typeof client.taxes>> = [];
  try { taxes = await client.taxes(); } catch { taxes = []; }
  const chf = currencies.find((c) => c.name === 'CHF');
  await ctx.db.transaction(async (db) => {
    for (const a of accounts) {
      const v = {
        orgId: ctx.orgId, bexioId: a.id, uuid: a.uuid ?? null, accountNo: String(a.account_no), name: a.name,
        accountType: a.account_type ?? null, isActive: !!a.is_active, isLocked: !!a.is_locked, fetchedAt: new Date(),
      };
      await db.insert(bexioAccounts).values(v).onConflictDoUpdate({ target: [bexioAccounts.orgId, bexioAccounts.bexioId], set: v });
    }
    for (const x of taxes) {
      const v = {
        orgId: ctx.orgId, bexioId: x.id, code: String(x.code ?? ''), name: String(x.display_name || x.name || x.code || x.id), type: String(x.type ?? ''),
        value: String(x.value ?? 0), isActive: !!x.is_active, fetchedAt: new Date(),
      };
      await db.insert(bexioTaxes).values(v).onConflictDoUpdate({ target: [bexioTaxes.orgId, bexioTaxes.bexioId], set: v });
    }
    await db.delete(bexioBusinessYears).where(eq(bexioBusinessYears.orgId, ctx.orgId));
    if (years.length) {
      await db.insert(bexioBusinessYears).values(years.map((y) => ({ orgId: ctx.orgId, bexioId: y.id, start: y.start, end: y.end, status: y.status })));
    }
    await db.update(bexioConnections).set({ chfCurrencyId: chf?.id ?? null }).where(eq(bexioConnections.orgId, ctx.orgId));
  });
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'bexio.data_refreshed', entity: 'bexio_connection', after: { accounts: accounts.length, years: years.length, taxes: taxes.length, chfCurrencyId: chf?.id ?? null } });
  if (!chf) throw new AppError('external', 'bexio_has_no_chf_currency');
  return { accounts: accounts.length, years: years.length };
}

export async function listBexioAccounts(ctx: Ctx) {
  return ctx.db.select().from(bexioAccounts).where(eq(bexioAccounts.orgId, ctx.orgId)).orderBy(bexioAccounts.accountNo);
}

export async function listBexioTaxes(ctx: Ctx) {
  return ctx.db.select().from(bexioTaxes).where(eq(bexioTaxes.orgId, ctx.orgId)).orderBy(bexioTaxes.type, bexioTaxes.code);
}

/** Sets (or clears) the VAT code booked on lines that use the account mapped to `key`. */
export async function setVatCode(ctx: Ctx, key: string, bexioTaxId: number | null): Promise<void> {
  assertCanWrite(ctx);
  const [m] = await ctx.db.select().from(accountMappings).where(and(eq(accountMappings.orgId, ctx.orgId), eq(accountMappings.key, key)));
  if (!m) {
    if (bexioTaxId === null) return;
    throw new AppError('invalid', 'map_account_before_vat');
  }
  if ((m.bexioTaxId ?? null) === bexioTaxId) return;
  if (bexioTaxId !== null) {
    const [tx] = await ctx.db.select().from(bexioTaxes).where(and(eq(bexioTaxes.orgId, ctx.orgId), eq(bexioTaxes.bexioId, bexioTaxId)));
    if (!tx) throw new AppError('not_found', 'bexio_tax_not_found');
  }
  await ctx.db.update(accountMappings).set({ bexioTaxId, updatedAt: new Date() }).where(eq(accountMappings.id, m.id));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'vat_code.updated', entity: 'account_mapping', entityId: key,
    before: { bexioTaxId: m.bexioTaxId }, after: { bexioTaxId } });
}

export async function listMappings(ctx: Ctx) {
  return ctx.db.select().from(accountMappings).where(eq(accountMappings.orgId, ctx.orgId)).orderBy(accountMappings.key);
}

const KEY_PATTERN = /^(crypto_asset|fiat_clearing):([A-Z0-9*]{1,20})$/;
const WALLET_KEY_PATTERN = /^crypto_asset:\*@([0-9a-f-]{36})$/;

export async function setMapping(ctx: Ctx, key: string, bexioAccountId: number | null): Promise<void> {
  assertCanWrite(ctx);
  const wallet = WALLET_KEY_PATTERN.exec(key)?.[1];
  if (!(ACCOUNT_KEYS as readonly string[]).includes(key) && !KEY_PATTERN.test(key) && !wallet) throw new AppError('invalid', 'invalid_account_key');
  const [before] = await ctx.db.select().from(accountMappings).where(and(eq(accountMappings.orgId, ctx.orgId), eq(accountMappings.key, key)));
  if ((before?.bexioAccountId ?? null) === bexioAccountId) return;
  if (wallet) {
    const [src] = await ctx.db.select({ id: sources.id }).from(sources).where(and(eq(sources.orgId, ctx.orgId), eq(sources.id, wallet)));
    if (!src) throw new AppError('not_found', 'source_not_found');
    // Giving a wallet its own account (or removing it) changes how lots are pooled and which accounts entries use.
    // Validated entries are never rewritten silently, so the switch is refused once entries are validated.
    if (!before || bexioAccountId === null) {
      const [validated] = await ctx.db.select({ id: journalEntries.id }).from(journalEntries)
        .where(and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.status, ['validated', 'synced', 'sync_failed']))).limit(1);
      if (validated) throw new AppError('conflict', 'wallet_accounts_locked_by_validated_entries');
    }
  }
  if (bexioAccountId === null) {
    await ctx.db.delete(accountMappings).where(and(eq(accountMappings.orgId, ctx.orgId), eq(accountMappings.key, key)));
  } else {
    const [acc] = await ctx.db.select().from(bexioAccounts).where(and(eq(bexioAccounts.orgId, ctx.orgId), eq(bexioAccounts.bexioId, bexioAccountId)));
    if (!acc) throw new AppError('not_found', 'bexio_account_not_found');
    const v = { orgId: ctx.orgId, key, bexioAccountId: acc.bexioId, bexioAccountNo: acc.accountNo, bexioAccountName: acc.name, updatedAt: new Date() };
    await ctx.db.insert(accountMappings).values(v).onConflictDoUpdate({ target: [accountMappings.orgId, accountMappings.key], set: v });
  }
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'mapping.updated', entity: 'account_mapping', entityId: key,
    before: before ? { account: before.bexioAccountNo } : null, after: bexioAccountId === null ? null : { bexioAccountId } });
}

export interface SyncReport {
  synced: number;
  failed: number;
  recovered: number;
  results: { entryId: string; referenceNr: string; outcome: 'success' | 'failed' | 'unknown' | 'recovered' | 'skipped'; message?: string }[];
}

/**
 * Posts validated entries to bexio. Idempotency (bexio has no idempotency key):
 *  - each entry has a unique deterministic reference_nr;
 *  - an entry whose previous attempt had an unknown outcome is first looked up in bexio by reference_nr;
 *  - "synced" is only recorded after bexio returns 201 with an id (or the lookup finds it).
 */
export async function syncEntries(ctx: Ctx, entryIds?: string[], client = clientFor(ctx)): Promise<SyncReport> {
  assertCanValidate(ctx);
  const conn = await getConnection(ctx);
  if (!conn) throw new AppError('invalid', 'bexio_not_connected');
  if (!conn.chfCurrencyId) throw new AppError('invalid', 'bexio_data_not_loaded');

  const statusFilter = inArray(journalEntries.status, ['validated', 'sync_failed']);
  const where = entryIds
    ? and(eq(journalEntries.orgId, ctx.orgId), statusFilter, inArray(journalEntries.id, entryIds))
    : and(eq(journalEntries.orgId, ctx.orgId), statusFilter);
  const entries = await ctx.db.select().from(journalEntries).where(where).orderBy(journalEntries.entryDate);
  const report: SyncReport = { synced: 0, failed: 0, recovered: 0, results: [] };
  if (entries.length === 0) return report;

  const lines = await ctx.db.select().from(journalLines).where(inArray(journalLines.entryId, entries.map((e) => e.id))).orderBy(journalLines.position);
  const mappingRows = await listMappings(ctx);
  const accounts = await listBexioAccounts(ctx);
  const activeById = new Map(accounts.map((a) => [a.bexioId, a]));
  const mappings = new Map<string, MappedAccount>(mappingRows.map((m) => [m.key, {
    bexioAccountId: m.bexioAccountId, accountNo: m.bexioAccountNo, isActive: activeById.get(m.bexioAccountId)?.isActive ?? false, taxId: m.bexioTaxId,
  }]));
  const years = await ctx.db.select().from(bexioBusinessYears).where(eq(bexioBusinessYears.orgId, ctx.orgId));

  // Entries whose last attempt has an unknown outcome must be looked up before any retry.
  const lastAttempts = await ctx.db.select().from(syncAttempts).where(inArray(syncAttempts.entryId, entries.map((e) => e.id))).orderBy(desc(syncAttempts.createdAt));
  const lastByEntry = new Map<string, (typeof lastAttempts)[number]>();
  for (const a of lastAttempts) if (!lastByEntry.has(a.entryId)) lastByEntry.set(a.entryId, a);
  let remoteByRef: Map<string, ManualEntryResponse> | null = null;
  if (entries.some((e) => lastByEntry.get(e.id)?.outcome === 'unknown')) {
    remoteByRef = new Map((await client.manualEntries()).filter((m) => m.reference_nr).map((m) => [m.reference_nr!, m]));
  }

  for (const e of entries) {
    const myLines = lines.filter((l) => l.entryId === e.id);
    const remote = remoteByRef?.get(e.referenceNr);
    if (remote) {
      await markSynced(ctx, e.id, remote, myLines.map((l) => l.id));
      await recordAttempt(ctx, e.id, { lookup: e.referenceNr }, 200, { id: remote.id }, 'success', 'Found in bexio by reference_nr after an unknown outcome');
      report.recovered++;
      report.results.push({ entryId: e.id, referenceNr: e.referenceNr, outcome: 'recovered' });
      continue;
    }
    const built = buildManualEntry(
      { entryDate: e.entryDate, referenceNr: e.referenceNr, description: e.description, lines: myLines },
      mappings, conn.chfCurrencyId, years,
    );
    if (!built.ok) {
      await ctx.db.update(journalEntries).set({ status: 'sync_failed', lastSyncError: built.reason }).where(eq(journalEntries.id, e.id));
      await recordAttempt(ctx, e.id, {}, null, null, 'failed', built.reason);
      report.failed++;
      report.results.push({ entryId: e.id, referenceNr: e.referenceNr, outcome: 'failed', message: built.reason });
      continue;
    }
    try {
      const res = await client.createManualEntry(built.payload);
      if (!res || typeof res.id !== 'number') throw new BexioHttpError(0, res, 'bexio returned no entry id');
      await markSynced(ctx, e.id, res, myLines.map((l) => l.id));
      await recordAttempt(ctx, e.id, built.payload, 201, res, 'success', res.is_locked ? `Entry locked in bexio (${res.locked_info ?? 'locked'})` : null);
      report.synced++;
      report.results.push({ entryId: e.id, referenceNr: e.referenceNr, outcome: 'success' });
    } catch (err) {
      const definite = err instanceof BexioHttpError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
      const message = (err as Error).message;
      const outcome = definite ? 'failed' : 'unknown';
      const userMessage = definite ? message : `${message} — outcome unknown; bexio will be checked for ${e.referenceNr} before any retry`;
      await ctx.db.update(journalEntries).set({ status: 'sync_failed', lastSyncError: userMessage }).where(eq(journalEntries.id, e.id));
      await recordAttempt(ctx, e.id, built.payload, err instanceof BexioHttpError ? err.status : null, err instanceof BexioHttpError ? err.body : null, outcome, userMessage);
      report.failed++;
      report.results.push({ entryId: e.id, referenceNr: e.referenceNr, outcome, message: userMessage });
    }
  }
  await ctx.db.update(bexioConnections).set({ lastSyncAt: new Date() }).where(eq(bexioConnections.orgId, ctx.orgId));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'bexio.sync', entity: 'journal_entries', after: { synced: report.synced, failed: report.failed, recovered: report.recovered } });
  return report;
}

async function markSynced(ctx: Ctx, entryId: string, res: ManualEntryResponse, lineIds: string[]) {
  await ctx.db.update(journalEntries).set({ status: 'synced', bexioManualEntryId: res.id, syncedAt: new Date(), lastSyncError: null }).where(eq(journalEntries.id, entryId));
  // bexio returns entry lines in request order; store their ids for evidence uploads and reconciliation.
  for (let i = 0; i < lineIds.length; i++) {
    const remoteLine = res.entries?.[i];
    if (remoteLine?.id) await ctx.db.update(journalLines).set({ bexioEntryLineId: remoteLine.id }).where(eq(journalLines.id, lineIds[i]!));
  }
}

async function recordAttempt(ctx: Ctx, entryId: string, request: unknown, httpStatus: number | null, response: unknown, outcome: 'success' | 'failed' | 'unknown', errorMessage: string | null) {
  await ctx.db.insert(syncAttempts).values({ orgId: ctx.orgId, entryId, request: request ?? {}, httpStatus, response: response ?? null, outcome, errorMessage, createdBy: ctx.userId });
}

export async function listSyncAttempts(ctx: Ctx, limit = 50) {
  return ctx.db.select({
    id: syncAttempts.id, entryId: syncAttempts.entryId, referenceNr: journalEntries.referenceNr, httpStatus: syncAttempts.httpStatus,
    outcome: syncAttempts.outcome, errorMessage: syncAttempts.errorMessage, createdAt: syncAttempts.createdAt,
  }).from(syncAttempts).innerJoin(journalEntries, eq(journalEntries.id, syncAttempts.entryId))
    .where(eq(syncAttempts.orgId, ctx.orgId)).orderBy(desc(syncAttempts.createdAt)).limit(limit);
}

export async function disconnect(ctx: Ctx): Promise<void> {
  assertCanWrite(ctx);
  await ctx.db.delete(bexioConnections).where(eq(bexioConnections.orgId, ctx.orgId));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'bexio.disconnected', entity: 'bexio_connection' });
}
