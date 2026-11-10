/**
 * CoinGecko historical price provider (optional; disabled without COINGECKO_API_KEY).
 *
 * Endpoint: GET /coins/{id}/history?date=dd-mm-yyyy → market_data.current_price.chf
 * Demo keys use https://api.coingecko.com/api/v3 with header x-cg-demo-api-key; paid keys use
 * https://pro-api.coingecko.com/api/v3 with x-cg-pro-api-key (set COINGECKO_PLAN=pro).
 * The value is CoinGecko's daily snapshot (00:00 UTC). Demo plans limit how far back history goes and
 * commercial use requires an appropriate CoinGecko plan — check their current terms before production.
 * Status: implemented, needs a contract test with a real key (see docs/FEASIBILITY.md section C).
 */

/** Explicit symbol → CoinGecko id map. Symbols are ambiguous, so unknown symbols are never guessed. */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple',
  ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token', LTC: 'litecoin',
  AVAX: 'avalanche-2', LINK: 'chainlink', ATOM: 'cosmos', XLM: 'stellar', TRX: 'tron', ALGO: 'algorand', XTZ: 'tezos',
  DAI: 'dai', UNI: 'uniswap', AAVE: 'aave', BCH: 'bitcoin-cash', ETC: 'ethereum-classic', XMR: 'monero', NEAR: 'near',
  ARB: 'arbitrum', OP: 'optimism', CHSB: 'swissborg', BORG: 'swissborg', CRO: 'crypto-com-chain', BEST: 'bitpanda-ecosystem-token',
};

export interface CoinGeckoQuote {
  rate: string;
  sourceUrl: string;
}

export function coingeckoConfigured(): boolean {
  return !!process.env.COINGECKO_API_KEY;
}

export async function fetchCoinGeckoChfRate(asset: string, isoDate: string, fetchImpl: typeof fetch = fetch): Promise<CoinGeckoQuote | null> {
  const key = process.env.COINGECKO_API_KEY;
  const id = COINGECKO_IDS[asset];
  if (!key || !id) return null;
  const pro = process.env.COINGECKO_PLAN === 'pro';
  const base = pro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  const [y, m, d] = isoDate.split('-');
  const url = `${base}/coins/${id}/history?date=${d}-${m}-${y}&localization=false`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json', [pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: key } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const body = (await res.json()) as { market_data?: { current_price?: { chf?: number } } };
  const chf = body.market_data?.current_price?.chf;
  if (typeof chf !== 'number' || !Number.isFinite(chf) || chf <= 0) return null;
  // Public URL of the same data, without the key, for the audit trail.
  return { rate: String(chf), sourceUrl: `https://www.coingecko.com/en/coins/${id}/historical_data` };
}
