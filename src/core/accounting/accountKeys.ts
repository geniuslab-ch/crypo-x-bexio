/**
 * Crypto2Books account keys. Each key is mapped by the user to an account in their bexio chart of accounts.
 * Asset-specific keys (crypto_asset:BTC) fall back to the wildcard (crypto_asset:*).
 */
export const ACCOUNT_KEYS = [
  'crypto_asset:*',
  'fiat_clearing:*',
  'bank_clearing',
  'realized_gain',
  'realized_loss',
  'trading_fees',
  'network_fees',
  'staking_income',
  'mining_income',
  'airdrop_income',
  'lending_income',
  'external_deposit_counterpart',
  'external_withdrawal_counterpart',
] as const;

export function cryptoAssetKey(asset: string): string {
  return `crypto_asset:${asset}`;
}

export function fiatClearingKey(asset: string): string {
  return `fiat_clearing:${asset}`;
}

/** Candidate keys from most to least specific. */
export function keyFallbacks(key: string): string[] {
  const i = key.indexOf(':');
  if (i === -1) return [key];
  return [key, `${key.slice(0, i)}:*`];
}

export function resolveMapping<T>(key: string, mappings: Map<string, T>): T | undefined {
  for (const k of keyFallbacks(key)) {
    const v = mappings.get(k);
    if (v !== undefined) return v;
  }
  return undefined;
}
