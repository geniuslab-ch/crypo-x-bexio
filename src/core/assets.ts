/** Asset helpers: fiat detection, stablecoins and symbol normalisation. */

export const FIAT_CURRENCIES: ReadonlySet<string> = new Set([
  'CHF', 'EUR', 'USD', 'GBP', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
]);

/** Common USD/EUR/CHF-pegged stablecoins. Treated as crypto assets with their own lots (see FEASIBILITY D8). */
export const STABLECOINS: ReadonlySet<string> = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'PYUSD', 'FDUSD', 'EURC', 'EURT', 'XCHF', 'USDE',
]);

export function isFiat(asset: string): boolean {
  return FIAT_CURRENCIES.has(asset);
}

export function isStablecoin(asset: string): boolean {
  return STABLECOINS.has(asset);
}

/** Kraken legacy asset codes. Source: Kraken asset naming (X-prefixed crypto, Z-prefixed fiat). */
const KRAKEN_ALIASES: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  XETC: 'ETC',
  XXMR: 'XMR',
  XZEC: 'ZEC',
  XREP: 'REP',
  XMLN: 'MLN',
  ZCHF: 'CHF',
  ZEUR: 'EUR',
  ZUSD: 'USD',
  ZGBP: 'GBP',
  ZCAD: 'CAD',
  ZJPY: 'JPY',
  ZAUD: 'AUD',
};

/**
 * Kraken suffixes for staked / earn / opt-in rewards balances (e.g. ETH2.S, DOT.S, USDC.M, BTC.F).
 * The underlying asset is the same economic asset, so we map to the base symbol.
 */
const KRAKEN_SUFFIX = /\.(S|M|F|P|B|HOLD)$/;

export function normalizeKrakenAsset(code: string): string {
  let c = code.trim().toUpperCase();
  c = c.replace(KRAKEN_SUFFIX, '');
  if (c === 'ETH2') c = 'ETH';
  return KRAKEN_ALIASES[c] ?? c;
}

export function normalizeAsset(symbol: string): string {
  return symbol.trim().toUpperCase();
}
