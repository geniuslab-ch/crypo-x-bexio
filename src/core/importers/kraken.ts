import { normalizeKrakenAsset } from '../assets';
import { D, parseAmount, type Dec } from '../decimal';
import type { Movement, ParsedTransaction, ParseResult } from '../types';
import { col, parseTimestamp, readCsv } from './csv';
import type { Importer } from './types';

/**
 * Kraken "Ledgers" CSV export.
 * Expected columns: txid, refid, time, type, subtype, aclass, asset, amount, fee, balance (optionally wallet).
 * `amount` is signed; `fee` is charged in the same asset and reduces the balance (balance = previous + amount - fee).
 * Rows sharing a refid form one economic transaction (e.g. both legs of a trade).
 * Times are exported in UTC.
 *
 * Support level: partial — written against the published column layout, must be validated
 * with real customer exports before being marked supported.
 */
const REQUIRED = ['txid', 'refid', 'time', 'type', 'asset', 'amount', 'fee'];

export const krakenLedgerImporter: Importer = {
  id: 'kraken_ledger_v1',
  version: 1,
  provider: 'kraken',
  label: 'Kraken — Ledgers export (CSV)',
  support: 'partial',
  supportNote: 'Based on the Kraken ledger column layout. Unknown row types are imported for manual review, never guessed.',
  detect(text) {
    return readCsv(text, REQUIRED) !== null;
  },
  parse(text): ParseResult {
    const table = readCsv(text, REQUIRED);
    if (!table) return { transactions: [], issues: [{ rowNumber: 0, message: 'Header row not recognised as Kraken ledger export' }] };
    const issues: ParseResult['issues'] = [];
    const groups = new Map<string, { rows: Record<string, string>[]; lines: number[] }>();
    table.rows.forEach((row, i) => {
      const line = table.lineNumbers[i] ?? i + 2;
      if (!col(row, 'txid')) {
        // Kraken lists pending entries without a txid; the settled entry appears separately.
        issues.push({ rowNumber: line, message: 'Ignorée : ligne sans txid (opération en attente dans l’export Kraken)' });
        return;
      }
      const refid = col(row, 'refid') || col(row, 'txid');
      const g = groups.get(refid) ?? { rows: [], lines: [] };
      g.rows.push(row);
      g.lines.push(line);
      groups.set(refid, g);
    });

    const transactions: ParsedTransaction[] = [];
    for (const [refid, g] of groups) {
      const net = new Map<string, Dec>();
      const fees = new Map<string, Dec>();
      let bad = false;
      let occurredAt: Date | null = null;
      for (const [k, row] of g.rows.entries()) {
        const asset = normalizeKrakenAsset(col(row, 'asset'));
        const amount = parseAmount(col(row, 'amount'));
        const feeRaw = col(row, 'fee').trim();
        // A blank fee means no fee; a non-blank value that does not parse is an error, never a silent zero.
        const fee = feeRaw === '' ? new D(0) : parseAmount(feeRaw);
        const t = parseTimestamp(col(row, 'time'));
        if (!amount || !t || !asset || !fee) {
          issues.push({ rowNumber: g.lines[k] ?? 0, message: `Ligne invalide (actif/montant/frais/date) dans refid ${refid}` });
          bad = true;
          break;
        }
        if (!occurredAt || t < occurredAt) occurredAt = t;
        net.set(asset, (net.get(asset) ?? new D(0)).plus(amount));
        if (!fee.isZero()) fees.set(asset, (fees.get(asset) ?? new D(0)).plus(fee));
      }
      if (bad || !occurredAt) continue;

      const movements: Movement[] = [];
      for (const [asset, amt] of net) {
        if (amt.isZero()) continue;
        movements.push({ direction: amt.isPositive() ? 'in' : 'out', asset, quantity: amt.abs().toString() });
      }
      for (const [asset, fee] of fees) {
        movements.push({ direction: 'fee', asset, quantity: fee.abs().toString() });
      }

      const types = [...new Set(g.rows.map((r) => col(r, 'type').toLowerCase()))];
      const subtypes = [...new Set(g.rows.map((r) => col(r, 'subtype').toLowerCase()).filter(Boolean))];
      const rawType = [types.join('+'), subtypes.join('+')].filter(Boolean).join(':');
      transactions.push({
        externalId: refid,
        occurredAt,
        rawType,
        movements,
        raw: g.rows,
        rowNumbers: g.lines,
        hint: krakenHint(types, subtypes, movements),
      });
    }
    transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return { transactions, issues };
  },
};

function krakenHint(types: string[], subtypes: string[], movements: Movement[]): ParsedTransaction['hint'] {
  const principal = movements.filter((m) => m.direction !== 'fee');
  const only = types.length === 1 ? types[0] : null;
  if (principal.length === 0) {
    // Legs cancel out after normalising staked/earn asset codes: movement between Kraken sub-accounts.
    if (movements.length === 0 || ['transfer', 'earn', 'staking'].some((t) => types.includes(t))) {
      return { classification: 'internal_transfer', confidence: 0.95, reason: 'Mouvement interne Kraken entre soldes spot et staking/earn' };
    }
  }
  if ((only === 'staking' || (only === 'earn' && subtypes.includes('reward'))) && principal.every((m) => m.direction === 'in')) {
    return { classification: 'staking_reward', confidence: 0.95, reason: 'Ligne Kraken de type récompense staking/earn' };
  }
  if (only === 'transfer' && principal.length === 1 && principal[0]?.direction === 'in' && subtypes.length === 0) {
    return { classification: 'airdrop', confidence: 0.5, reason: 'Crédit Kraken « transfer » sans sous-type : utilisé pour les airdrops/forks, merci de confirmer' };
  }
  if (only && ['margin', 'rollover', 'settled', 'adjustment', 'credit', 'dividend', 'sale', 'nfttrade', 'invite bonus'].includes(only)) {
    return { classification: 'unknown', confidence: 0.3, reason: `Type Kraken « ${only} » non traité automatiquement en phase 1` };
  }
  return null; // trade / spend / receive / deposit / withdrawal: structure decides
}
