import { createHmac } from 'node:crypto';
import { normalizeAsset } from '@/core/assets';
import { D } from '@/core/decimal';
import type { Movement, ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson } from './http';
import { ConnectorError, type FetchContext, type SourceConnector, type SyncState } from './types';

/**
 * Binance read-only API (api.binance.com). Verified against developers.binance.com, 2026-11-10:
 * - GET /sapi/v1/account/apiRestrictions → enableReading, enableWithdrawals, enableInternalTransfer,
 *   permitsUniversalTransfer, enableSpotAndMarginTrading, enableMargin, enableFutures…
 * - GET /sapi/v1/capital/deposit/hisrec (status 1 = success; window < 90 days; limit ≤ 1000)
 * - GET /sapi/v1/capital/withdraw/history (status 6 = completed; applyTime "YYYY-MM-DD HH:MM:SS" UTC;
 *   amount + transactionFee; window < 90 days; limit ≤ 1000)
 * - GET /api/v3/myTrades (symbol required; fromId paging; limit ≤ 1000; fields price, qty, quoteQty,
 *   commission, commissionAsset, time, isBuyer)
 * - GET /api/v3/account (balances) and public GET /api/v3/exchangeInfo (symbol list)
 * SIGNED requests: query string + timestamp, signature = hex HMAC-SHA256(secret, query), header X-MBX-APIKEY.
 *
 * Coverage limit: Binance has no endpoint listing the pairs a user traded. We query every listed pair
 * whose base asset the user holds or moved in/out, quoted in one of those assets or a major quote asset,
 * plus any extra pairs the user names. Convert, Earn, dust and card purchases are not covered yet.
 */
const BASE = 'https://api.binance.com';
const DAY = 86_400_000;
const WINDOW = 89 * DAY;
const START = Date.UTC(2017, 6, 1);
const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'CHF', 'GBP', 'TRY', 'DAI'];

interface Deposit { id?: string; amount: string; coin: string; status: number; txId?: string; insertTime: number; network?: string; transferType?: number }
interface Withdrawal { id: string; amount: string; transactionFee: string; coin: string; status: number; txId?: string; applyTime: string; completeTime?: string; network?: string; transferType?: number }
interface Trade { symbol: string; id: number; orderId: number; price: string; qty: string; quoteQty: string; commission: string; commissionAsset: string; time: number; isBuyer: boolean }
interface SymbolInfo { symbol: string; baseAsset: string; quoteAsset: string }

interface BinanceState extends SyncState {
  phase?: 'transfers' | 'symbols' | 'trades';
  /** Next window start for deposit/withdrawal history (epoch ms). */
  transfersFrom?: number;
  deposits?: Deposit[];
  withdrawals?: Withdrawal[];
  symbols?: SymbolInfo[];
  symbolIndex?: number;
  fromId?: number;
  trades?: Trade[];
  /** Trades already fetched in earlier passes: next pass starts after these ids. */
  lastTradeId?: Record<string, number>;
  /** Transfers window start for the next pass. */
  nextPassFrom?: number;
}

export function binanceSign(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex');
}

async function signed<T>(fx: FetchContext, creds: Record<string, string>, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const q = new URLSearchParams(Object.entries({ ...params, recvWindow: 10000, timestamp: fx.now() }).map(([k, v]) => [k, String(v)])).toString();
  return requestJson<T>(fx, `${BASE}${path}?${q}&signature=${binanceSign(q, creds.apiSecret ?? '')}`, {
    headers: { 'X-MBX-APIKEY': creds.apiKey ?? '' },
  });
}

const fmt = (v: string | number) => new D(v).toString();

export function mapBinance(input: { deposits: Deposit[]; withdrawals: Withdrawal[]; trades: Trade[]; symbols: SymbolInfo[] }): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];
  const bySymbol = new Map(input.symbols.map((s) => [s.symbol, s]));
  input.deposits.forEach((d, i) => {
    if (d.status !== 1 && d.status !== 6) return; // only credited deposits
    const asset = normalizeAsset(d.coin);
    transactions.push({
      externalId: `deposit:${d.id ?? d.txId ?? `${d.coin}:${d.insertTime}`}`, occurredAt: new Date(d.insertTime), rawType: 'deposit',
      movements: [{ direction: 'in', asset, quantity: fmt(d.amount) }], raw: [stringify(d)], rowNumbers: [i + 1], txHash: d.txId || null,
      note: d.network ? `Réseau ${d.network}` : null,
    });
  });
  input.withdrawals.forEach((w, i) => {
    if (w.status !== 6) return; // only completed withdrawals
    const asset = normalizeAsset(w.coin);
    const at = new Date(`${w.applyTime.replace(' ', 'T')}Z`);
    if (Number.isNaN(at.getTime())) { issues.push({ rowNumber: i + 1, message: `Retrait Binance ${w.id} : date illisible` }); return; }
    const movements: Movement[] = [{ direction: 'out', asset, quantity: fmt(w.amount) }];
    if (new D(w.transactionFee || 0).gt(0)) movements.push({ direction: 'fee', asset, quantity: fmt(w.transactionFee) });
    transactions.push({
      externalId: `withdrawal:${w.id}`, occurredAt: at, rawType: 'withdrawal', movements, raw: [stringify(w)], rowNumbers: [i + 1],
      txHash: w.txId || null, note: w.network ? `Réseau ${w.network}` : null,
    });
  });
  input.trades.forEach((t, i) => {
    const s = bySymbol.get(t.symbol);
    if (!s) { issues.push({ rowNumber: i + 1, message: `Trade Binance ${t.symbol}#${t.id} : paire inconnue` }); return; }
    const base = normalizeAsset(s.baseAsset);
    const quote = normalizeAsset(s.quoteAsset);
    const movements: Movement[] = t.isBuyer
      ? [{ direction: 'in', asset: base, quantity: fmt(t.qty) }, { direction: 'out', asset: quote, quantity: fmt(t.quoteQty) }]
      : [{ direction: 'out', asset: base, quantity: fmt(t.qty) }, { direction: 'in', asset: quote, quantity: fmt(t.quoteQty) }];
    if (new D(t.commission || 0).gt(0)) movements.push({ direction: 'fee', asset: normalizeAsset(t.commissionAsset), quantity: fmt(t.commission) });
    transactions.push({
      externalId: `trade:${t.symbol}:${t.id}`, occurredAt: new Date(t.time), rawType: `trade:${t.isBuyer ? 'buy' : 'sell'}`, movements,
      raw: [stringify(t)], rowNumbers: [i + 1], note: `${t.symbol} @ ${t.price}`,
    });
  });
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues };
}

function stringify(o: object): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? '' : String(v)]));
}

export const binanceApiConnector: SourceConnector = {
  id: 'binance_api_v1',
  version: 1,
  provider: 'binance',
  label: 'Binance — API lecture seule',
  kind: 'exchange',
  support: 'partial',
  fields: [
    { name: 'apiKey', label: 'API Key', secret: false },
    { name: 'apiSecret', label: 'Secret Key', secret: true },
    { name: 'extraSymbols', label: 'Paires supplémentaires (optionnel, ex. SOLUSDT, ADAEUR)', secret: false, optional: true },
  ],
  help: 'Binance → Profil → Gestion des API → Créer une clé (générée par le système). Laissez uniquement « Enable Reading » coché. Nous refusons toute clé qui permet le trading, les transferts ou les retraits.',
  limits: 'Couvre dépôts, retraits et trades spot. Pas encore : Convert, Earn, conversion de poussière, achats par carte. Binance ne liste pas les paires tradées : nous interrogeons les paires de vos actifs ; ajoutez une paire manquante dans le champ prévu.',
  async verify(creds, fx) {
    if (!creds.apiKey || !creds.apiSecret) throw new ConnectorError('credentials_missing');
    const r = await signed<Record<string, boolean>>(fx, creds, '/sapi/v1/account/apiRestrictions');
    const risky = ['enableWithdrawals', 'enableInternalTransfer', 'permitsUniversalTransfer', 'enableSpotAndMarginTrading', 'enableMargin', 'enableFutures', 'enableVanillaOptions', 'enablePortfolioMarginTrading']
      .filter((k) => r[k] === true);
    if (risky.length > 0) throw new ConnectorError('api_key_not_read_only', risky.join(', '));
    if (r.enableReading !== true) throw new ConnectorError('api_key_cannot_read');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    // Refuse to read with a key that gained trading/withdrawal rights since it was saved.
    await binanceApiConnector.verify(creds, fx);
    const st: BinanceState = { phase: 'transfers', deposits: [], withdrawals: [], trades: [], lastTradeId: {}, ...(raw as BinanceState) };
    st.transfersFrom ??= st.nextPassFrom ?? START;
    const passStart = st.nextPassFrom ?? START;
    const partial = (msg: string) => ({ transactions: [], issues: [], evidence: null, complete: false, state: st, progress: msg });

    if (st.phase === 'transfers') {
      while (st.transfersFrom < fx.now()) {
        if (outOfTime(fx)) return partial(`Binance : historique des dépôts/retraits lu jusqu’au ${new Date(st.transfersFrom).toISOString().slice(0, 10)} — relancez pour continuer.`);
        const end = Math.min(st.transfersFrom + WINDOW, fx.now());
        const [dep, wd] = await Promise.all([
          signed<Deposit[]>(fx, creds, '/sapi/v1/capital/deposit/hisrec', { startTime: st.transfersFrom, endTime: end, limit: 1000 }),
          signed<Withdrawal[]>(fx, creds, '/sapi/v1/capital/withdraw/history', { startTime: st.transfersFrom, endTime: end, limit: 1000 }),
        ]);
        if (dep.length >= 1000 || wd.length >= 1000) throw new ConnectorError('provider_error', 'plus de 1000 mouvements sur 90 jours : contactez le support');
        st.deposits!.push(...dep);
        st.withdrawals!.push(...wd);
        st.transfersFrom = end + 1;
      }
      st.phase = 'symbols';
    }

    if (st.phase === 'symbols') {
      const [account, info] = await Promise.all([
        signed<{ balances: { asset: string; free: string; locked: string }[] }>(fx, creds, '/api/v3/account'),
        requestJson<{ symbols: SymbolInfo[] }>(fx, `${BASE}/api/v3/exchangeInfo`),
      ]);
      const assets = new Set<string>([
        ...account.balances.filter((b) => new D(b.free).plus(b.locked).gt(0)).map((b) => b.asset),
        ...st.deposits!.map((d) => d.coin), ...st.withdrawals!.map((w) => w.coin),
      ]);
      const extra = new Set((creds.extraSymbols ?? '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
      const quotes = new Set([...QUOTES, ...assets]);
      st.symbols = info.symbols
        .filter((s) => extra.has(s.symbol) || (assets.has(s.baseAsset) && quotes.has(s.quoteAsset)) || (assets.has(s.quoteAsset) && assets.has(s.baseAsset)))
        .map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));
      st.symbolIndex = 0;
      st.fromId = undefined;
      st.phase = 'trades';
    }

    const symbols = st.symbols ?? [];
    while ((st.symbolIndex ?? 0) < symbols.length) {
      if (outOfTime(fx)) return partial(`Binance : paires analysées ${st.symbolIndex}/${symbols.length} — relancez pour continuer.`);
      const sym = symbols[st.symbolIndex!]!.symbol;
      const fromId = st.fromId ?? (st.lastTradeId![sym] !== undefined ? st.lastTradeId![sym]! + 1 : 0);
      const page = await signed<Trade[]>(fx, creds, '/api/v3/myTrades', { symbol: sym, fromId, limit: 1000 });
      st.trades!.push(...page);
      if (page.length === 1000) {
        st.fromId = page[page.length - 1]!.id + 1;
      } else {
        const last = page.at(-1);
        if (last) st.lastTradeId![sym] = last.id;
        st.symbolIndex = st.symbolIndex! + 1;
        st.fromId = undefined;
      }
    }

    const mapped = mapBinance({ deposits: st.deposits!, withdrawals: st.withdrawals!, trades: st.trades!, symbols });
    for (const t of st.trades!) st.lastTradeId![t.symbol] = Math.max(st.lastTradeId![t.symbol] ?? -1, t.id);
    const evidence = { passFrom: passStart, deposits: st.deposits, withdrawals: st.withdrawals, trades: st.trades };
    return {
      ...mapped, evidence, complete: true,
      // Next pass re-reads the last 7 days of transfers (dedup by id) and only newer trades.
      state: { lastTradeId: st.lastTradeId, nextPassFrom: Math.max(START, fx.now() - 7 * DAY) },
      progress: `Binance : ${st.deposits!.length} dépôts, ${st.withdrawals!.length} retraits, ${st.trades!.length} trades sur ${symbols.length} paires.`,
    };
  },
};
