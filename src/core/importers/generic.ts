import { normalizeAsset } from '../assets';
import { parseAmount } from '../decimal';
import { CLASSIFICATIONS, type Classification, type Movement, type ParsedTransaction, type ParseResult } from '../types';
import { col, parseTimestamp, readCsv } from './csv';
import type { Importer } from './types';

/**
 * Crypto2Books generic CSV template. We define this format, so it is fully supported.
 *
 * Columns (header names are case-insensitive):
 *   date            ISO 8601 timestamp, e.g. 2024-03-01T14:05:00Z (no timezone = UTC)        required
 *   type            optional hint, one of the Crypto2Books classifications (buy, sell, swap, ...)
 *   in_asset        asset received                                                            optional
 *   in_quantity     positive quantity received                                                optional
 *   out_asset       asset sent / spent                                                        optional
 *   out_quantity    positive quantity sent                                                    optional
 *   fee_asset       asset in which a fee was paid                                             optional
 *   fee_quantity    positive fee quantity                                                     optional
 *   external_id     id of the transaction at the source (used for deduplication)              recommended
 *   tx_hash         blockchain transaction hash                                               optional
 *   chf_value       CHF value stated by the source document for the principal crypto leg      optional
 *   note            free text                                                                 optional
 */
export const GENERIC_HEADERS = [
  'date', 'type', 'in_asset', 'in_quantity', 'out_asset', 'out_quantity', 'fee_asset', 'fee_quantity',
  'external_id', 'tx_hash', 'chf_value', 'note',
] as const;

const REQUIRED = ['date', 'in_asset', 'in_quantity', 'out_asset', 'out_quantity'];

function leg(direction: Movement['direction'], asset: string, qty: string, issues: string[]): Movement | null {
  if (!asset && !qty) return null;
  if (!asset || !qty) {
    issues.push(`${direction}: asset and quantity must both be set`);
    return null;
  }
  const q = parseAmount(qty);
  if (!q) {
    issues.push(`${direction}: invalid quantity "${qty}"`);
    return null;
  }
  if (q.isNegative()) {
    issues.push(`${direction}: quantity must be positive`);
    return null;
  }
  if (q.isZero()) return null;
  return { direction, asset: normalizeAsset(asset), quantity: q.toString() };
}

export const genericImporter: Importer = {
  id: 'generic_v1',
  version: 1,
  provider: 'generic',
  label: 'Crypto2Books CSV template',
  support: 'supported',
  supportNote: 'Format defined by Crypto2Books. Use it for any exchange or wallet without a dedicated parser.',
  detect(text) {
    return readCsv(text, REQUIRED) !== null;
  },
  parse(text): ParseResult {
    const table = readCsv(text, REQUIRED);
    if (!table) return { transactions: [], issues: [{ rowNumber: 0, message: 'Header row not recognised as Crypto2Books template' }] };
    const transactions: ParsedTransaction[] = [];
    const issues: ParseResult['issues'] = [];
    table.rows.forEach((row, i) => {
      const line = table.lineNumbers[i] ?? i + 2;
      const rowIssues: string[] = [];
      const occurredAt = parseTimestamp(col(row, 'date'));
      if (!occurredAt) rowIssues.push(`invalid date "${col(row, 'date')}"`);
      const movements = [
        leg('in', col(row, 'in_asset'), col(row, 'in_quantity'), rowIssues),
        leg('out', col(row, 'out_asset'), col(row, 'out_quantity'), rowIssues),
        leg('fee', col(row, 'fee_asset'), col(row, 'fee_quantity'), rowIssues),
      ].filter((m): m is Movement => m !== null);
      if (movements.length === 0) rowIssues.push('row has no movement');
      const typeRaw = col(row, 'type').toLowerCase();
      let hint: ParsedTransaction['hint'] = null;
      if (typeRaw) {
        if ((CLASSIFICATIONS as readonly string[]).includes(typeRaw)) {
          hint = { classification: typeRaw as Classification, confidence: 0.9, reason: 'Type stated in the import file' };
        } else rowIssues.push(`unknown type "${typeRaw}"`);
      }
      const chfValueRaw = col(row, 'chf_value');
      const chfValue = chfValueRaw ? parseAmount(chfValueRaw) : null;
      if (chfValueRaw && (!chfValue || chfValue.isNegative())) rowIssues.push(`invalid chf_value "${chfValueRaw}"`);
      if (rowIssues.length > 0 || !occurredAt) {
        issues.push({ rowNumber: line, message: rowIssues.join('; ') });
        return;
      }
      transactions.push({
        externalId: col(row, 'external_id') || null,
        occurredAt,
        rawType: typeRaw || 'unspecified',
        movements,
        raw: [row],
        rowNumbers: [line],
        txHash: col(row, 'tx_hash') || null,
        note: col(row, 'note') || null,
        hint,
        sourceChfValue: chfValue ? chfValue.toString() : null,
      });
    });
    return { transactions, issues };
  },
};
