import { and, count, eq, inArray, max } from 'drizzle-orm';
import { D, ZERO } from '@/core/decimal';
import { INCOME_CLASSIFICATIONS, type Classification } from '@/core/types';
import { zurichDate } from '@/core/valuation/rateTable';
import type { Ctx } from '../context';
import type { DB } from '../db';
import type { Role } from '../context';
import { bexioConnections, disposals, importBatches, journalEntries, movements, transactions } from '../db/schema';
import { latestRun } from './calculation';
import { reconcile } from './reconciliation';
import { buildReport } from './reports';
import { lastClosedYear } from './transactions';

export async function dashboardStats(ctx: Ctx) {
  const year = Number(zurichDate(new Date()).slice(0, 4));
  const [[txCount], [review], [lastImport], entryCounts, conn, run] = await Promise.all([
    ctx.db.select({ n: count() }).from(transactions).where(eq(transactions.orgId, ctx.orgId)),
    ctx.db.select({ n: count() }).from(transactions).where(and(eq(transactions.orgId, ctx.orgId), eq(transactions.reviewStatus, 'needs_review'))),
    ctx.db.select({ at: max(importBatches.createdAt) }).from(importBatches).where(eq(importBatches.orgId, ctx.orgId)),
    ctx.db.select({ status: journalEntries.status, n: count() }).from(journalEntries).where(eq(journalEntries.orgId, ctx.orgId)).groupBy(journalEntries.status),
    ctx.db.select().from(bexioConnections).where(eq(bexioConnections.orgId, ctx.orgId)),
    latestRun(ctx),
  ]);
  const all = await ctx.db.select({ rateMissing: transactions.rateMissing }).from(transactions).where(eq(transactions.orgId, ctx.orgId));
  const rateMissingCount = all.filter((t) => Array.isArray(t.rateMissing) && t.rateMissing.length > 0).length;

  let realizedYtd: string | null = null;
  if (run && run.status === 'complete') {
    const rows = await ctx.db.select({ gain: disposals.gainChf, at: disposals.occurredAt }).from(disposals).where(eq(disposals.runId, run.id));
    realizedYtd = rows.filter((r) => zurichDate(r.at).startsWith(`${year}-`)).reduce((a, r) => a.plus(r.gain), ZERO).toFixed(2);
  }

  // Staking, mining, airdrop and lending income of the year, at the CHF value of the day received.
  const incomeRows = await ctx.db.select({ cls: transactions.classification, manual: transactions.manualClassification, at: transactions.occurredAt, v: movements.chfValue })
    .from(movements).innerJoin(transactions, eq(transactions.id, movements.transactionId))
    .where(and(eq(movements.orgId, ctx.orgId), eq(movements.direction, 'in')));
  const incomeYtd = incomeRows.filter((r) => INCOME_CLASSIFICATIONS.has((r.manual ?? r.cls) as Classification) && zurichDate(r.at).startsWith(`${year}-`))
    .reduce((a, r) => a.plus(r.v ?? 0), ZERO).toFixed(2);

  const recDate = `${year - 1}-12-31`;
  const rec = await reconcile(ctx, recDate);
  const closedYear = await lastClosedYear(ctx);

  const holdings = await buildReport(ctx, 'holdings', { year: null });
  const totalRow = holdings.rows.at(-1);
  const assets = holdings.rows.slice(0, -1).map((r) => ({
    asset: String(r[0]), quantity: String(r[1]), cost: String(r[2]), value: r[4] === null ? null : String(r[4]), unrealized: r[5] === null ? null : String(r[5]),
  }));
  const byStatus = Object.fromEntries(entryCounts.map((e) => [e.status, Number(e.n)]));

  return {
    year,
    transactions: Number(txCount?.n ?? 0),
    awaitingReview: Number(review?.n ?? 0),
    rateMissing: rateMissingCount,
    lastImportAt: lastImport?.at ?? null,
    entries: { draft: byStatus.draft ?? 0, validated: byStatus.validated ?? 0, synced: byStatus.synced ?? 0, failed: byStatus.sync_failed ?? 0 },
    bexio: conn[0] ? { connected: true, company: conn[0].companyName, lastSyncAt: conn[0].lastSyncAt } : { connected: false, company: null, lastSyncAt: null },
    run: run ? { status: run.status, at: run.createdAt, issues: (run.issues as unknown[]).length } : null,
    realizedYtd,
    incomeYtd,
    reconciliation: { date: recDate, gaps: rec.filter((r) => r.status === 'gap').length, notReported: rec.filter((r) => r.status === 'not_reported').length, ok: rec.filter((r) => r.status === 'ok').length },
    closedYear,
    totalCost: totalRow ? String(totalRow[2]) : '0.00',
    totalValue: totalRow && totalRow[4] !== 'incomplet' ? String(totalRow[4]) : null,
    totalUnrealized: totalRow && totalRow[5] !== 'incomplet' ? String(totalRow[5]) : null,
    assets: assets.sort((a, b) => new D(b.cost).comparedTo(a.cost)),
  };
}

export interface ClientOverview {
  orgId: string;
  name: string;
  toReview: number;
  drafts: number;
  toSync: number;
  syncFailed: number;
  reconciliationGaps: number;
  lastClosedYear: number | null;
  /** Previous calendar year closed in Crypto2Books. */
  previousYearClosed: boolean;
}

/** One line per client file of the user: what is waiting, gaps, and the closing status of last year. */
export async function fiduciaryOverview(db: DB, userId: string, orgs: { id: string; name: string; role: string }[]): Promise<ClientOverview[]> {
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.id);
  const [reviews, entries] = await Promise.all([
    db.select({ org: transactions.orgId, n: count() }).from(transactions).where(and(inArray(transactions.orgId, ids), eq(transactions.reviewStatus, 'needs_review'))).groupBy(transactions.orgId),
    db.select({ org: journalEntries.orgId, status: journalEntries.status, n: count() }).from(journalEntries).where(inArray(journalEntries.orgId, ids)).groupBy(journalEntries.orgId, journalEntries.status),
  ]);
  const prev = Number(zurichDate(new Date()).slice(0, 4)) - 1;
  const out: ClientOverview[] = [];
  for (const o of orgs) {
    const ctx: Ctx = { db, userId, orgId: o.id, role: o.role as Role };
    const e = (st: string) => Number(entries.find((x) => x.org === o.id && x.status === st)?.n ?? 0);
    const closed = await lastClosedYear(ctx);
    out.push({
      orgId: o.id, name: o.name, toReview: Number(reviews.find((r) => r.org === o.id)?.n ?? 0), drafts: e('draft'), toSync: e('validated'), syncFailed: e('sync_failed'),
      reconciliationGaps: (await reconcile(ctx, `${prev}-12-31`)).filter((r) => r.status === 'gap').length,
      lastClosedYear: closed, previousYearClosed: closed !== null && closed >= prev,
    });
  }
  return out;
}
