import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import Papa from 'papaparse';
import {
  bookBalances, openingBalanceInstant, reversalLines, valuationLines, valuationRows, yearEndExclusive,
  type RateBasis, type ValuationMethod, type ValuationRow,
} from '@/core/accounting/closing';
import { cryptoAssetKey } from '@/core/accounting/accountKeys';
import { runAccounting } from '@/core/accounting/engine';
import type { JournalLine } from '@/core/accounting/journal';
import { isFiat } from '@/core/assets';
import { D, parseAmount } from '@/core/decimal';
import { sha256 } from '@/core/fingerprint';
import { rateTableLookup } from '@/core/valuation/rateTable';
import { coingeckoConfigured, fetchCoinGeckoChfRate } from '@/integrations/prices/coingecko';
import { audit } from '../audit';
import { AppError, assertCanValidate, assertCanWrite, type Ctx } from '../context';
import {
  calculationRuns, fiscalClosings, journalEntries, journalLines, priceRates, sources, taxValues, transactions,
} from '../db/schema';
import { prepareCalculation } from './calculation';
import { persistBatch } from './imports';
import { applyOpeningCutoff, lastClosedYear, loadTransactions, normalizeNumeric } from './transactions';
import { revalue } from './valuation';

type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];

export interface ClosingPreview {
  year: number;
  method: ValuationMethod;
  rateBasis: RateBasis;
  rows: ValuationRow[];
  /** Assets without a documented CHF value at 31.12 (closing blocked). */
  missing: string[];
  /** Reasons the year cannot be closed now (empty = ready). */
  blockers: string[];
  lines: JournalLine[];
}

const METHOD_LABEL: Record<ValuationMethod, string> = {
  lower_of_cost: 'valeur la plus basse (CO 960)',
  market: 'valeur de marché (CO 960b)',
};

export async function listClosings(ctx: Ctx) {
  return ctx.db.select().from(fiscalClosings).where(eq(fiscalClosings.orgId, ctx.orgId)).orderBy(desc(fiscalClosings.year));
}

/**
 * Valuation table at 31.12 of `year` and the reasons closing is not possible yet. Nothing is written, except that
 * missing market rates are fetched from the configured provider and stored with their source (like any valuation).
 */
export async function previewClosing(ctx: Ctx, year: number, method: ValuationMethod, rateBasis: RateBasis, opts: { fetchMissing?: boolean } = {}): Promise<ClosingPreview> {
  if (!Number.isInteger(year) || year < 2009 || year > 2100) throw new AppError('invalid', 'invalid_year');
  const blockers: string[] = [];
  const existing = (await listClosings(ctx)).find((c) => c.year === year && c.status === 'closed');
  if (existing) blockers.push(`L’exercice ${year} est déjà clôturé.`);
  const last = await lastClosedYear(ctx);
  if (last !== null && last > year) blockers.push(`L’exercice ${last} est clôturé : un exercice antérieur ne peut plus être clôturé.`);

  const prep = await prepareCalculation(ctx);
  const [run] = await ctx.db.select().from(calculationRuns).where(eq(calculationRuns.orgId, ctx.orgId)).orderBy(desc(calculationRuns.createdAt)).limit(1);
  if (!run) blockers.push('Aucun calcul : lancez le calcul dans « Comptabilité ».');
  else if (run.status !== 'complete' || (run.issues as unknown[]).length > 0) blockers.push('Le dernier calcul a des points à résoudre (voir « Comptabilité »).');
  else if (run.inputHash !== prep.inputHash || prep.issues.length > 0) blockers.push('Des transactions ont changé depuis le dernier calcul : relancez le calcul.');

  const yearEnd = `${year}-12-31`;
  const drafts = await ctx.db.select({ id: journalEntries.id }).from(journalEntries)
    .where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.status, 'draft'), lte(journalEntries.entryDate, yearEnd)));
  if (drafts.length > 0) blockers.push(`${drafts.length} écriture(s) de ${year} ou avant encore en brouillon : validez-les dans « Comptabilité ».`);

  // Holdings per crypto account at 31.12, from the same input as the calculation.
  const end = yearEndExclusive(year);
  const engine = runAccounting(prep.engineInput.filter((t) => t.occurredAt < end), prep.policy);
  // Balance of each account in bexio: the opening balance carried forward (not booked by Crypto2Books) plus the
  // entries booked since.
  const booked = bookBalances(await bookedLinesUntil(ctx, yearEnd));
  for (const t of prep.engineInput) {
    if (t.classification !== 'opening_balance' || t.occurredAt >= end) continue;
    for (const m of t.movements) {
      if (m.direction !== 'in' || m.chfValue === null) continue;
      const k = cryptoAssetKey(m.asset, t.wallet);
      booked.set(k, (booked.get(k) ?? new D(0)).plus(new D(m.chfValue).toDecimalPlaces(2, D.ROUND_HALF_UP)));
    }
  }

  let rate: (asset: string) => { rate: string; source: string } | null;
  if (rateBasis === 'tax_value') {
    const tv = new Map((await ctx.db.select().from(taxValues).where(and(eq(taxValues.orgId, ctx.orgId), eq(taxValues.taxYear, year))))
      .map((v) => [v.asset, v]));
    rate = (asset) => {
      const v = tv.get(asset);
      return v ? { rate: normalizeNumeric(v.valueChf), source: `Valeur fiscale ${year} : ${v.source}${v.sourceUrl ? ` · ${v.sourceUrl}` : ''}` } : null;
    };
  } else {
    if (opts.fetchMissing && coingeckoConfigured()) await fetchYearEndRates(ctx, engine.pools.map((p) => p.asset), yearEnd);
    const rows = await ctx.db.select().from(priceRates).where(and(eq(priceRates.orgId, ctx.orgId), eq(priceRates.rateDate, yearEnd)));
    const lookup = rateTableLookup(rows.map((r) => ({ asset: r.asset, rateDate: r.rateDate, rate: normalizeNumeric(r.rate), source: r.source, sourceUrl: r.sourceUrl })));
    const at = new Date(`${yearEnd}T12:00:00Z`);
    rate = (asset) => {
      const q = lookup(asset, at);
      return q ? { rate: q.rate, source: q.ref } : null;
    };
  }

  const inputs = engine.pools.map((p) => {
    const r = rate(p.asset);
    return {
      key: p.key, asset: p.asset, quantity: p.quantity.toString(), bookValue: (booked.get(p.key) ?? new D(0)).toFixed(2),
      rate: r?.rate ?? null, rateSource: r?.source ?? null,
    };
  });
  const { rows, missing } = valuationRows(inputs, method);
  if (missing.length) {
    blockers.push(rateBasis === 'tax_value'
      ? `Valeur fiscale ${year} manquante pour ${missing.join(', ')} : importez la Kursliste AFC dans « Paramètres ».`
      : `Cours CHF du ${yearEnd} manquant pour ${missing.join(', ')} : importez un cours documenté dans « Comptabilité ».`);
  }
  return { year, method, rateBasis, rows, missing, blockers, lines: valuationLines(rows) };
}

async function bookedLinesUntil(ctx: Ctx, date: string) {
  return ctx.db.select({ debitKey: journalLines.debitKey, creditKey: journalLines.creditKey, amountChf: journalLines.amountChf })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalEntries.orgId, ctx.orgId), ne(journalEntries.status, 'superseded'), lte(journalEntries.entryDate, date)));
}

async function fetchYearEndRates(ctx: Ctx, assets: string[], date: string) {
  const have = new Set((await ctx.db.select({ asset: priceRates.asset }).from(priceRates)
    .where(and(eq(priceRates.orgId, ctx.orgId), eq(priceRates.rateDate, date)))).map((r) => r.asset));
  let fetched = 0;
  for (const asset of [...new Set(assets)].filter((a) => !have.has(a))) {
    try {
      const q = await fetchCoinGeckoChfRate(asset, date);
      if (!q) continue;
      await ctx.db.insert(priceRates).values({ orgId: ctx.orgId, asset, rateDate: date, rate: q.rate, source: 'CoinGecko daily snapshot (00:00 UTC)', sourceUrl: q.sourceUrl })
        .onConflictDoNothing();
      fetched++;
    } catch {
      // The asset stays listed as missing; the user can import a documented rate.
    }
  }
  if (fetched > 0) await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'rates.fetched', entity: 'price_rates', after: { provider: 'coingecko', fetched, date } });
}

/**
 * Closes a year: books the 31.12 valuation entry and its reversal on 1.1 (both validated, ready for bexio), stores the
 * valuation table as evidence and locks the year.
 */
export async function closeYear(ctx: Ctx, year: number, method: ValuationMethod, rateBasis: RateBasis): Promise<{ entries: number }> {
  assertCanValidate(ctx);
  const p = await previewClosing(ctx, year, method, rateBasis);
  if (p.blockers.length > 0) throw new AppError('conflict', 'closing_blocked');
  const [run] = await ctx.db.select({ id: calculationRuns.id }).from(calculationRuns).where(eq(calculationRuns.orgId, ctx.orgId)).orderBy(desc(calculationRuns.createdAt)).limit(1);
  return ctx.db.transaction(async (db) => {
    let valuationEntryId: string | null = null;
    let reversalEntryId: string | null = null;
    if (p.lines.length > 0) {
      const label = METHOD_LABEL[method];
      valuationEntryId = await insertClosingEntry(db, ctx, run!.id, year, 'year_end_valuation', `${year}-12-31`,
        `Crypto2Books · Évaluation de clôture des actifs numériques au 31.12.${year}, ${label}`, p.lines);
      reversalEntryId = await insertClosingEntry(db, ctx, run!.id, year, 'year_end_reversal', `${year + 1}-01-01`,
        `Crypto2Books · Extourne de l’évaluation de clôture ${year}`, reversalLines(p.lines));
    }
    const values = {
      status: 'closed', valuationMethod: method, rateBasis, snapshot: p.rows, valuationEntryId, reversalEntryId,
      closedBy: ctx.userId, closedAt: new Date(), reopenedBy: null, reopenedAt: null,
    };
    await db.insert(fiscalClosings).values({ orgId: ctx.orgId, year, ...values })
      .onConflictDoUpdate({ target: [fiscalClosings.orgId, fiscalClosings.year], set: values });
    await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'year.closed', entity: 'fiscal_closing', entityId: String(year),
      after: { method, rateBasis, rows: p.rows.length, lines: p.lines.length } });
    return { entries: p.lines.length > 0 ? 2 : 0 };
  });
}

async function insertClosingEntry(db: Tx, ctx: Ctx, runId: string, year: number, kind: string, date: string, description: string, lines: JournalLine[]) {
  const [entry] = await db.insert(journalEntries).values({
    orgId: ctx.orgId, runId, transactionId: null, kind, closingYear: year, contentHash: sha256(JSON.stringify({ kind, date, lines })),
    entryDate: date, referenceNr: 'pending', description: description.slice(0, 200), status: 'validated', validatedBy: ctx.userId, validatedAt: new Date(),
  }).returning({ id: journalEntries.id });
  const referenceNr = `C2B-${entry!.id.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
  await db.update(journalEntries).set({ referenceNr }).where(eq(journalEntries.id, entry!.id));
  await db.insert(journalLines).values(lines.map((ln, i) => ({
    orgId: ctx.orgId, entryId: entry!.id, position: i, debitKey: ln.debitKey, creditKey: ln.creditKey, amountChf: ln.amount, description: description.slice(0, 200),
  })));
  await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'entry.validated', entity: 'journal_entry', entityId: entry!.id, after: { kind, year } });
  return entry!.id;
}

/**
 * Reopens the last closed year. Its year-end entries are withdrawn (superseded) — only possible while they have not
 * been sent to bexio; once sent, they must first be deleted in bexio by the person responsible for the books.
 */
export async function reopenYear(ctx: Ctx, year: number): Promise<void> {
  assertCanValidate(ctx);
  const last = await lastClosedYear(ctx);
  if (last === null || last !== year) throw new AppError('conflict', 'only_last_closed_year_can_be_reopened');
  const entries = await ctx.db.select().from(journalEntries)
    .where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.closingYear, year), ne(journalEntries.status, 'superseded')));
  if (entries.some((e) => e.status === 'synced' || e.bexioManualEntryId !== null)) throw new AppError('conflict', 'closing_entries_already_in_bexio');
  await ctx.db.transaction(async (db) => {
    if (entries.length) await db.update(journalEntries).set({ status: 'superseded' }).where(inArray(journalEntries.id, entries.map((e) => e.id)));
    await db.update(fiscalClosings).set({ status: 'reopened', reopenedBy: ctx.userId, reopenedAt: new Date() })
      .where(and(eq(fiscalClosings.orgId, ctx.orgId), eq(fiscalClosings.year, year)));
    await audit(db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'year.reopened', entity: 'fiscal_closing', entityId: String(year),
      after: { withdrawnEntries: entries.length } });
  });
}

// ---------- Opening balances ----------

/** Number of transactions left out of the calculation because they are dated before the opening balances. */
export async function calculationIsExcluding(ctx: Ctx): Promise<number> {
  return applyOpeningCutoff(await loadTransactions(ctx)).excluded.length;
}

export interface OpeningBalanceInput {
  sourceId: string;
  asset: string;
  quantity: string;
  costChf: string;
}

export async function listOpeningBalances(ctx: Ctx) {
  const loaded = await loadTransactions(ctx);
  return loaded.filter((l) => l.tx.manualClassification === 'opening_balance').map((l) => {
    const m = l.movements.find((x) => x.direction === 'in');
    return {
      id: l.tx.id, sourceId: l.tx.sourceId, sourceLabel: l.sourceLabel, occurredAt: l.tx.occurredAt,
      asset: m?.asset ?? '', quantity: m ? normalizeNumeric(m.quantity) : '0', costChf: l.tx.sourceChfValue ? normalizeNumeric(l.tx.sourceChfValue) : null,
    };
  });
}

/**
 * Records balances carried forward from books kept before Crypto2Books, at 1 January of `year`: quantity and
 * acquisition cost per crypto asset and wallet. They create lots without any booking (the amount is already in the
 * opening balance sheet in bexio). Transactions dated before are then left out of the calculation.
 */
export async function addOpeningBalances(ctx: Ctx, year: number, rows: OpeningBalanceInput[]): Promise<{ added: number; duplicates: number; errors: string[] }> {
  assertCanWrite(ctx);
  if (!Number.isInteger(year) || year < 2010 || year > 2100) throw new AppError('invalid', 'invalid_year');
  const last = await lastClosedYear(ctx);
  if (last !== null && last >= year - 1) throw new AppError('conflict', 'period_closed');
  const at = openingBalanceInstant(year);
  const current = await listOpeningBalances(ctx);
  if (current.some((o) => o.occurredAt.getTime() !== at.getTime())) throw new AppError('conflict', 'opening_balances_other_year');

  const srcs = new Map((await ctx.db.select().from(sources).where(eq(sources.orgId, ctx.orgId))).map((s) => [s.id, s]));
  const errors: string[] = [];
  const bySource = new Map<string, { asset: string; quantity: string; cost: string; line: number }[]>();
  rows.forEach((r, i) => {
    const asset = r.asset.trim().toUpperCase();
    const qty = parseAmount(r.quantity);
    const cost = parseAmount(r.costChf);
    if (!srcs.has(r.sourceId)) { errors.push(`Ligne ${i + 1} : wallet ou exchange inconnu`); return; }
    if (!/^[A-Z0-9.\-_]{1,20}$/.test(asset) || isFiat(asset)) { errors.push(`Ligne ${i + 1} : actif crypto invalide (les avoirs fiat restent sur leurs comptes bexio)`); return; }
    if (!qty || !qty.isPositive()) { errors.push(`Ligne ${i + 1} : quantité positive obligatoire`); return; }
    if (!cost || cost.isNegative()) { errors.push(`Ligne ${i + 1} : coût d’acquisition CHF obligatoire (0 ou plus)`); return; }
    const list = bySource.get(r.sourceId) ?? [];
    list.push({ asset, quantity: qty.toString(), cost: cost.toString(), line: i + 1 });
    bySource.set(r.sourceId, list);
  });

  let added = 0;
  let duplicates = 0;
  for (const [sourceId, list] of bySource) {
    const content = Papa.unparse({ fields: ['asset', 'quantity', 'cost_chf'], data: list.map((l) => [l.asset, l.quantity, l.cost]) });
    const evidence = `# Soldes d'ouverture au 01.01.${year}, saisis le ${new Date().toISOString()} par ${ctx.userId}\n${content}`;
    const res = await persistBatch(ctx, sourceId, {
      parserId: 'opening_balance', parserVersion: 1, fileName: `soldes-ouverture-${year}.csv`, content: evidence, fileSha: sha256(evidence),
      parsed: {
        issues: [],
        transactions: list.map((l) => ({
          externalId: `opening:${year}:${l.asset}`, occurredAt: at, rawType: 'opening_balance',
          movements: [{ direction: 'in' as const, asset: l.asset, quantity: l.quantity }],
          raw: [{ asset: l.asset, quantity: l.quantity, cost_chf: l.cost }], rowNumbers: [l.line], sourceChfValue: l.cost,
          note: `Solde d’ouverture au 01.01.${year}`,
          hint: { classification: 'opening_balance' as const, confidence: 1, reason: 'Solde d’ouverture saisi' },
        })),
      },
    });
    added += res.imported;
    duplicates += res.duplicates;
  }
  // Mark them as confirmed opening balances (manual classification: never changed by automatic classification).
  await ctx.db.update(transactions).set({
    manualClassification: 'opening_balance', classification: 'opening_balance', reviewStatus: 'ok', confidence: '1.000', classificationOrigin: 'user',
    classificationReasons: ['Solde d’ouverture saisi'],
  }).where(and(eq(transactions.orgId, ctx.orgId), eq(transactions.rawType, 'opening_balance')));
  if (added > 0) await revalue(ctx);
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'opening_balances.added', entity: 'organization', entityId: ctx.orgId, after: { year, added, duplicates } });
  return { added, duplicates, errors };
}

/** CSV with columns source (wallet or exchange name, as in Crypto2Books), asset, quantity, cost_chf. */
export function parseOpeningCsv(csv: string, sourcesByLabel: Map<string, string>): { rows: OpeningBalanceInput[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const rows: OpeningBalanceInput[] = [];
  const errors: string[] = [];
  parsed.data.forEach((r, i) => {
    const sourceId = sourcesByLabel.get((r.source ?? '').trim().toLowerCase());
    if (!sourceId) { errors.push(`Ligne ${i + 2} : colonne « source » ne correspond à aucun wallet ou exchange`); return; }
    rows.push({ sourceId, asset: r.asset ?? '', quantity: r.quantity ?? '', costChf: r.cost_chf ?? '' });
  });
  return { rows, errors };
}

export async function deleteOpeningBalance(ctx: Ctx, txId: string): Promise<void> {
  assertCanWrite(ctx);
  const [tx] = await ctx.db.select().from(transactions).where(and(eq(transactions.orgId, ctx.orgId), eq(transactions.id, txId)));
  if (!tx || tx.manualClassification !== 'opening_balance') throw new AppError('not_found', 'transaction_not_found');
  const last = await lastClosedYear(ctx);
  if (last !== null && tx.occurredAt < yearEndExclusive(last)) throw new AppError('conflict', 'period_closed');
  await ctx.db.delete(transactions).where(eq(transactions.id, txId));
  await audit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.userId, action: 'opening_balance.deleted', entity: 'transaction', entityId: txId, before: { raw: tx.raw } });
}
