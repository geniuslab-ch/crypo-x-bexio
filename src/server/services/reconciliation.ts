import { and, eq } from 'drizzle-orm';
import Papa from 'papaparse';
import { yearEndExclusive } from '@/core/accounting/closing';
import { parseAmount } from '@/core/decimal';
import { balanceKey, computedBalances, reconcileOne, type ReconciliationStatus } from '@/core/reconciliation';
import { audit } from '../audit';
import { AppError, assertCanWrite, type Ctx } from '../context';
import { reportedBalances, sources } from '../db/schema';
import { applyOpeningCutoff, loadTransactions, normalizeNumeric } from './transactions';

export interface ReconciliationRow {
  sourceId: string;
  sourceLabel: string;
  asset: string;
  computed: string;
  reported: string | null;
  difference: string | null;
  status: ReconciliationStatus;
  evidence: string | null;
  reportedId: string | null;
}

/** End of a calendar day in Switzerland (exclusive bound). */
function endOfDay(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Midnight Zurich is 23:00 or 22:00 UTC the day before; use the offset of that day.
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const offset = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', hour: 'numeric', hour12: false }).format(noonUtc)) - 12;
  return new Date(Date.UTC(y, m - 1, d + 1, -offset));
}

export function defaultReconciliationDate(): string {
  const y = new Date().getFullYear() - 1;
  return `${y}-12-31`;
}

/**
 * Balances at the end of `date` (Europe/Zurich) per source and asset: computed from the transactions used by the
 * calculation (after opening balances), next to the balance stated by the platform when one was entered.
 */
export async function reconcile(ctx: Ctx, date: string): Promise<ReconciliationRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('invalid', 'invalid_date');
  const until = date.endsWith('-12-31') ? yearEndExclusive(Number(date.slice(0, 4))) : endOfDay(date);
  const loaded = applyOpeningCutoff(await loadTransactions(ctx)).kept;
  const computed = computedBalances(loaded.flatMap((l) => l.movements.map((m) => ({
    sourceId: l.tx.sourceId, occurredAt: l.tx.occurredAt, direction: m.direction, asset: m.asset, quantity: normalizeNumeric(m.quantity), derived: m.derived,
  }))), until);
  const reported = await ctx.db.select().from(reportedBalances).where(and(eq(reportedBalances.orgId, ctx.orgId), eq(reportedBalances.asOf, date)));
  const labels = new Map((await ctx.db.select().from(sources).where(eq(sources.orgId, ctx.orgId))).map((s) => [s.id, s.label]));
  const keys = new Set<string>([...computed.entries()].filter(([, v]) => !v.isZero()).map(([k]) => k));
  for (const r of reported) keys.add(balanceKey(r.sourceId, r.asset));
  const byKey = new Map(reported.map((r) => [balanceKey(r.sourceId, r.asset), r]));
  return [...keys].map((k) => {
    const [sourceId, asset] = k.split('|') as [string, string];
    const r = byKey.get(k);
    const c = computed.get(k);
    const res = reconcileOne(c, r ? normalizeNumeric(r.quantity) : null);
    return {
      sourceId, sourceLabel: labels.get(sourceId) ?? '—', asset, computed: c ? c.toString() : '0',
      reported: r ? normalizeNumeric(r.quantity) : null, ...res, evidence: r?.evidence ?? null, reportedId: r?.id ?? null,
    };
  }).sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel) || a.asset.localeCompare(b.asset));
}

/**
 * Imports balances stated by platforms: CSV with columns source (name of the wallet or exchange in Crypto2Books),
 * asset, date (YYYY-MM-DD), balance, and optionally evidence. A balance already entered for the same source, asset
 * and date is replaced (audited).
 */
export async function importReportedBalances(ctx: Ctx, csv: string): Promise<{ saved: number; errors: string[] }> {
  assertCanWrite(ctx);
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const byLabel = new Map((await ctx.db.select().from(sources).where(eq(sources.orgId, ctx.orgId))).map((s) => [s.label.trim().toLowerCase(), s.id]));
  const errors: string[] = [];
  let saved = 0;
  for (const [i, row] of parsed.data.entries()) {
    const line = i + 2;
    const sourceId = byLabel.get((row.source ?? '').trim().toLowerCase());
    if (!sourceId) { errors.push(`Ligne ${line} : la colonne « source » ne correspond à aucun wallet ou exchange`); continue; }
    try {
      await saveReportedBalance(ctx, { sourceId, asset: row.asset ?? '', date: (row.date ?? '').trim(), quantity: row.balance ?? '', evidence: row.evidence ?? null });
      saved++;
    } catch (e) {
      errors.push(`Ligne ${line} : ${e instanceof AppError ? ERRORS[e.message] ?? e.message : 'erreur'}`);
    }
  }
  if (saved === 0 && errors.length === 0) throw new AppError('invalid', 'empty_file');
  if (saved > 0) await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'reported_balances.imported', entity: 'reported_balances', after: { saved, errors: errors.length } });
  return { saved, errors };
}

const ERRORS: Record<string, string> = {
  invalid_date: 'date au format AAAA-MM-JJ obligatoire',
  invalid_asset: 'actif invalide',
  invalid_quantity: 'solde (0 ou plus) obligatoire',
  source_not_found: 'source introuvable',
};

export async function saveReportedBalance(ctx: Ctx, input: { sourceId: string; asset: string; date: string; quantity: string; evidence: string | null }): Promise<void> {
  assertCanWrite(ctx);
  const asset = input.asset.trim().toUpperCase();
  const qty = parseAmount(input.quantity);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new AppError('invalid', 'invalid_date');
  if (!/^[A-Z0-9.\-_]{1,20}$/.test(asset)) throw new AppError('invalid', 'invalid_asset');
  if (!qty || qty.isNegative()) throw new AppError('invalid', 'invalid_quantity');
  const [src] = await ctx.db.select({ id: sources.id }).from(sources).where(and(eq(sources.orgId, ctx.orgId), eq(sources.id, input.sourceId)));
  if (!src) throw new AppError('not_found', 'source_not_found');
  const evidence = input.evidence?.trim().slice(0, 200) || null;
  const [prev] = await ctx.db.select().from(reportedBalances).where(and(eq(reportedBalances.orgId, ctx.orgId), eq(reportedBalances.sourceId, input.sourceId),
    eq(reportedBalances.asset, asset), eq(reportedBalances.asOf, input.date)));
  if (prev) {
    await ctx.db.update(reportedBalances).set({ quantity: qty.toString(), evidence, createdBy: ctx.userId }).where(eq(reportedBalances.id, prev.id));
    if (normalizeNumeric(prev.quantity) !== qty.toString()) {
      await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'reported_balance.replaced', entity: 'reported_balance', entityId: prev.id,
        before: { quantity: prev.quantity }, after: { quantity: qty.toString() } });
    }
    return;
  }
  await ctx.db.insert(reportedBalances).values({ orgId: ctx.orgId, sourceId: input.sourceId, asset, asOf: input.date, quantity: qty.toString(), evidence, createdBy: ctx.userId });
}

export async function deleteReportedBalance(ctx: Ctx, id: string): Promise<void> {
  assertCanWrite(ctx);
  const [r] = await ctx.db.select().from(reportedBalances).where(and(eq(reportedBalances.orgId, ctx.orgId), eq(reportedBalances.id, id)));
  if (!r) throw new AppError('not_found', 'not_found');
  await ctx.db.delete(reportedBalances).where(eq(reportedBalances.id, id));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'reported_balance.deleted', entity: 'reported_balance', entityId: id, before: { asset: r.asset, quantity: r.quantity, asOf: r.asOf } });
}
