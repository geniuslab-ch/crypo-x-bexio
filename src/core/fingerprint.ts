import { createHash } from 'node:crypto';
import type { ParsedTransaction } from './types';

/**
 * Deterministic fingerprint used for duplicate detection.
 * With an external id: source + external id. Without one: source + timestamp + sorted movements.
 */
export function transactionFingerprint(sourceId: string, tx: ParsedTransaction): string {
  const basis = tx.externalId
    ? `${sourceId}|id|${tx.externalId}`
    : `${sourceId}|t|${tx.occurredAt.toISOString()}|${tx.movements
        .map((m) => `${m.direction}:${m.asset}:${m.quantity}`)
        .sort()
        .join(',')}|${tx.rawType}`;
  return createHash('sha256').update(basis).digest('hex');
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}
