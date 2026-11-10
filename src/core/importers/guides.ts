/** What each CSV format expects, shown next to the format picker (French UI). Example rows are fictitious. */
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

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function exampleCsv(id: string): string | null {
  const g = FORMAT_GUIDES[id];
  return g ? `${g.columns.map(csvCell).join(',')}\n${g.example.map(csvCell).join(',')}\n` : null;
}
