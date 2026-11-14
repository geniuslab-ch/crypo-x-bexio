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

type NoteId = 'company_profit' | 'company_capital' | 'foundation_books' | 'foundation_profit' | 'foundation_endowments' | 'foundation_capital' | 'exempt' | 'partial';

/** Note texts per language (fr, de, it, en). Legal references: LIFD = DBG, LHID = StHG/LAID, CC = ZGB. */
const NOTE_TEXT: Record<string, Record<NoteId, TaxNote>> = {
  fr: {
    company_profit: { label: 'Impôt sur le bénéfice', text: 'SA et Sàrl : les gains et pertes réalisés sur crypto font partie du bénéfice imposable (LIFD art. 58). IFD 8,5 % du bénéfice net (LIFD art. 68), plus l’impôt cantonal.' },
    company_capital: { label: 'Impôt sur le capital', text: 'Cantonal uniquement, sur les fonds propres comptables (LHID art. 29 al. 2 let. a). Les cryptos y entrent à leur valeur comptable, pas à la valeur de la Kursliste.' },
    foundation_books: { label: 'Comptabilité', text: 'L’exonération ne dispense pas de tenir les livres (CC art. 83a) : achats, ventes et résultats réalisés sont comptabilisés comme pour une société.' },
    foundation_profit: { label: 'Impôt sur le bénéfice', text: 'Fondation imposée : IFD 4,25 % du bénéfice net ; un bénéfice inférieur à CHF 5 000 n’est pas imposé (LIFD art. 71). Les gains réalisés sur crypto font partie du bénéfice.' },
    foundation_endowments: { label: 'Apports à la fortune', text: 'Les dotations (apports à la fortune de la fondation) ne font pas partie du bénéfice imposable (LIFD art. 66 al. 1, LHID art. 26 al. 1) : classez-les « Dotation à la fondation », pas « Don reçu ».' },
    foundation_capital: { label: 'Impôt sur le capital', text: 'Pas d’impôt fédéral. Impôt cantonal sur la fortune nette déterminée selon les règles applicables aux personnes physiques (LHID art. 29 al. 2 let. c) : les cryptos y sont en principe estimées à la valeur fiscale de la Kursliste AFC au 31.12 (rapport « État des titres »).' },
    exempt: { label: 'Statut fiscal', text: 'Exonérée pour but d’utilité publique ou de service public : pas d’impôt sur le bénéfice ni sur le capital pour la part affectée exclusivement et irrévocablement à ce but (LIFD art. 56 let. g, LHID art. 23 al. 1 let. f). Vérifiez l’étendue de la décision cantonale.' },
    partial: { label: 'Statut fiscal', text: 'Exonération partielle : seule la part du bénéfice et du capital affectée au but d’utilité publique est exonérée (LIFD art. 56 let. g). La répartition relève de la décision cantonale ; les montants ci-dessous ne la font pas.' },
  },
  de: {
    company_profit: { label: 'Gewinnsteuer', text: 'AG und GmbH: Realisierte Gewinne und Verluste auf Krypto gehören zum steuerbaren Gewinn (DBG Art. 58). Direkte Bundessteuer 8,5 % des Reingewinns (DBG Art. 68), zuzüglich Kantonssteuer.' },
    company_capital: { label: 'Kapitalsteuer', text: 'Nur kantonal, auf dem buchmässigen Eigenkapital (StHG Art. 29 Abs. 2 Bst. a). Kryptos zählen dort zum Buchwert, nicht zum Wert der Kursliste.' },
    foundation_books: { label: 'Buchführung', text: 'Die Steuerbefreiung entbindet nicht von der Buchführung (ZGB Art. 83a): Käufe, Verkäufe und realisierte Ergebnisse werden wie bei einer Gesellschaft verbucht.' },
    foundation_profit: { label: 'Gewinnsteuer', text: 'Steuerpflichtige Stiftung: direkte Bundessteuer 4,25 % des Reingewinns; ein Gewinn unter CHF 5 000 wird nicht besteuert (DBG Art. 71). Realisierte Krypto-Gewinne gehören zum Gewinn.' },
    foundation_endowments: { label: 'Zuwendungen an das Vermögen', text: 'Zustiftungen (Zuwendungen an das Stiftungsvermögen) gehören nicht zum steuerbaren Gewinn (DBG Art. 66 Abs. 1, StHG Art. 26 Abs. 1): Klassieren Sie sie als «Zustiftung», nicht als «Erhaltene Spende».' },
    foundation_capital: { label: 'Kapitalsteuer', text: 'Keine Bundessteuer. Kantonale Steuer auf dem Reinvermögen nach den Regeln für natürliche Personen (StHG Art. 29 Abs. 2 Bst. c): Kryptos werden grundsätzlich zum Steuerwert der ESTV-Kursliste per 31.12. bewertet (Bericht «Wertschriftenverzeichnis»).' },
    exempt: { label: 'Steuerstatus', text: 'Steuerbefreit wegen gemeinnütziger oder öffentlicher Zwecke: keine Gewinn- und Kapitalsteuer für den Teil, der ausschliesslich und unwiderruflich diesem Zweck gewidmet ist (DBG Art. 56 Bst. g, StHG Art. 23 Abs. 1 Bst. f). Prüfen Sie den Umfang der kantonalen Verfügung.' },
    partial: { label: 'Steuerstatus', text: 'Teilweise Steuerbefreiung: Nur der dem gemeinnützigen Zweck gewidmete Teil von Gewinn und Kapital ist befreit (DBG Art. 56 Bst. g). Die Aufteilung folgt der kantonalen Verfügung; die Beträge unten nehmen sie nicht vor.' },
  },
  it: {
    company_profit: { label: 'Imposta sull’utile', text: 'SA e Sagl: utili e perdite realizzati su cripto fanno parte dell’utile imponibile (LIFD art. 58). IFD 8,5 % dell’utile netto (LIFD art. 68), più l’imposta cantonale.' },
    company_capital: { label: 'Imposta sul capitale', text: 'Solo cantonale, sul capitale proprio contabile (LAID art. 29 cpv. 2 lett. a). Le cripto vi rientrano al valore contabile, non al valore del listino dei corsi.' },
    foundation_books: { label: 'Contabilità', text: 'L’esenzione non dispensa dal tenere i libri (CC art. 83a): acquisti, vendite e risultati realizzati sono contabilizzati come per una società.' },
    foundation_profit: { label: 'Imposta sull’utile', text: 'Fondazione imposta: IFD 4,25 % dell’utile netto; un utile inferiore a CHF 5 000 non è imposto (LIFD art. 71). Gli utili realizzati su cripto fanno parte dell’utile.' },
    foundation_endowments: { label: 'Apporti al patrimonio', text: 'Le dotazioni (apporti al patrimonio della fondazione) non fanno parte dell’utile imponibile (LIFD art. 66 cpv. 1, LAID art. 26 cpv. 1): classificatele come «Dotazione alla fondazione», non «Donazione ricevuta».' },
    foundation_capital: { label: 'Imposta sul capitale', text: 'Nessuna imposta federale. Imposta cantonale sulla sostanza netta determinata secondo le regole per le persone fisiche (LAID art. 29 cpv. 2 lett. c): le cripto sono di principio valutate al valore fiscale del listino dei corsi AFC al 31.12 (rapporto «Elenco dei titoli»).' },
    exempt: { label: 'Statuto fiscale', text: 'Esente per scopo di pubblica utilità o di servizio pubblico: nessuna imposta sull’utile né sul capitale per la parte destinata esclusivamente e irrevocabilmente a tale scopo (LIFD art. 56 lett. g, LAID art. 23 cpv. 1 lett. f). Verificate la portata della decisione cantonale.' },
    partial: { label: 'Statuto fiscale', text: 'Esenzione parziale: è esente solo la parte dell’utile e del capitale destinata allo scopo di pubblica utilità (LIFD art. 56 lett. g). La ripartizione spetta alla decisione cantonale; gli importi qui sotto non la effettuano.' },
  },
  en: {
    company_profit: { label: 'Profit tax', text: 'AG/SA and GmbH/Sàrl: realised crypto gains and losses are part of taxable profit (DBG art. 58). Direct federal tax 8.5% of net profit (DBG art. 68), plus cantonal tax.' },
    company_capital: { label: 'Capital tax', text: 'Cantonal only, on book equity (StHG art. 29 para. 2 let. a). Crypto counts at book value, not at the Kursliste value.' },
    foundation_books: { label: 'Bookkeeping', text: 'Tax exemption does not remove the duty to keep books (Civil Code art. 83a): purchases, sales and realised results are booked as for a company.' },
    foundation_profit: { label: 'Profit tax', text: 'Taxable foundation: direct federal tax 4.25% of net profit; profit below CHF 5,000 is not taxed (DBG art. 71). Realised crypto gains are part of profit.' },
    foundation_endowments: { label: 'Contributions to assets', text: 'Endowments (contributions to the foundation’s assets) are not part of taxable profit (DBG art. 66 para. 1, StHG art. 26 para. 1): classify them as “Endowment to the foundation”, not “Donation received”.' },
    foundation_capital: { label: 'Capital tax', text: 'No federal tax. Cantonal tax on net assets determined under the rules for individuals (StHG art. 29 para. 2 let. c): crypto is in principle valued at the Federal Tax Administration Kursliste value at 31.12 (“securities statement” report).' },
    exempt: { label: 'Tax status', text: 'Exempt for public-benefit or public-service purposes: no profit or capital tax on the part dedicated exclusively and irrevocably to that purpose (DBG art. 56 let. g, StHG art. 23 para. 1 let. f). Check the scope of the cantonal ruling.' },
    partial: { label: 'Tax status', text: 'Partial exemption: only the part of profit and capital dedicated to the public-benefit purpose is exempt (DBG art. 56 let. g). The split follows the cantonal ruling; the amounts below do not apply it.' },
  },
};

/**
 * Notes printed in the reports so the fiduciary sees which tax rules the figures feed into.
 * Sources: LIFD art. 56 let. g, 58, 66 al. 1, 68, 71; LHID art. 23 al. 1 let. f, 26 al. 1, 29 al. 2;
 * ESTV, « Imposition des personnes morales » (état au 1.1.2026). Not tax advice.
 */
export function taxNotes(kind: OrgKind, status: TaxStatus, locale = 'fr'): TaxNote[] {
  const n = NOTE_TEXT[locale] ?? NOTE_TEXT.fr!;
  const exemption = status === 'exempt' ? n.exempt : n.partial;
  if (kind === 'company') {
    const notes: TaxNote[] = [n.company_profit, n.company_capital];
    if (status !== 'ordinary') notes.push(exemption);
    return notes;
  }
  if (kind === 'foundation') {
    if (status === 'exempt') return [exemption, n.foundation_books];
    const notes: TaxNote[] = [n.foundation_profit, n.foundation_endowments, n.foundation_capital];
    if (status === 'partial') notes.unshift(exemption);
    return notes;
  }
  return [];
}
