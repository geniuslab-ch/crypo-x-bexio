import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { walletOfKey } from '@/core/accounting/accountKeys';
import type { AccountingTx } from '@/core/accounting/engine';
import type { Classification, Movement } from '@/core/types';
import type { ValuedMovement } from '@/core/valuation/value';
import type { Ctx } from '../context';
import { accountMappings, journalEntries, movements, sources, transactions } from '../db/schema';

export type TxRow = typeof transactions.$inferSelect;
export type MovementRow = typeof movements.$inferSelect;

export interface LoadedTx {
  tx: TxRow;
  provider: string;
  sourceLabel: string;
  movements: MovementRow[];
}

/** All transactions of the organisation, chronological, with movements and source info. */
export async function loadTransactions(ctx: Ctx, ids?: string[]): Promise<LoadedTx[]> {
  const where = ids ? and(eq(transactions.orgId, ctx.orgId), inArray(transactions.id, ids)) : eq(transactions.orgId, ctx.orgId);
  const rows = await ctx.db
    .select({ tx: transactions, provider: sources.provider, sourceLabel: sources.label })
    .from(transactions)
    .innerJoin(sources, eq(sources.id, transactions.sourceId))
    .where(where)
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  if (rows.length === 0) return [];
  const mv = await ctx.db.select().from(movements).where(eq(movements.orgId, ctx.orgId));
  const byTx = new Map<string, MovementRow[]>();
  for (const m of mv) {
    const list = byTx.get(m.transactionId) ?? [];
    list.push(m);
    byTx.set(m.transactionId, list);
  }
  return rows.map((r) => ({ ...r, movements: byTx.get(r.tx.id) ?? [] }));
}

export function toMovement(m: MovementRow): Movement {
  return { direction: m.direction, asset: m.asset, quantity: normalizeNumeric(m.quantity), derived: m.derived };
}

export function toValuedMovement(m: MovementRow): ValuedMovement {
  return {
    ...toMovement(m),
    chfRate: m.chfRate === null ? null : normalizeNumeric(m.chfRate),
    chfValue: m.chfValue === null ? null : normalizeNumeric(m.chfValue),
    rateSource: m.rateSource,
    rateRef: m.rateRef,
  };
}

/** PostgreSQL numeric comes back with trailing zeros ("0.100000000000000000"); strip them. */
export function normalizeNumeric(v: string): string {
  if (!v.includes('.')) return v;
  const s = v.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

export function effectiveClassification(tx: TxRow): Classification {
  return (tx.manualClassification ?? tx.classification) as Classification;
}

/** Transactions whose accounting entry is validated or synced are locked: their inputs must not change silently. */
export async function lockedTransactionIds(ctx: Ctx): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ id: journalEntries.transactionId })
    .from(journalEntries)
    .where(and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.status, ['validated', 'synced', 'sync_failed'])));
  return new Set(rows.map((r) => r.id));
}

/** Sources that have their own crypto account in bexio (optional per-wallet accounts). */
export async function walletAccountSources(ctx: Ctx): Promise<Set<string>> {
  const rows = await ctx.db.select({ key: accountMappings.key }).from(accountMappings)
    .where(and(eq(accountMappings.orgId, ctx.orgId), like(accountMappings.key, 'crypto_asset:%@%')));
  return new Set(rows.map((r) => walletOfKey(r.key)).filter((w): w is string => !!w));
}

/**
 * Engine input for the given transactions. Without per-wallet accounts the input is exactly the historical one.
 * With them, each transaction carries its pool (its source when that source has its own account) and the sending
 * side of a matched transfer carries where the units go.
 */
export function toEngineInput(list: LoadedTx[], walletSources: Set<string>): AccountingTx[] {
  const base = list.map((l): AccountingTx => ({ id: l.tx.id, occurredAt: l.tx.occurredAt, classification: effectiveClassification(l.tx) as Classification, movements: l.movements.map(toValuedMovement) }));
  if (walletSources.size === 0) return base;
  const poolOf = (l: LoadedTx) => (walletSources.has(l.tx.sourceId) ? l.tx.sourceId : null);
  const groups = new Map<string, LoadedTx[]>();
  for (const l of list) {
    if (!l.tx.transferGroupId || effectiveClassification(l.tx) !== 'internal_transfer') continue;
    groups.set(l.tx.transferGroupId, [...(groups.get(l.tx.transferGroupId) ?? []), l]);
  }
  return base.map((a, i) => {
    const l = list[i]!;
    const out: AccountingTx = { ...a, wallet: poolOf(l) };
    const pair = l.tx.transferGroupId ? groups.get(l.tx.transferGroupId) : undefined;
    const sent = l.movements.find((m) => m.direction === 'out');
    const receiver = pair?.find((o) => o.tx.id !== l.tx.id && o.movements.some((m) => m.direction === 'in'));
    const received = receiver?.movements.find((m) => m.direction === 'in' && m.asset === sent?.asset);
    if (sent && receiver && received) out.transferTo = { wallet: poolOf(receiver), receivedQuantity: normalizeNumeric(received.quantity) };
    return out;
  });
}
