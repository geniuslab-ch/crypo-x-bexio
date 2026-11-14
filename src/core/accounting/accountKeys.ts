/**
 * Crypto2Books account keys. Each key is mapped by the user to an account in their bexio chart of accounts.
 * Asset-specific keys (crypto_asset:BTC) fall back to the wildcard (crypto_asset:*).
 * Optional per-wallet accounts: a source can have its own crypto account (crypto_asset:*@<sourceId>); its holdings are
 * then booked on keys like crypto_asset:BTC@<sourceId>, which fall back to crypto_asset:*@<sourceId>, then to the
 * per-crypto keys.
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
  'donation_income',
  'foundation_capital',
  'grants_expense',
  'valuation_loss',
  'valuation_gain',
] as const;

export function cryptoAssetKey(asset: string, wallet?: string | null): string {
  return wallet ? `crypto_asset:${asset}@${wallet}` : `crypto_asset:${asset}`;
}

/** Key of a source's own crypto account (optional). */
export function walletAccountKey(sourceId: string): string {
  return `crypto_asset:*@${sourceId}`;
}

/** Source id of a per-wallet key, or null. */
export function walletOfKey(key: string): string | null {
  const at = key.indexOf('@');
  return at === -1 ? null : key.slice(at + 1);
}

export function fiatClearingKey(asset: string): string {
  return `fiat_clearing:${asset}`;
}

/** Candidate keys from most to least specific. */
export function keyFallbacks(key: string): string[] {
  const at = key.indexOf('@');
  if (at !== -1) {
    const base = key.slice(0, at);
    const wallet = key.slice(at);
    const i = base.indexOf(':');
    return [...new Set([key, `${base.slice(0, i)}:*${wallet}`, base, `${base.slice(0, i)}:*`])];
  }
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
