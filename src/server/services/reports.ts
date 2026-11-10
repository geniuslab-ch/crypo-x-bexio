import { and, desc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { resolveMapping } from '@/core/accounting/accountKeys';
import { runAccounting, type AccountingPolicy } from '@/core/accounting/engine';
import { D, ZERO } from '@/core/decimal';
import { INCOME_CLASSIFICATIONS, type Classification } from '@/core/types';
import { rateTableLookup, zurichDate } from '@/core/valuation/rateTable';
import type { Ctx } from '../context';
import { accountMappings, calculationRuns, disposals, priceRates } from '../db/schema';
import { listEntries } from './calculation';
import { effectiveClassification, loadTransactions, normalizeNumeric, toValuedMovement } from './transactions';

export interface Report {
  title: string;
  meta: [string, string][];
  columns: string[];
  rows: (string | number | null)[][];
}

export const REPORT_TYPES = ['transactions', 'realized', 'holdings', 'journal', 'income', 'fees'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const DISCLAIMER = 'Document de support comptable généré par Crypto2Books. Ne constitue pas un conseil fiscal; à valider par votre fiduciaire.';

function yearFilter(year: number | null) {
  return (d: Date) => year === null || zurichDate(d).startsWith(`${year}-`);
}

async function latestCompleteRun(ctx: Ctx) {
  const [r] = await ctx.db.select().from(calculationRuns)
    .where(and(eq(calculationRuns.orgId, ctx.orgId), eq(calculationRuns.status, 'complete')))
    .orderBy(desc(calculationRuns.createdAt)).limit(1);
  return r ?? null;
}

function baseMeta(ctx: Ctx, extra: [string, string][] = []): [string, string][] {
  return [['Généré le', new Date().toISOString()], ['Organisation', ctx.orgId], ...extra, ['Avertissement', DISCLAIMER]];
}

export async function buildReport(ctx: Ctx, type: ReportType, opts: { year: number | null; valuationDate?: string }): Promise<Report> {
  const inYear = yearFilter(opts.year);
  const yearLabel = opts.year === null ? 'toutes' : String(opts.year);

  if (type === 'transactions') {
    const loaded = await loadTransactions(ctx);
    const rows: Report['rows'] = [];
    for (const l of loaded.filter((x) => inYear(x.tx.occurredAt))) {
      for (const m of l.movements) {
        rows.push([
          l.tx.occurredAt.toISOString(), l.sourceLabel, l.tx.rawType, effectiveClassification(l.tx), l.tx.reviewStatus,
          m.direction, m.asset, normalizeNumeric(m.quantity), m.chfRate ? normalizeNumeric(m.chfRate) : null,
          m.chfValue ? new D(m.chfValue).toFixed(2) : null, m.rateSource, m.rateRef, m.derived ? 'oui' : 'non', l.tx.externalId, l.tx.txHash,
        ]);
      }
    }
    return {
      title: 'Historique des transactions et conversion CHF', meta: baseMeta(ctx, [['Année', yearLabel]]),
      columns: ['Date (UTC)', 'Source', 'Type source', 'Classification', 'Revue', 'Sens', 'Actif', 'Quantité', 'Cours CHF', 'Valeur CHF', 'Source du cours', 'Référence du cours', 'Dérivé', 'ID externe', 'Hash'],
      rows,
    };
  }

  if (type === 'realized') {
    const run = await latestCompleteRun(ctx);
    if (!run) return { title: 'Gains et pertes réalisés', meta: baseMeta(ctx, [['Statut', 'Aucun calcul complet disponible']]), columns: [], rows: [] };
    const rows = (await ctx.db.select().from(disposals).where(eq(disposals.runId, run.id)).orderBy(disposals.occurredAt))
      .filter((d) => inYear(d.occurredAt))
      .map((d) => [d.occurredAt.toISOString(), d.asset, d.kind === 'fee' ? 'frais' : 'cession', normalizeNumeric(d.quantity),
        new D(d.proceedsChf).toFixed(2), new D(d.costChf).toFixed(2), new D(d.gainChf).toFixed(2), d.transactionId]);
    const total = rows.reduce((a, r) => a.plus(String(r[6])), ZERO);
    rows.push(['TOTAL', '', '', '', '', '', total.toFixed(2), '']);
    const policy = run.policySnapshot as AccountingPolicy;
    return {
      title: 'Gains et pertes réalisés',
      meta: baseMeta(ctx, [['Année', yearLabel], ['Calcul', run.id], ['Méthode', policy.method.toUpperCase()], ['Frais de trading', policy.tradingFeeTreatment], ['Empreinte des données', run.inputHash]]),
      columns: ['Date (UTC)', 'Actif', 'Nature', 'Quantité', 'Produit CHF', 'Coût CHF', 'Résultat CHF', 'Transaction'],
      rows,
    };
  }

  if (type === 'holdings') {
    const valuationDate = opts.valuationDate ?? (opts.year ? `${opts.year}-12-31` : zurichDate(new Date()));
    const cutoff = new Date(`${valuationDate}T23:59:59+01:00`);
    const loaded = (await loadTransactions(ctx)).filter((l) => l.tx.occurredAt <= cutoff);
    const policyRow = (await latestCompleteRun(ctx))?.policySnapshot as AccountingPolicy | undefined;
    const policy: AccountingPolicy = policyRow ?? { method: 'fifo', tradingFeeTreatment: 'capitalize' };
    const engine = runAccounting(loaded.filter((l) => l.tx.reviewStatus === 'ok' || l.tx.manualClassification)
      .map((l) => ({ id: l.tx.id, occurredAt: l.tx.occurredAt, classification: effectiveClassification(l.tx) as Classification, movements: l.movements.map(toValuedMovement) })), policy);
    const rates = (await ctx.db.select().from(priceRates).where(eq(priceRates.orgId, ctx.orgId)))
      .map((r) => ({ asset: r.asset, rateDate: r.rateDate, rate: normalizeNumeric(r.rate), source: r.source, sourceUrl: r.sourceUrl }));
    const lookup = rateTableLookup(rates);
    const at = new Date(`${valuationDate}T12:00:00Z`);
    const rows: Report['rows'] = [];
    let totalCost = ZERO;
    let totalValue = ZERO;
    let missing = false;
    for (const [asset, h] of [...engine.holdings.entries()].sort()) {
      if (h.quantity.isZero()) continue;
      const q = lookup(asset, at);
      const value = q ? new D(q.rate).times(h.quantity) : null;
      totalCost = totalCost.plus(h.cost);
      if (value) totalValue = totalValue.plus(value);
      else missing = true;
      rows.push([asset, h.quantity.toString(), h.cost.toFixed(2), q ? q.rate : null, value ? value.toFixed(2) : null,
        value ? value.minus(h.cost).toFixed(2) : null, q?.ref ?? 'Cours manquant pour cette date']);
    }
    rows.push(['TOTAL', '', totalCost.toFixed(2), '', missing ? 'incomplet' : totalValue.toFixed(2), missing ? 'incomplet' : totalValue.minus(totalCost).toFixed(2), '']);
    return {
      title: 'Portefeuille, valorisation et plus/moins-values latentes',
      meta: baseMeta(ctx, [['Date de valorisation', valuationDate], ['Méthode', policy.method.toUpperCase()],
        ['Problèmes ouverts', engine.issues.length ? `${engine.issues.length} (résultats partiels)` : 'aucun'],
        ['Note', 'Valeur comptable vs valeur de marché. Les valeurs fiscales (Kursliste AFC) peuvent différer.']]),
      columns: ['Actif', 'Quantité', 'Coût CHF', 'Cours CHF', 'Valeur CHF', 'Latent CHF', 'Source du cours'],
      rows,
    };
  }

  if (type === 'journal') {
    const entries = (await listEntries(ctx)).filter((e) => e.status !== 'superseded' && (opts.year === null || e.entryDate.startsWith(`${opts.year}-`)));
    const mappingRows = await ctx.db.select().from(accountMappings).where(eq(accountMappings.orgId, ctx.orgId));
    const mappings = new Map(mappingRows.map((m) => [m.key, m.bexioAccountNo]));
    const rows: Report['rows'] = [];
    for (const e of entries) {
      for (const l of e.lines) {
        rows.push([e.entryDate, e.referenceNr, resolveMapping(l.debitKey, mappings) ?? `(${l.debitKey})`, resolveMapping(l.creditKey, mappings) ?? `(${l.creditKey})`,
          l.amountChf, l.description, e.status, e.bexioManualEntryId, l.debitKey, l.creditKey]);
      }
    }
    return {
      title: 'Journal comptable', meta: baseMeta(ctx, [['Année', yearLabel], ['Devise', 'CHF']]),
      columns: ['Date', 'Référence', 'Compte débit', 'Compte crédit', 'Montant CHF', 'Libellé', 'Statut', 'ID bexio', 'Clé débit', 'Clé crédit'],
      rows,
    };
  }

  const loaded = (await loadTransactions(ctx)).filter((l) => inYear(l.tx.occurredAt));
  if (type === 'income') {
    const rows: Report['rows'] = [];
    let total = ZERO;
    for (const l of loaded) {
      const cls = effectiveClassification(l.tx) as Classification;
      if (!INCOME_CLASSIFICATIONS.has(cls)) continue;
      for (const m of l.movements.filter((x) => x.direction === 'in')) {
        if (m.chfValue) total = total.plus(m.chfValue);
        rows.push([l.tx.occurredAt.toISOString(), l.sourceLabel, cls, m.asset, normalizeNumeric(m.quantity), m.chfValue ? new D(m.chfValue).toFixed(2) : 'cours manquant', m.rateRef]);
      }
    }
    rows.push(['TOTAL', '', '', '', '', total.toFixed(2), '']);
    return {
      title: 'Revenus crypto (staking, minage, airdrops, intérêts)', meta: baseMeta(ctx, [['Année', yearLabel]]),
      columns: ['Date (UTC)', 'Source', 'Nature', 'Actif', 'Quantité', 'Valeur CHF', 'Source du cours'], rows,
    };
  }
  // fees
  const rows: Report['rows'] = [];
  let total = ZERO;
  for (const l of loaded) {
    for (const m of l.movements.filter((x) => x.direction === 'fee')) {
      if (m.chfValue) total = total.plus(m.chfValue);
      rows.push([l.tx.occurredAt.toISOString(), l.sourceLabel, effectiveClassification(l.tx), m.asset, normalizeNumeric(m.quantity),
        m.chfValue ? new D(m.chfValue).toFixed(2) : 'cours manquant', m.derived ? 'écart de transfert' : 'source']);
    }
  }
  rows.push(['TOTAL', '', '', '', '', total.toFixed(2), '']);
  return {
    title: 'Frais (trading et réseau)', meta: baseMeta(ctx, [['Année', yearLabel]]),
    columns: ['Date (UTC)', 'Source', 'Transaction', 'Actif', 'Quantité', 'Valeur CHF', 'Origine'], rows,
  };
}

/**
 * Neutralises spreadsheet formula injection: text cells starting with = + - @ (or tab/CR) are prefixed with a quote.
 * Plain numbers such as "-12.50" are left untouched.
 */
export function safeCell(v: string | number | null): string | number | null {
  if (typeof v !== 'string') return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function reportToCsv(r: Report): string {
  const meta = r.meta.map(([k, v]) => [`# ${k}`, safeCell(v)]);
  const rows = r.rows.map((row) => row.map(safeCell));
  return '\uFEFF' + Papa.unparse([[`# ${r.title}`], ...meta, [], r.columns, ...rows], { delimiter: ';' });
}

export async function reportToXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crypto2Books';
  const ws = wb.addWorksheet('Rapport');
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  for (const [k, v] of r.meta) ws.addRow([k, v]);
  ws.addRow([]);
  const header = ws.addRow(r.columns);
  header.font = { bold: true };
  for (const row of r.rows) ws.addRow(row.map((c) => (typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c) && c.length < 16 ? Number(c) : c)));
  ws.columns.forEach((c) => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
