import { and, count, eq, max } from 'drizzle-orm';
import { D, ZERO } from '@/core/decimal';
import { zurichDate } from '@/core/valuation/rateTable';
import type { Ctx } from '../context';
import { bexioConnections, disposals, importBatches, journalEntries, transactions } from '../db/schema';
import { latestRun } from './calculation';
import { buildReport } from './reports';

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
    totalCost: totalRow ? String(totalRow[2]) : '0.00',
    totalValue: totalRow && totalRow[4] !== 'incomplet' ? String(totalRow[4]) : null,
    totalUnrealized: totalRow && totalRow[5] !== 'incomplet' ? String(totalRow[5]) : null,
    assets: assets.sort((a, b) => new D(b.cost).comparedTo(a.cost)),
  };
}
