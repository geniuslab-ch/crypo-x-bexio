import { and, eq } from 'drizzle-orm';
import { sha256 } from '@/core/fingerprint';
import { connectorFor, ConnectorError, type SourceConnector } from '@/integrations/sources';
import type { FetchContext } from '@/integrations/sources/types';
import { audit } from '../audit';
import { AppError, assertCanWrite, type Ctx } from '../context';
import { decryptSecret, encryptSecret } from '../crypto';
import { importBatches, sources } from '../db/schema';
import { reclassify } from './classification';
import { persistBatch } from './imports';
import { revalue } from './valuation';

/** Time one sync run may spend calling the provider (serverless functions are limited to ~60 s). */
const RUN_BUDGET_MS = 40_000;

function fetchContext(budgetMs = RUN_BUDGET_MS): FetchContext {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    deadline: Date.now() + budgetMs,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    env: process.env,
  };
}

function asAppError(e: unknown): never {
  if (e instanceof ConnectorError) {
    console.error('connector error', e.message);
    throw new AppError(e.code === 'credentials_rejected' || e.code.startsWith('api_key') ? 'forbidden' : 'invalid', e.code);
  }
  throw e;
}

async function loadSource(ctx: Ctx, sourceId: string) {
  const [source] = await ctx.db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.orgId, ctx.orgId)));
  if (!source) throw new AppError('not_found', 'source_not_found');
  const connector = connectorFor(source.provider);
  if (!connector) throw new AppError('invalid', 'no_api_for_provider');
  return { source, connector };
}

function cleanCreds(connector: SourceConnector, input: Record<string, string>): Record<string, string> {
  const creds: Record<string, string> = {};
  for (const f of connector.fields) {
    const v = (input[f.name] ?? '').trim();
    if (!v && !f.optional) throw new AppError('invalid', 'credentials_missing');
    if (v) creds[f.name] = v.slice(0, 8000);
  }
  return creds;
}

/** Masked view of the stored credentials, for display only. */
export function maskedCredentials(connector: SourceConnector, encrypted: string | null): { label: string; value: string }[] {
  if (!encrypted) return [];
  let creds: Record<string, string>;
  try { creds = JSON.parse(decryptSecret(encrypted)) as Record<string, string>; } catch { return []; }
  return connector.fields.filter((f) => creds[f.name]).map((f) => {
    const v = creds[f.name]!;
    return { label: f.label, value: f.secret ? `••••••${v.length > 12 ? v.slice(-4) : ''}` : v.length > 80 ? `${v.slice(0, 76)}…` : v };
  });
}

/** Saves read-only credentials (or public addresses) after checking them with the provider. */
export async function saveConnection(ctx: Ctx, sourceId: string, input: Record<string, string>): Promise<{ readOnly: 'verified' | 'not_checkable'; kind: 'exchange' | 'wallet' }> {
  assertCanWrite(ctx);
  const { source, connector } = await loadSource(ctx, sourceId);
  const creds = cleanCreds(connector, input);
  let check: { readOnly: 'verified' | 'not_checkable' };
  try {
    check = await connector.verify(creds, fetchContext(20_000));
  } catch (e) {
    asAppError(e);
  }
  await ctx.db.update(sources).set({
    encryptedCredentials: encryptSecret(JSON.stringify(creds)),
    connectionType: connector.kind === 'wallet' ? 'address' : 'api',
    syncState: null, syncNote: null,
  }).where(eq(sources.id, source.id));
  await audit(ctx.db, {
    orgId: ctx.orgId, actorUserId: ctx.userId, action: 'source.connected', entity: 'source', entityId: source.id,
    after: { connector: connector.id, readOnly: check.readOnly, fields: Object.keys(creds) },
  });
  return { ...check, kind: connector.kind };
}

export async function removeConnection(ctx: Ctx, sourceId: string): Promise<void> {
  assertCanWrite(ctx);
  const { source } = await loadSource(ctx, sourceId);
  await ctx.db.update(sources).set({ encryptedCredentials: null, connectionType: 'csv', syncState: null, syncNote: null }).where(eq(sources.id, source.id));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'source.disconnected', entity: 'source', entityId: source.id });
}

export interface SyncOutcome {
  complete: boolean;
  imported: number;
  duplicates: number;
  issues: number;
  progress: string;
}

/**
 * Runs one sync step. Long histories take several runs: progress is kept in `sync_state`, and transactions
 * are only written once the provider's data for the pass has been read in full.
 */
export async function syncSource(ctx: Ctx, sourceId: string): Promise<SyncOutcome> {
  assertCanWrite(ctx);
  const { source, connector } = await loadSource(ctx, sourceId);
  if (!source.encryptedCredentials) throw new AppError('invalid', 'source_not_connected');
  const creds = JSON.parse(decryptSecret(source.encryptedCredentials)) as Record<string, string>;

  let result;
  try {
    result = await connector.sync(creds, source.syncState ?? {}, fetchContext());
  } catch (e) {
    const code = e instanceof ConnectorError ? e.code : 'unexpected_error';
    await ctx.db.update(sources).set({ syncNote: `failed:${code}` }).where(eq(sources.id, source.id));
    asAppError(e);
  }

  if (!result.complete) {
    await ctx.db.update(sources).set({ syncState: result.state, syncNote: result.progress ?? null }).where(eq(sources.id, source.id));
    return { complete: false, imported: 0, duplicates: 0, issues: 0, progress: result.progress ?? '' };
  }

  const content = JSON.stringify(result.evidence);
  const fileSha = sha256(content);
  const [already] = await ctx.db.select({ id: importBatches.id }).from(importBatches)
    .where(and(eq(importBatches.sourceId, source.id), eq(importBatches.fileSha256, fileSha)));
  let imported = 0;
  let duplicates = 0;
  if (!already && (result.transactions.length > 0 || result.issues.length > 0)) {
    const r = await persistBatch(ctx, source.id, {
      parserId: connector.id, parserVersion: connector.version, fileName: `${connector.id}-${new Date().toISOString().slice(0, 19)}.json`,
      content, fileSha, parsed: { transactions: result.transactions, issues: result.issues },
    });
    imported = r.imported;
    duplicates = r.duplicates;
  }
  const note = `${result.progress ?? ''} ${imported} nouvelle(s), ${duplicates} déjà connue(s).`.trim();
  await ctx.db.update(sources).set({ syncState: result.state, syncNote: note, lastSyncedAt: new Date() }).where(eq(sources.id, source.id));
  if (imported > 0) {
    await reclassify(ctx);
    await revalue(ctx, { fetchMissing: true });
  }
  return { complete: true, imported, duplicates, issues: result.issues.length, progress: note };
}
