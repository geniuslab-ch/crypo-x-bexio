import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { runAccounting, type AccountingPolicy, type AccountingTx, type EngineIssue } from '@/core/accounting/engine';
import { postingsToLines, type JournalLine } from '@/core/accounting/journal';
import { D, type Dec } from '@/core/decimal';
import { sha256 } from '@/core/fingerprint';
import type { Classification } from '@/core/types';
import { zurichDate } from '@/core/valuation/rateTable';
import { audit } from '../audit';
import { AppError, assertCanValidate, assertCanWrite, type Ctx } from '../context';
import {
  accountingPolicies, auditLog, calculationRuns, disposals, journalEntries, journalLines, lots, transactions,
} from '../db/schema';
import {
  applyOpeningCutoff, effectiveClassification, lastClosedYear, loadTransactions, normalizeNumeric, toEngineInput, walletAccountSources, type LoadedTx,
} from './transactions';

export interface RunIssue extends EngineIssue {
  occurredAt?: string;
}

const LABELS_FR: Record<string, string> = {
  buy: 'Achat', sell: 'Vente', swap: 'Échange', fiat_deposit: 'Dépôt fiat', fiat_withdrawal: 'Retrait fiat',
  deposit: 'Dépôt crypto externe', withdrawal: 'Retrait crypto externe', internal_transfer: 'Transfert interne',
  trading_fee: 'Frais de trading', network_fee: 'Frais de réseau', staking_reward: 'Récompense de staking',
  mining_reward: 'Récompense de minage', airdrop: 'Airdrop', lending_interest: 'Intérêts de prêt',
  defi: 'Opération DeFi (échange)', liquidity_pool: 'Pool de liquidité (échange)',
};

function describe(l: LoadedTx, cls: Classification): string {
  const legs = l.movements.filter((m) => m.direction !== 'fee')
    .map((m) => `${m.direction === 'in' ? '+' : '-'}${normalizeNumeric(m.quantity)} ${m.asset}`).join(' ');
  const ref = l.tx.externalId ? ` réf. ${l.tx.externalId}` : '';
  // bexio does not document a max description length; keep it short and safe.
  return `Crypto2Books · ${LABELS_FR[cls] ?? cls} ${legs} · ${l.sourceLabel}${ref}`.slice(0, 200);
}

export async function getPolicy(ctx: Ctx) {
  const [p] = await ctx.db.select().from(accountingPolicies).where(eq(accountingPolicies.orgId, ctx.orgId));
  if (!p) throw new AppError('not_found', 'policy_missing');
  return p;
}

/**
 * What a policy change would touch, shown before the user unlocks the settings: validated or synced entries and a
 * closed year freeze the method and the fee treatment; drafts are recalculated at the next run.
 */
export async function policyLockState(ctx: Ctx) {
  const rows = await ctx.db.select({ status: journalEntries.status, n: count() }).from(journalEntries)
    .where(and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.status, ['draft', 'validated', 'synced', 'sync_failed'])))
    .groupBy(journalEntries.status);
  const drafts = rows.find((r) => r.status === 'draft')?.n ?? 0;
  const validated = rows.filter((r) => r.status !== 'draft').reduce((a, r) => a + r.n, 0);
  const closedYear = await lastClosedYear(ctx);
  const [chosen] = await ctx.db.select({ id: auditLog.id }).from(auditLog)
    .where(and(eq(auditLog.orgId, ctx.orgId), eq(auditLog.action, 'policy.updated'))).limit(1);
  return { drafts, validated, closedYear, methodLocked: validated > 0 || closedYear !== null, everSaved: Boolean(chosen) };
}

export async function updatePolicy(ctx: Ctx, input: { costBasisMethod: 'fifo' | 'wac'; tradingFeeTreatment: 'capitalize' | 'expense'; transferWindowHours: number }) {
  assertCanWrite(ctx);
  const before = await getPolicy(ctx);
  if (!Number.isInteger(input.transferWindowHours) || input.transferWindowHours < 1 || input.transferWindowHours > 720) throw new AppError('invalid', 'invalid_window');
  const methodChanged = before.costBasisMethod !== input.costBasisMethod || before.tradingFeeTreatment !== input.tradingFeeTreatment;
  if (methodChanged) {
    // Changing the method once entries are validated would silently change accepted results: forbid it.
    const [validated] = await ctx.db.select({ id: journalEntries.id }).from(journalEntries)
      .where(and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.status, ['validated', 'synced', 'sync_failed']))).limit(1);
    if (validated) throw new AppError('conflict', 'policy_locked_by_validated_entries');
    // A closed year was valued with the current method; the following years must keep it (CO art. 958c al. 1 ch. 6).
    if ((await lastClosedYear(ctx)) !== null) throw new AppError('conflict', 'policy_locked_by_closed_year');
  }
  const unchanged = !methodChanged && before.transferWindowHours === input.transferWindowHours;
  // Saving the same values again must not cancel the fiduciary review; the first save still records the choice.
  if (unchanged) {
    if (!(await policyLockState(ctx)).everSaved) {
      await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'policy.updated', entity: 'accounting_policy', entityId: before.id, before, after: input });
    }
    return;
  }
  await ctx.db.update(accountingPolicies).set({ ...input, reviewedByFiduciaryAt: null, reviewedByUserId: null, updatedAt: new Date() })
    .where(eq(accountingPolicies.orgId, ctx.orgId));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'policy.updated', entity: 'accounting_policy', entityId: before.id, before, after: input });
}

export async function markPolicyReviewed(ctx: Ctx) {
  if (ctx.role !== 'fiduciary' && ctx.role !== 'accountant') throw new AppError('forbidden', 'only_fiduciary_or_accountant');
  await ctx.db.update(accountingPolicies).set({ reviewedByFiduciaryAt: new Date(), reviewedByUserId: ctx.userId }).where(eq(accountingPolicies.orgId, ctx.orgId));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'policy.reviewed', entity: 'accounting_policy' });
}

/**
 * Everything a calculation depends on: the policy, the transactions after the opening cutoff, the ones still to
 * review, the engine input and its hash (to tell whether a stored run is still up to date).
 */
export async function prepareCalculation(ctx: Ctx) {
  const p = await getPolicy(ctx);
  const policy: AccountingPolicy = {
    method: p.costBasisMethod === 'wac' ? 'wac' : 'fifo',
    tradingFeeTreatment: p.tradingFeeTreatment === 'expense' ? 'expense' : 'capitalize',
  };
  const { kept: loaded, excluded } = applyOpeningCutoff(await loadTransactions(ctx));
  const issues: RunIssue[] = [];
  const bookable: LoadedTx[] = [];
  for (const l of loaded) {
    if (l.tx.reviewStatus === 'needs_review' && !l.tx.manualClassification) {
      issues.push({ txId: l.tx.id, code: 'needs_review', message: 'La classification doit être confirmée', occurredAt: l.tx.occurredAt.toISOString() });
      continue;
    }
    bookable.push(l);
  }
  const engineInput: AccountingTx[] = toEngineInput(bookable, await walletAccountSources(ctx));
  const inputHash = sha256(JSON.stringify({ policy, engineInput }));
  return { policy, loaded, excluded, issues, bookable, engineInput, inputHash };
}

/**
 * Runs a full calculation and (re)generates draft journal entries.
 * - Blocked runs (review needed, missing rates, missing history) generate no entries at all, because
 *   any gap can change the cost basis of later disposals.
 * - Validated/synced entries are never modified. If the new result differs, a conflict is reported.
 */
export async function runCalculation(ctx: Ctx): Promise<{ runId: string; status: 'complete' | 'blocked'; issues: RunIssue[]; created: number; unchanged: number; superseded: number }> {
  assertCanWrite(ctx);
  const { policy, loaded, issues, engineInput, inputHash } = await prepareCalculation(ctx);
  const engine = runAccounting(engineInput, policy);
  const byId = new Map(loaded.map((l) => [l.tx.id, l]));
  for (const i of engine.issues) issues.push({ ...i, occurredAt: byId.get(i.txId)?.tx.occurredAt.toISOString() });
  const status = issues.length > 0 ? 'blocked' : 'complete';
  const closedYear = await lastClosedYear(ctx);
  const closedUntil = closedYear === null ? null : `${closedYear}-12-31`;

  return ctx.db.transaction(async (db) => {
    const [run] = await db.insert(calculationRuns).values({
      orgId: ctx.orgId, status, policySnapshot: policy, inputHash, issues, transactionCount: loaded.length, createdBy: ctx.userId,
    }).returning({ id: calculationRuns.id });
    const runId = run!.id;

    const lotRows = engine.results.flatMap((r) => r.acquisitions.map((a) => ({
      orgId: ctx.orgId, runId, lotKey: a.lotId, transactionId: a.txId, asset: a.asset, acquiredAt: a.acquiredAt, quantity: a.quantity, costChf: a.costChf,
    })));
    if (lotRows.length) await db.insert(lots).values(lotRows);
    const dispRows = engine.results.flatMap((r) => r.disposals.map((d) => ({
      orgId: ctx.orgId, runId, transactionId: d.txId, asset: d.asset, kind: d.kind, quantity: d.quantity, proceedsChf: d.proceedsChf,
      costChf: d.costChf, gainChf: d.gainChf, allocations: d.allocations, occurredAt: byId.get(d.txId)!.tx.occurredAt,
    })));
    if (dispRows.length) await db.insert(disposals).values(dispRows);

    let created = 0;
    let unchanged = 0;
    let superseded = 0;
    if (status === 'complete') {
      // Year-end entries belong to a closing, not to a transaction: the calculation leaves them alone.
      const existing = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.kind, 'transaction'), ne(journalEntries.status, 'superseded')));
      const existingByTx = new Map(existing.map((e) => [e.transactionId!, e]));
      const producedTx = new Set<string>();
      // A kept validated entry that differs from the new result means the saved journal no longer matches this
      // run's lines: the rounding ledger would then describe bookings that do not exist, so it is not stored.
      let conflict = false;
      // Cumulative rounding per account across the whole history (see postingsToLines).
      const carry = new Map<string, Dec>();
      const exact = new Map<string, Dec>();
      const booked = new Map<string, Dec>();
      const add = (m: Map<string, Dec>, k: string, v: Dec) => m.set(k, (m.get(k) ?? new D(0)).plus(v));
      for (const r of engine.results) {
        for (const p of r.postings) add(exact, p.key, p.amount);
        const lines = postingsToLines(r.postings, carry);
        for (const ln of lines) { add(booked, ln.debitKey, new D(ln.amount)); add(booked, ln.creditKey, new D(ln.amount).neg()); }
        if (lines.length === 0) continue;
        producedTx.add(r.txId);
        const l = byId.get(r.txId)!;
        const date = zurichDate(l.tx.occurredAt);
        const contentHash = sha256(JSON.stringify({ date, lines }));
        const prev = existingByTx.get(r.txId);
        if (prev && prev.contentHash === contentHash) {
          unchanged++;
          continue;
        }
        if (closedUntil && date <= closedUntil) {
          conflict = true;
          issues.push({ txId: r.txId, code: 'period_closed', message: `L’exercice ${closedYear} est clôturé : cette écriture du ${date} ne peut plus être créée ni modifiée. Rouvrez l’exercice si la correction est voulue.` });
          continue;
        }
        if (prev && prev.status !== 'draft') {
          conflict = true;
          issues.push({ txId: r.txId, code: 'not_bookable', message: `Le nouveau résultat diffère de l’écriture validée ${prev.referenceNr}. Passez une correction explicite : une écriture validée n’est jamais modifiée automatiquement.` });
          continue;
        }
        if (prev) {
          await db.update(journalEntries).set({ status: 'superseded' }).where(eq(journalEntries.id, prev.id));
          superseded++;
        }
        await insertEntry(db, ctx, runId, l, date, contentHash, lines);
        created++;
      }
      // Drafts whose transaction no longer produces a booking are superseded.
      for (const e of existing) {
        if (producedTx.has(e.transactionId!)) continue;
        if (e.status === 'draft') {
          await db.update(journalEntries).set({ status: 'superseded' }).where(eq(journalEntries.id, e.id));
          superseded++;
        } else {
          conflict = true;
          issues.push({ txId: e.transactionId!, code: 'not_bookable', message: `L’écriture validée ${e.referenceNr} ne correspond plus au calcul. Passez une extourne explicite.` });
        }
      }
      const roundingLedger = conflict ? null : [...exact.keys()].sort().map((key) => {
        const e = exact.get(key)!;
        const b = booked.get(key) ?? new D(0);
        return { key, exactChf: e.toString(), bookedChf: b.toFixed(2), carriedChf: e.minus(b).toString() };
      });
      await db.update(calculationRuns).set({ issues, roundingLedger }).where(eq(calculationRuns.id, runId));
    }
    await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'calculation.run', entity: 'calculation_run', entityId: runId,
      after: { status, policy, issues: issues.length, created, unchanged, superseded } });
    return { runId, status, issues, created, unchanged, superseded };
  });
}

async function insertEntry(
  db: Parameters<Parameters<Ctx['db']['transaction']>[0]>[0],
  ctx: Ctx, runId: string, l: LoadedTx, date: string, contentHash: string, lines: JournalLine[],
) {
  const cls = effectiveClassification(l.tx);
  const description = describe(l, cls);
  const [entry] = await db.insert(journalEntries).values({
    orgId: ctx.orgId, runId, transactionId: l.tx.id, contentHash, entryDate: date, referenceNr: 'pending', description, status: 'draft',
  }).returning({ id: journalEntries.id });
  // Deterministic reference used for idempotent bexio sync (≤ 80 chars as required by bexio).
  const referenceNr = `C2B-${entry!.id.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
  await db.update(journalEntries).set({ referenceNr }).where(eq(journalEntries.id, entry!.id));
  await db.insert(journalLines).values(lines.map((ln, i) => ({
    orgId: ctx.orgId, entryId: entry!.id, position: i, debitKey: ln.debitKey, creditKey: ln.creditKey, amountChf: ln.amount, description,
  })));
}

export async function latestRun(ctx: Ctx) {
  const [r] = await ctx.db.select().from(calculationRuns).where(eq(calculationRuns.orgId, ctx.orgId)).orderBy(desc(calculationRuns.createdAt)).limit(1);
  return r ?? null;
}

export async function listEntries(ctx: Ctx, statuses?: (typeof journalEntries.$inferSelect)['status'][]) {
  const where = statuses ? and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.status, statuses)) : eq(journalEntries.orgId, ctx.orgId);
  const entries = await ctx.db.select().from(journalEntries).where(where).orderBy(journalEntries.entryDate, journalEntries.createdAt);
  const lines = entries.length
    ? await ctx.db.select().from(journalLines).where(inArray(journalLines.entryId, entries.map((e) => e.id))).orderBy(journalLines.position)
    : [];
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entryId === e.id) }));
}

export async function setEntriesValidated(ctx: Ctx, entryIds: string[], validated: boolean): Promise<number> {
  assertCanValidate(ctx);
  if (entryIds.length === 0) return 0;
  const rows = await ctx.db.select().from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.id, entryIds)));
  const from = validated ? 'draft' : 'validated';
  const target = rows.filter((r) => r.status === from);
  if (target.length === 0) return 0;
  if (!validated) {
    // Year-end entries are removed by reopening the year; entries of a closed year stay validated.
    if (target.some((t) => t.kind !== 'transaction')) throw new AppError('conflict', 'closing_entry_managed_by_closing');
    const closedYear = await lastClosedYear(ctx);
    if (closedYear !== null && target.some((t) => t.entryDate <= `${closedYear}-12-31`)) throw new AppError('conflict', 'period_closed');
  }
  await ctx.db.transaction(async (db) => {
    await db.update(journalEntries).set(validated
      ? { status: 'validated', validatedBy: ctx.userId, validatedAt: new Date() }
      : { status: 'draft', validatedBy: null, validatedAt: null })
      .where(inArray(journalEntries.id, target.map((t) => t.id)));
    for (const t of target) {
      await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: validated ? 'entry.validated' : 'entry.unvalidated', entity: 'journal_entry', entityId: t.id,
        before: { status: t.status }, after: { status: validated ? 'validated' : 'draft' } });
    }
  });
  return target.length;
}

