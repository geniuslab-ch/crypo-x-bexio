import { normalizeAsset } from '../assets';
import { parseAmount } from '../decimal';
import type { Classification, Movement, ParsedTransaction, ParseResult } from '../types';
import { col, parseTimestamp, readCsv } from './csv';
import type { Importer } from './types';

/**
 * Coinbase "Transaction history" CSV report.
 * Expected columns: ID, Timestamp, Transaction Type, Asset, Quantity Transacted, Price Currency,
 * Price at Transaction, Subtotal, Total (inclusive of fees and/or spread), Fees and/or Spread, Notes.
 * The file can start with preamble lines; the header row is located automatically.
 *
 * Movement model (actual balance changes):
 *   Buy:  in = asset qty, out = Subtotal (price currency), fee = Fees (price currency)
 *   Sell: out = asset qty, in = Subtotal (gross), fee = Fees
 * Coinbase has changed this format several times. Support level: partial.
 */
const REQUIRED = ['Timestamp', 'Transaction Type', 'Asset', 'Quantity Transacted'];
const TOTAL = 'Total (inclusive of fees and/or spread)';
const FEES = 'Fees and/or Spread';

const TYPE_HINTS: Record<string, { c: Classification; conf: number }> = {
  'staking income': { c: 'staking_reward', conf: 0.95 },
  'rewards income': { c: 'staking_reward', conf: 0.7 },
  'inflation reward': { c: 'staking_reward', conf: 0.9 },
  'learning reward': { c: 'airdrop', conf: 0.7 },
  'coinbase earn': { c: 'airdrop', conf: 0.7 },
  'send': { c: 'withdrawal', conf: 0.6 },
  'receive': { c: 'deposit', conf: 0.6 },
};

export const coinbaseImporter: Importer = {
  id: 'coinbase_history_v1',
  version: 1,
  provider: 'coinbase',
  label: 'Coinbase — Transaction history (CSV)',
  support: 'partial',
  supportNote: 'Coinbase has changed this export several times. Unrecognised rows are rejected with a reason.',
  detect(text) {
    return readCsv(text, REQUIRED) !== null;
  },
  parse(text): ParseResult {
    const table = readCsv(text, REQUIRED);
    if (!table) return { transactions: [], issues: [{ rowNumber: 0, message: 'Header row not recognised as Coinbase transaction history' }] };
    const transactions: ParsedTransaction[] = [];
    const issues: ParseResult['issues'] = [];
    table.rows.forEach((row, i) => {
      const line = table.lineNumbers[i] ?? i + 2;
      const occurredAt = parseTimestamp(col(row, 'Timestamp'));
      const type = col(row, 'Transaction Type');
      const t = type.toLowerCase();
      const asset = normalizeAsset(col(row, 'Asset'));
      const qty = parseAmount(col(row, 'Quantity Transacted'))?.abs() ?? null;
      const priceCcy = normalizeAsset(col(row, 'Price Currency'));
      const subtotal = parseAmount(col(row, 'Subtotal'))?.abs() ?? null;
      const fees = parseAmount(col(row, FEES))?.abs() ?? null;
      const total = parseAmount(col(row, TOTAL))?.abs() ?? null;
      if (!occurredAt || !asset || !qty) {
        issues.push({ rowNumber: line, message: 'Missing timestamp, asset or quantity' });
        return;
      }
      const movements: Movement[] = [];
      let hint: ParsedTransaction['hint'] = null;
      if (t === 'buy' || t === 'advanced trade buy') {
        if (!subtotal || !priceCcy) {
          issues.push({ rowNumber: line, message: 'Buy without Subtotal/Price Currency' });
          return;
        }
        movements.push({ direction: 'in', asset, quantity: qty.toString() });
        movements.push({ direction: 'out', asset: priceCcy, quantity: subtotal.toString() });
        if (fees && !fees.isZero()) movements.push({ direction: 'fee', asset: priceCcy, quantity: fees.toString() });
      } else if (t === 'sell' || t === 'advanced trade sell') {
        if (!subtotal || !priceCcy) {
          issues.push({ rowNumber: line, message: 'Sell without Subtotal/Price Currency' });
          return;
        }
        movements.push({ direction: 'out', asset, quantity: qty.toString() });
        movements.push({ direction: 'in', asset: priceCcy, quantity: subtotal.toString() });
        if (fees && !fees.isZero()) movements.push({ direction: 'fee', asset: priceCcy, quantity: fees.toString() });
      } else if (t === 'convert') {
        // Notes look like "Converted 0.01 BTC to 0.15 ETH". If the note cannot be read, refuse the row.
        const m = /converted\s+([\d.,]+)\s+([A-Za-z0-9]+)\s+to\s+([\d.,]+)\s+([A-Za-z0-9]+)/i.exec(col(row, 'Notes'));
        const outQty = m ? parseAmount(m[1]) : null;
        const inQty = m ? parseAmount(m[3]) : null;
        if (!m || !outQty || !inQty) {
          issues.push({ rowNumber: line, message: 'Convert row whose Notes do not state both legs; please import via the generic template' });
          return;
        }
        movements.push({ direction: 'out', asset: normalizeAsset(m[2] ?? ''), quantity: outQty.toString() });
        movements.push({ direction: 'in', asset: normalizeAsset(m[4] ?? ''), quantity: inQty.toString() });
        // Coinbase reports the convert spread in the price currency; it is already embedded in the exchange rate,
        // so it is kept as evidence (raw row) and not booked a second time.
      } else if (t === 'send' || t === 'withdrawal') {
        movements.push({ direction: 'out', asset, quantity: qty.toString() });
      } else if (t === 'receive' || t === 'deposit' || TYPE_HINTS[t]) {
        movements.push({ direction: 'in', asset, quantity: qty.toString() });
      } else {
        movements.push({ direction: 'in', asset, quantity: qty.toString() });
        hint = { classification: 'unknown', confidence: 0.2, reason: `Coinbase type "${type}" not recognised; direction unknown` };
      }
      const th = TYPE_HINTS[t];
      if (!hint && th) hint = { classification: th.c, confidence: th.conf, reason: `Coinbase type "${type}"` };
      transactions.push({
        externalId: col(row, 'ID') || null,
        occurredAt,
        rawType: type,
        movements,
        raw: [row],
        rowNumbers: [line],
        note: col(row, 'Notes') || null,
        hint,
        sourceChfValue: priceCcy === 'CHF' && total && ['receive', 'staking income', 'rewards income', 'inflation reward', 'learning reward'].includes(t)
          ? (subtotal ?? total).toString()
          : null,
      });
    });
    return { transactions, issues };
  },
};
