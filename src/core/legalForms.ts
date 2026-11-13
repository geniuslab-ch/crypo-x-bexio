/**
 * Legal forms of a client file and what changes between them for crypto bookkeeping.
 *
 * Accounting (acquisition, sale, valuation, realised result) is the same for SA, Sàrl and foundations:
 * companies keep books under CO art. 957 ff., foundations apply the same provisions by analogy (CC art. 83a).
 * What differs is (a) a few events specific to foundations (endowment to the foundation's assets, grants paid
 * for its purpose) and (b) the direct tax treatment, which depends on the foundation's tax status. The engine
 * stays pure: the legal form only decides which classifications are offered and which notes go into reports.
 */
import type { Classification } from './types';

export const ORG_KINDS = ['company', 'foundation', 'sole_trader', 'private'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** Precise legal form offered in the forms. SA and Sàrl are both stored as kind "company". */
export const LEGAL_FORMS = ['sa', 'sarl', 'foundation', 'sole_trader', 'private'] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

/** Direct tax status of a legal entity (LIFD art. 56 let. g / LHID art. 23 al. 1 let. f). Decided by the canton. */
export const TAX_STATUSES = ['ordinary', 'exempt', 'partial'] as const;
export type TaxStatus = (typeof TAX_STATUSES)[number];

export function kindOfLegalForm(form: LegalForm): OrgKind {
  return form === 'sa' || form === 'sarl' ? 'company' : form;
}

export function isLegalForm(v: unknown): v is LegalForm {
  return typeof v === 'string' && (LEGAL_FORMS as readonly string[]).includes(v);
}

export function isTaxStatus(v: unknown): v is TaxStatus {
  return typeof v === 'string' && (TAX_STATUSES as readonly string[]).includes(v);
}

/** Legal form shown for a stored organisation. Older company files have no precise form (SA or Sàrl). */
export function legalFormOf(kind: OrgKind, legalForm: string | null): LegalForm | 'company' {
  if (kind === 'company') return legalForm === 'sa' || legalForm === 'sarl' ? legalForm : 'company';
  return kind;
}

/** Endowments to the foundation's assets only exist for foundations. */
const FOUNDATION_ONLY = new Set<Classification>(['endowment_received']);

export function classificationAllowed(kind: OrgKind, c: Classification): boolean {
  return kind === 'foundation' || !FOUNDATION_ONLY.has(c);
}

/** Whether the tax status setting applies (legal entities only). */
export function hasTaxStatus(kind: OrgKind): boolean {
  return kind === 'company' || kind === 'foundation';
}

export interface TaxNote {
  label: string;
  text: string;
}

/**
 * Notes printed in the reports so the fiduciary sees which tax rules the figures feed into.
 * Sources: LIFD art. 56 let. g, 58, 66 al. 1, 68, 71; LHID art. 23 al. 1 let. f, 26 al. 1, 29 al. 2;
 * ESTV, « Imposition des personnes morales » (état au 1.1.2026). Not tax advice.
 */
export function taxNotes(kind: OrgKind, status: TaxStatus): TaxNote[] {
  if (kind === 'company') {
    const notes: TaxNote[] = [
      { label: 'Impôt sur le bénéfice', text: 'SA et Sàrl : les gains et pertes réalisés sur crypto font partie du bénéfice imposable (LIFD art. 58). IFD 8,5 % du bénéfice net (LIFD art. 68), plus l’impôt cantonal.' },
      { label: 'Impôt sur le capital', text: 'Cantonal uniquement, sur les fonds propres comptables (LHID art. 29 al. 2 let. a). Les cryptos y entrent à leur valeur comptable, pas à la valeur de la Kursliste.' },
    ];
    if (status !== 'ordinary') notes.push(exemptionNote(status));
    return notes;
  }
  if (kind === 'foundation') {
    if (status === 'exempt') {
      return [
        exemptionNote(status),
        { label: 'Comptabilité', text: 'L’exonération ne dispense pas de tenir les livres (CC art. 83a) : achats, ventes et résultats réalisés sont comptabilisés comme pour une société.' },
      ];
    }
    const notes: TaxNote[] = [
      { label: 'Impôt sur le bénéfice', text: 'Fondation imposée : IFD 4,25 % du bénéfice net ; un bénéfice inférieur à CHF 5 000 n’est pas imposé (LIFD art. 71). Les gains réalisés sur crypto font partie du bénéfice.' },
      { label: 'Apports à la fortune', text: 'Les dotations (apports à la fortune de la fondation) ne font pas partie du bénéfice imposable (LIFD art. 66 al. 1, LHID art. 26 al. 1) : classez-les « Dotation à la fondation », pas « Don reçu ».' },
      { label: 'Impôt sur le capital', text: 'Pas d’impôt fédéral. Impôt cantonal sur la fortune nette déterminée selon les règles applicables aux personnes physiques (LHID art. 29 al. 2 let. c) : les cryptos y sont en principe estimées à la valeur fiscale de la Kursliste AFC au 31.12 (rapport « État des titres »).' },
    ];
    if (status === 'partial') notes.unshift(exemptionNote(status));
    return notes;
  }
  return [];
}

function exemptionNote(status: TaxStatus): TaxNote {
  return status === 'exempt'
    ? { label: 'Statut fiscal', text: 'Exonérée pour but d’utilité publique ou de service public : pas d’impôt sur le bénéfice ni sur le capital pour la part affectée exclusivement et irrévocablement à ce but (LIFD art. 56 let. g, LHID art. 23 al. 1 let. f). Vérifiez l’étendue de la décision cantonale.' }
    : { label: 'Statut fiscal', text: 'Exonération partielle : seule la part du bénéfice et du capital affectée au but d’utilité publique est exonérée (LIFD art. 56 let. g). La répartition relève de la décision cantonale ; les montants ci-dessous ne la font pas.' };
}
