import { and, desc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { resolveMapping } from '@/core/accounting/accountKeys';
import { runAccounting, type AccountingPolicy } from '@/core/accounting/engine';
import { D, ZERO, type Dec } from '@/core/decimal';
import { taxNotes, type LegalForm } from '@/core/legalForms';
import { DONATION_CLASSIFICATIONS, INCOME_CLASSIFICATIONS, type Classification } from '@/core/types';
import { rateTableLookup, zurichDate } from '@/core/valuation/rateTable';
import type { Ctx } from '../context';
import { accountMappings, calculationRuns, disposals, fiscalClosings, priceRates, taxValues } from '../db/schema';
import { listEntries } from './calculation';
import { reconcile } from './reconciliation';
import { getOrgProfile } from './organization';
import { effectiveClassification, loadTransactions, normalizeNumeric, toEngineInput, toValuedMovement, walletAccountSources } from './transactions';

export interface Report {
  title: string;
  meta: [string, string][];
  columns: string[];
  rows: (string | number | null)[][];
}

export const REPORT_TYPES = ['transactions', 'realized', 'holdings', 'wealth', 'closing', 'reconciliation', 'journal', 'income', 'donations', 'fees'] as const;
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

const LEGAL_FORM_LABELS: Record<LegalForm | 'company', string> = {
  sa: 'Société anonyme (SA)', sarl: 'Société à responsabilité limitée (Sàrl)', company: 'Société (SA ou Sàrl)', foundation: 'Fondation',
  sole_trader: 'Indépendant·e', private: 'Investisseur privé',
};
const TAX_STATUS_LABELS = { ordinary: 'imposée normalement', exempt: 'exonérée (utilité publique)', partial: 'partiellement exonérée' } as const;

/** Legal form and the tax notes that apply to it, printed in the reports that feed a tax computation. */
async function legalMeta(ctx: Ctx): Promise<[string, string][]> {
  const org = await getOrgProfile(ctx);
  const form = LEGAL_FORM_LABELS[org.legalForm] + (org.kind === 'company' || org.kind === 'foundation' ? `, ${TAX_STATUS_LABELS[org.taxStatus]}` : '');
  return [['Forme juridique', form], ...taxNotes(org.kind, org.taxStatus).map((n): [string, string] => [n.label, n.text])];
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
      meta: baseMeta(ctx, [['Année', yearLabel], ['Calcul', run.id], ['Méthode', policy.method.toUpperCase()], ['Frais de trading', policy.tradingFeeTreatment], ['Empreinte des données', run.inputHash], ...(await legalMeta(ctx))]),
      columns: ['Date (UTC)', 'Actif', 'Nature', 'Quantité', 'Produit CHF', 'Coût CHF', 'Résultat CHF', 'Transaction'],
      rows,
    };
  }

  if (type === 'wealth') {
    // Statement of securities (état des titres): holdings at 31.12 at the official tax value when entered.
    const year = opts.year ?? new Date().getFullYear() - 1;
    const holdings = await buildReport(ctx, 'holdings', { year, valuationDate: `${year}-12-31` });
    const official = new Map((await ctx.db.select().from(taxValues).where(and(eq(taxValues.orgId, ctx.orgId), eq(taxValues.taxYear, year))))
      .map((v) => [v.asset, v]));
    const rows: Report['rows'] = [];
    let total = ZERO;
    let missing = 0;
    let unofficial = 0;
    for (const r of holdings.rows) {
      const [asset, quantity, , marketRate] = r as [string, string, string, string | null];
      if (asset === 'TOTAL') continue;
      const tv = official.get(asset);
      const rate = tv ? normalizeNumeric(tv.valueChf) : marketRate;
      const value = rate ? new D(rate).times(quantity) : null;
      if (value) total = total.plus(value); else missing++;
      if (!tv && rate) unofficial++;
      rows.push([asset, quantity, rate, value ? value.toFixed(2) : null,
        tv ? `Valeur fiscale : ${tv.source}` : rate ? 'Cours de marché, NON officiel : saisissez la valeur de la Kursliste AFC' : 'Aucune valeur',
        tv?.sourceUrl ?? null]);
    }
    rows.push(['TOTAL', '', '', missing ? 'incomplet' : total.toFixed(2), unofficial ? `${unofficial} valeur(s) non officielle(s)` : '', '']);
    return {
      title: `État des titres crypto au 31.12.${year} (aide à la déclaration)`,
      meta: baseMeta(ctx, [['Année fiscale', String(year)],
        ['Valeurs fiscales officielles', `${official.size} saisie(s)`], ...(await legalMeta(ctx)),
        ['Note', 'Valeurs fiscales au 31.12 selon la Kursliste de l’AFC (ictax.admin.ch) lorsqu’elles sont saisies ; sinon cours de marché à remplacer. Les revenus de staking de l’année figurent dans le rapport « Staking et autres revenus ». Ce document aide à remplir la déclaration ; il ne la remplace pas.']]),
      columns: ['Actif', 'Quantité au 31.12', 'Valeur unitaire CHF', 'Valeur fiscale CHF', 'Source de la valeur', 'Référence'],
      rows,
    };
  }

  if (type === 'holdings') {
    const valuationDate = opts.valuationDate ?? (opts.year ? `${opts.year}-12-31` : zurichDate(new Date()));
    const cutoff = new Date(`${valuationDate}T23:59:59.999+01:00`);
    const loaded = (await loadTransactions(ctx)).filter((l) => l.tx.occurredAt <= cutoff);
    const policyRow = (await latestCompleteRun(ctx))?.policySnapshot as AccountingPolicy | undefined;
    const policy: AccountingPolicy = policyRow ?? { method: 'fifo', tradingFeeTreatment: 'capitalize' };
    const engine = runAccounting(toEngineInput(loaded.filter((l) => l.tx.reviewStatus === 'ok' || l.tx.manualClassification), await walletAccountSources(ctx)), policy);
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

  if (type === 'reconciliation') {
    const date = opts.valuationDate ?? `${opts.year ?? new Date().getFullYear() - 1}-12-31`;
    const rows = await reconcile(ctx, date);
    const label = { ok: 'concorde', gap: 'ÉCART', not_reported: 'solde de la plateforme non saisi' } as const;
    return {
      title: `Rapprochement des soldes au ${date}`,
      meta: baseMeta(ctx, [['Date', date], ['Écarts', String(rows.filter((r) => r.status === 'gap').length)],
        ['Soldes non saisis', String(rows.filter((r) => r.status === 'not_reported').length)],
        ['Méthode', 'Solde calculé = entrées − sorties − frais importés jusqu’à la fin de la journée (heure suisse), après les soldes d’ouverture ; tolérance 0.00000001']]),
      columns: ['Source', 'Actif', 'Solde calculé', 'Solde de la plateforme', 'Écart', 'Statut', 'Justificatif'],
      rows: rows.map((r) => [r.sourceLabel, r.asset, r.computed, r.reported, r.difference, label[r.status], r.evidence]),
    };
  }

  if (type === 'closing') {
    // Year-end valuation table stored when the year was closed (evidence for the audit file).
    const year = opts.year ?? new Date().getFullYear() - 1;
    const [c] = await ctx.db.select().from(fiscalClosings).where(and(eq(fiscalClosings.orgId, ctx.orgId), eq(fiscalClosings.year, year)));
    const title = `Évaluation de clôture des actifs numériques au 31.12.${year}`;
    if (!c || c.status !== 'closed') return { title, meta: baseMeta(ctx, [['Exercice', String(year)], ['Statut', 'Exercice non clôturé']]), columns: [], rows: [] };
    const snap = c.snapshot as { key: string; asset: string; quantity: string; bookValue: string; rate: string | null; rateSource: string | null; marketValue: string | null; adjustment: string }[];
    const mappingRows = await ctx.db.select().from(accountMappings).where(eq(accountMappings.orgId, ctx.orgId));
    const mappings = new Map(mappingRows.map((m) => [m.key, m.bexioAccountNo]));
    let book = ZERO; let market = ZERO; let adj = ZERO;
    const rows: Report['rows'] = snap.map((r) => {
      book = book.plus(r.bookValue); market = market.plus(r.marketValue ?? '0'); adj = adj.plus(r.adjustment);
      return [r.asset, resolveMapping(r.key, mappings) ?? `(${r.key})`, r.quantity, r.bookValue, r.rate, r.marketValue, r.adjustment,
        new D(r.bookValue).plus(r.adjustment).toFixed(2), r.rateSource];
    });
    rows.push(['TOTAL', '', '', book.toFixed(2), '', market.toFixed(2), adj.toFixed(2), book.plus(adj).toFixed(2), '']);
    return {
      title,
      meta: baseMeta(ctx, [['Exercice', String(year)], ['Clôturé le', c.closedAt.toISOString()],
        ['Méthode', c.valuationMethod === 'market' ? 'Valeur de marché (CO art. 960b, cours observable sur un marché actif)' : 'Principe de la valeur la plus basse (CO art. 960 al. 2) : dépréciation seulement'],
        ['Valeur unitaire', c.rateBasis === 'tax_value' ? 'Valeur fiscale officielle (Kursliste AFC)' : 'Cours de marché documenté au 31.12'],
        ['Écritures', 'Évaluation datée du 31.12, extournée le 1.1 suivant (le coût d’acquisition reste la base des résultats réalisés)'],
        ...(await legalMeta(ctx))]),
      columns: ['Actif', 'Compte bexio', 'Quantité au 31.12', 'Valeur comptable CHF', 'Valeur unitaire CHF', 'Valeur de marché CHF', 'Correction CHF', 'Valeur au bilan CHF', 'Source de la valeur'],
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
      title: 'Journal comptable', meta: baseMeta(ctx, [['Année', yearLabel], ['Devise', 'CHF'],
        ...(((await latestCompleteRun(ctx))?.roundingLedger as { key: string; carriedChf: string }[] | null) ?? [])
          .filter((r) => r.carriedChf !== '0')
          .map((r): [string, string] => [`Report d’arrondi en attente : ${r.key}`, `${r.carriedChf} CHF`])]),
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
  if (type === 'donations') {
    // Gifts received and given. Endowments to a foundation's assets are listed apart: they are not taxable profit
    // (LIFD art. 66 al. 1) and are booked to the foundation's capital, not to income.
    const rows: Report['rows'] = [];
    const totals = new Map<string, Dec>();
    for (const l of loaded) {
      const cls = effectiveClassification(l.tx) as Classification;
      if (!DONATION_CLASSIFICATIONS.has(cls)) continue;
      const side = cls === 'grant_paid' ? 'out' : 'in';
      for (const m of l.movements.filter((x) => x.direction === side)) {
        if (m.chfValue) totals.set(cls, (totals.get(cls) ?? ZERO).plus(m.chfValue));
        rows.push([l.tx.occurredAt.toISOString(), l.sourceLabel, cls, side === 'in' ? 'reçu' : 'versé', m.asset, normalizeNumeric(m.quantity),
          m.chfValue ? new D(m.chfValue).toFixed(2) : 'cours manquant', m.rateRef, l.tx.txHash]);
      }
    }
    for (const c of DONATION_CLASSIFICATIONS) rows.push([`TOTAL ${c}`, '', '', '', '', '', (totals.get(c) ?? ZERO).toFixed(2), '', '']);
    return {
      title: 'Dons, dotations et subventions versées', meta: baseMeta(ctx, [['Année', yearLabel],
        ['Valorisation', 'Valeur de marché en CHF du jour de la transaction. Les dons versés en crypto sont des cessions : leur gain ou perte figure dans le rapport « Gains et pertes réalisés ».'],
        ...(await legalMeta(ctx))]),
      columns: ['Date (UTC)', 'Source', 'Nature', 'Sens', 'Actif', 'Quantité', 'Valeur CHF', 'Source du cours', 'Hash'], rows,
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
