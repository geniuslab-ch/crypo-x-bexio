/** What each CSV format expects, shown next to the format picker (French here; other languages in WHERE). Example rows are fictitious. */
export interface FormatGuide {
  where: string;
  columns: string[];
  example: string[];
}

export const FORMAT_GUIDES: Record<string, FormatGuide> = {
  generic_v1: {
    where: 'Modèle Crypto2Books : pour toute plateforme ou tout wallet sans format dédié. Une ligne par opération ; « in » = reçu, « out » = donné, quantités toujours positives.',
    columns: ['date', 'type', 'in_asset', 'in_quantity', 'out_asset', 'out_quantity', 'fee_asset', 'fee_quantity', 'external_id', 'tx_hash', 'chf_value', 'note'],
    example: ['2025-01-15T10:00:00Z', 'buy', 'ICP', '400', 'CHF', '3200', 'CHF', '8', 'exemple-001', '', '3200', 'Exemple fictif'],
  },
  kraken_ledger_v1: {
    where: 'Kraken : History → Export → type « Ledgers », format CSV. N’utilisez pas l’export « Trades » : il ne contient ni dépôts, ni retraits, ni staking.',
    columns: ['txid', 'refid', 'time', 'type', 'subtype', 'aclass', 'asset', 'wallet', 'amount', 'fee', 'balance'],
    example: ['LEXMPL-AAAAA-000001', 'QEXMPL-AAAAA-000001', '2025-01-06 09:00:00', 'deposit', '', 'currency', 'ZCHF', 'spot / main', '1000.0000', '0.0000', '1000.0000'],
  },
  coinbase_history_v1: {
    where: 'Coinbase : Profil → Rapports (Statements) → « Transaction history », format CSV. Les lignes d’en-tête au-dessus du tableau sont acceptées.',
    columns: ['ID', 'Timestamp', 'Transaction Type', 'Asset', 'Quantity Transacted', 'Price Currency', 'Price at Transaction', 'Subtotal', 'Total (inclusive of fees and/or spread)', 'Fees and/or Spread', 'Notes'],
    example: ['exemple-1', '2025-01-10 08:00:00 UTC', 'Buy', 'ETH', '1', 'CHF', 'CHF3000.00', 'CHF3000.00', 'CHF3029.85', 'CHF29.85', 'Exemple fictif'],
  },
};

/** The "where to find it" text in the other interface languages (French stays in FORMAT_GUIDES). */
const WHERE: Record<string, Record<string, string>> = {
  de: {
    generic_v1: 'Crypto2Books-Vorlage: für jede Plattform und jedes Wallet ohne eigenes Format. Eine Zeile pro Vorgang; «in» = erhalten, «out» = abgegeben, Mengen immer positiv.',
    kraken_ledger_v1: 'Kraken: History → Export → Typ «Ledgers», Format CSV. Verwenden Sie nicht den Export «Trades»: Er enthält weder Ein- und Auszahlungen noch Staking.',
    coinbase_history_v1: 'Coinbase: Profil → Berichte (Statements) → «Transaction history», Format CSV. Kopfzeilen über der Tabelle werden akzeptiert.',
  },
  it: {
    generic_v1: 'Modello Crypto2Books: per qualsiasi piattaforma o wallet senza formato dedicato. Una riga per operazione; «in» = ricevuto, «out» = dato, quantità sempre positive.',
    kraken_ledger_v1: 'Kraken: History → Export → tipo «Ledgers», formato CSV. Non usate l’esportazione «Trades»: non contiene né depositi, né prelievi, né staking.',
    coinbase_history_v1: 'Coinbase: Profilo → Rapporti (Statements) → «Transaction history», formato CSV. Le righe d’intestazione sopra la tabella sono accettate.',
  },
  en: {
    generic_v1: 'Crypto2Books template: for any platform or wallet without a dedicated format. One row per operation; “in” = received, “out” = given, quantities always positive.',
    kraken_ledger_v1: 'Kraken: History → Export → type “Ledgers”, CSV format. Don’t use the “Trades” export: it has no deposits, withdrawals or staking.',
    coinbase_history_v1: 'Coinbase: Profile → Statements → “Transaction history”, CSV format. Header lines above the table are accepted.',
  },
};

/** Guides with the help text in the interface language. */
export function localizedGuides(locale: string): Record<string, FormatGuide> {
  const w = WHERE[locale];
  if (!w) return FORMAT_GUIDES;
  return Object.fromEntries(Object.entries(FORMAT_GUIDES).map(([id, g]) => [id, { ...g, where: w[id] ?? g.where }]));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function exampleCsv(id: string): string | null {
  const g = FORMAT_GUIDES[id];
  return g ? `${g.columns.map(csvCell).join(',')}\n${g.example.map(csvCell).join(',')}\n` : null;
}
