import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { Ctx } from '../context';
import { accountingPolicies, auditLog, fiscalClosings, importBatches, organizations, sources } from '../db/schema';
import { PdfWriter } from '../pdf/writer';
import { getOrgProfile } from './organization';
import { buildReport, type Report } from './reports';

/**
 * Revision file ("dossier de révision") for one calendar year, as a single PDF a fiduciary or an auditor can file:
 * cover, methods, 31.12 valuation, reconciliation, results, journal, sources with file fingerprints and an excerpt of
 * the audit trail. Every section is built from the same reports as the Excel exports, so the figures match.
 */
const MAX_AUDIT_ROWS = 1000;

const LEGAL_FORMS: Record<string, string> = { sa: 'Société anonyme (SA)', sarl: 'Sàrl', company: 'Société', foundation: 'Fondation', sole_trader: 'Indépendant·e', private: 'Investisseur privé' };
const TAX_STATUS: Record<string, string> = { ordinary: 'imposée normalement', exempt: 'exonérée (utilité publique)', partial: 'partiellement exonérée' };
const COST_METHODS: Record<string, string> = { fifo: 'FIFO (premier entré, premier sorti)', wac: 'Coût moyen pondéré' };
const FEE_TREATMENT: Record<string, string> = { capitalize: 'Frais de transaction inclus dans le coût d’acquisition / déduits du produit', expense: 'Frais de transaction comptabilisés en charges' };

export async function buildAuditFile(ctx: Ctx, year: number): Promise<Uint8Array> {
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  const profile = await getOrgProfile(ctx);
  const [policy] = await ctx.db.select().from(accountingPolicies).where(eq(accountingPolicies.orgId, ctx.orgId));
  const [closing] = await ctx.db.select().from(fiscalClosings).where(and(eq(fiscalClosings.orgId, ctx.orgId), eq(fiscalClosings.year, year)));
  const closed = closing?.status === 'closed';

  const pdf = await new PdfWriter(`Crypto2Books · Dossier de révision ${year} · ${org?.name ?? ''}`).init();

  // 1. Cover
  pdf.title('Dossier de révision des actifs numériques', 24);
  pdf.paragraph(`Exercice ${year} (01.01.${year} au 31.12.${year})`, 13);
  pdf.keyValues([
    ['Organisation', org?.name ?? ''],
    ['Forme juridique', (LEGAL_FORMS[profile.legalForm] ?? profile.legalForm) + (profile.kind === 'company' || profile.kind === 'foundation' ? `, ${TAX_STATUS[profile.taxStatus] ?? profile.taxStatus}` : '')],
    ['Canton', org?.canton ?? 'non renseigné'],
    ['Monnaie de base', org?.baseCurrency ?? 'CHF'],
    ['Statut de l’exercice', closed ? `Clôturé le ${closing.closedAt.toISOString().slice(0, 10)}` : 'Exercice non clôturé : les chiffres peuvent encore changer'],
    ['Généré le', new Date().toISOString()],
  ]);
  pdf.heading('Contenu');
  pdf.paragraph('1. Méthodes comptables · 2. Évaluation au 31.12 · 3. Rapprochement des soldes · 4. Résultats réalisés · 5. Revenus · 6. Frais · 7. Journal comptable · 8. Sources et fichiers importés · 9. Piste d’audit');
  pdf.paragraph('Document de support comptable généré par Crypto2Books. Il ne constitue pas un conseil fiscal; les chiffres sont à valider par la fiduciaire. Les fichiers sources sont conservés avec leur empreinte SHA-256 (CO art. 958f).', 8);

  // 2. Methods
  pdf.newPage();
  pdf.heading('1. Méthodes comptables');
  pdf.keyValues([
    ['Méthode de coût', COST_METHODS[policy?.costBasisMethod ?? 'fifo'] ?? policy?.costBasisMethod ?? 'FIFO'],
    ['Frais de transaction', FEE_TREATMENT[policy?.tradingFeeTreatment ?? 'capitalize'] ?? policy?.tradingFeeTreatment ?? ''],
    ['Transferts internes', `Appariés dans une fenêtre de ${policy?.transferWindowHours ?? 48} h, tolérance ${policy?.transferTolerance ?? '0.01'}`],
    ['Revue par la fiduciaire', policy?.reviewedByFiduciaryAt ? policy.reviewedByFiduciaryAt.toISOString().slice(0, 10) : 'non revue'],
    ['Évaluation au 31.12', closed
      ? (closing.valuationMethod === 'market' ? 'Valeur de marché (CO art. 960b)' : 'Principe de la valeur la plus basse (CO art. 960 al. 2)')
      : 'Exercice non clôturé'],
    ['Base de la valeur unitaire', closed ? (closing.rateBasis === 'tax_value' ? 'Valeur fiscale officielle (Kursliste AFC)' : 'Cours de marché documenté au 31.12') : '-'],
    ['DeFi (pools, prêts, staking liquide)', 'Échange à la valeur de marché : actifs remis cédés à la valeur de ce qui est reçu; jeton reçu (LP, aToken, stETH) acquis à cette valeur. Opérations confirmées une à une.'],
    ['Conversion', 'Tous les montants en CHF au cours du jour de la transaction, source du cours indiquée par ligne'],
  ]);

  // 3+. Sections from the reports
  const section = async (title: string, type: Parameters<typeof buildReport>[1], opts: { drop?: string[]; note?: string } = {}) => {
    const r = await buildReport(ctx, type, { year, valuationDate: type === 'reconciliation' || type === 'holdings' ? `${year}-12-31` : undefined });
    printReport(pdf, title, r, opts);
  };
  if (closed) await section('2. Évaluation de clôture au 31.12', 'closing');
  else await section('2. Portefeuille au 31.12 (exercice non clôturé)', 'holdings');
  await section('3. Rapprochement des soldes au 31.12', 'reconciliation');
  await section('4. Plus et moins-values réalisées', 'realized');
  await section('5. Revenus (staking, intérêts, airdrops...)', 'income');
  await section('6. Frais', 'fees');
  await section('7. Journal comptable', 'journal', { drop: ['Clé débit', 'Clé crédit'] });

  // 8. Sources and imported files
  pdf.newPage();
  pdf.heading('8. Sources et fichiers importés');
  const src = await ctx.db.select().from(sources).where(eq(sources.orgId, ctx.orgId)).orderBy(asc(sources.label));
  pdf.table({
    columns: ['Source', 'Fournisseur', 'Type', 'Connexion', 'Dernière synchro'],
    rows: src.map((s) => [s.label, s.provider, s.kind, s.connectionType, s.lastSyncedAt?.toISOString().slice(0, 16) ?? '']),
  });
  const batches = await ctx.db.select({
    createdAt: importBatches.createdAt, fileName: importBatches.fileName, sha: importBatches.fileSha256, rows: importBatches.rowCount,
    imported: importBatches.importedCount, dup: importBatches.duplicateCount, parser: importBatches.parserId, version: importBatches.parserVersion, source: sources.label,
  }).from(importBatches).innerJoin(sources, eq(sources.id, importBatches.sourceId))
    .where(eq(importBatches.orgId, ctx.orgId)).orderBy(asc(importBatches.createdAt));
  pdf.table({
    columns: ['Importé le', 'Source', 'Fichier', 'SHA-256', 'Lignes', 'Importées', 'Doublons', 'Lecteur'],
    widths: [12, 12, 22, 44, 6, 7, 7, 12],
    numeric: [4, 5, 6],
    rows: batches.map((b) => [b.createdAt.toISOString().slice(0, 16), b.source, b.fileName, b.sha, b.rows, b.imported, b.dup, `${b.parser} v${b.version}`]),
  }, 6);

  // 9. Audit trail of the year
  pdf.heading('9. Piste d’audit');
  const log = await ctx.db.select().from(auditLog)
    .where(and(eq(auditLog.orgId, ctx.orgId), gte(auditLog.createdAt, new Date(Date.UTC(year, 0, 1, -1))), lt(auditLog.createdAt, new Date(Date.UTC(year + 1, 11, 31, 23)))))
    .orderBy(asc(auditLog.createdAt)).limit(MAX_AUDIT_ROWS + 1);
  pdf.paragraph(`Actions enregistrées pendant l’exercice ${year} et l’année suivante (préparation de la clôture)${log.length > MAX_AUDIT_ROWS ? `, limitées aux ${MAX_AUDIT_ROWS} premières; l’export complet reste disponible sur demande` : ''}.`, 8);
  pdf.table({
    columns: ['Date', 'Action', 'Objet', 'Identifiant', 'Utilisateur'],
    widths: [14, 22, 14, 30, 30],
    rows: log.slice(0, MAX_AUDIT_ROWS).map((a) => [a.createdAt.toISOString().slice(0, 19).replace('T', ' '), a.action, a.entity, a.entityId, a.actorUserId]),
  }, 6);

  return pdf.finish();
}

function printReport(pdf: PdfWriter, title: string, r: Report, opts: { drop?: string[] }) {
  pdf.newPage();
  pdf.heading(title);
  const meta = r.meta.filter(([k]) => k !== 'Organisation' && k !== 'Généré le' && k !== 'Avertissement');
  if (meta.length) pdf.keyValues(meta, 8);
  const keep = r.columns.map((c, i) => (opts.drop?.includes(c) ? -1 : i)).filter((i) => i >= 0);
  const numeric = keep.map((col, i) => (r.rows.some((row) => typeof row[col] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[col] ?? ''))) ? i : -1)).filter((i) => i >= 0);
  pdf.table({ columns: keep.map((i) => r.columns[i]!), rows: r.rows.map((row) => keep.map((i) => row[i] ?? null)), numeric });
}
