import { D } from '@/core/decimal';
import type { Movement, ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson, splitAddresses } from './http';
import { ConnectorError, type FetchContext, type SourceConnector, type SyncState } from './types';

/**
 * Ethereum public addresses through the Etherscan API V2 (server key ETHERSCAN_API_KEY, free tier).
 * Verified against docs.etherscan.io, 2026-11-10:
 * - GET https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist|tokentx&address=…
 *   &startblock&endblock&page&offset&sort=asc&apikey=…
 * - txlist: hash, timeStamp (s), from, to, value (wei), gasPrice, gasUsed, isError, blockNumber
 * - tokentx: hash, timeStamp, from, to, value (smallest unit), contractAddress, tokenSymbol, tokenDecimal
 * - action=txlistinternal (ETH sent by contracts, e.g. exchange withdrawals) uses the same fields as txlist.
 * Token symbols can be faked by spam contracts, so only a short list of well-known contracts keeps its plain
 * symbol; any other token is named SYMBOL.<contract prefix> and sent to review.
 */
const BASE = 'https://api.etherscan.io/v2/api';
const PAGE = 1000;
const WEI = new D(10).pow(18);

/** Ethereum mainnet contracts of major tokens (lower-case). */
export const KNOWN_TOKENS: Record<string, string> = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'AAVE',
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 'SHIB',
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': 'PEPE',
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'STETH',
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'MATIC',
};

interface EthTx { hash: string; timeStamp: string; from: string; to: string; value: string; gasPrice?: string; gasUsed?: string; isError?: string; blockNumber: string }
interface TokenTx extends EthTx { contractAddress: string; tokenSymbol: string; tokenDecimal: string }
interface EsResponse<T> { status: string; message: string; result: T[] | string }
type Action = 'txlist' | 'txlistinternal' | 'tokentx';
const ACTIONS: Action[] = ['txlist', 'txlistinternal', 'tokentx'];

interface EthState extends SyncState {
  addrIndex?: number;
  actionIndex?: number;
  startBlock?: number;
  records?: Record<string, (EthTx | TokenTx) & { kind: Action }>;
  /** Next start block per address and action for the following pass. */
  nextBlock?: Record<string, number>;
}

async function call<T>(fx: FetchContext, params: Record<string, string>): Promise<T[]> {
  const key = fx.env.ETHERSCAN_API_KEY;
  if (!key) throw new ConnectorError('etherscan_not_configured');
  const q = new URLSearchParams({ chainid: '1', module: 'account', sort: 'asc', page: '1', offset: String(PAGE), ...params, apikey: key });
  const r = await requestJson<EsResponse<T>>(fx, `${BASE}?${q.toString()}`);
  if (Array.isArray(r.result)) return r.result;
  if (/no transactions found/i.test(r.message) || /no transactions found/i.test(String(r.result))) return [];
  if (/rate limit/i.test(String(r.result))) throw new ConnectorError('rate_limited', String(r.result));
  if (/invalid api key/i.test(String(r.result))) throw new ConnectorError('etherscan_not_configured', String(r.result));
  throw new ConnectorError('provider_error', `${r.message}: ${String(r.result).slice(0, 120)}`);
}

function tokenAsset(t: TokenTx): { asset: string; known: boolean } {
  const c = t.contractAddress.toLowerCase();
  const known = KNOWN_TOKENS[c];
  if (known) return { asset: known, known: true };
  const sym = (t.tokenSymbol || 'TOKEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TOKEN';
  return { asset: `${sym}.${c.slice(2, 8)}`, known: false };
}

export function mapEthereum(addresses: string[], records: ((EthTx | TokenTx) & { kind: Action })[]): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const own = new Set(addresses.map((a) => a.toLowerCase()));
  const byHash = new Map<string, ((EthTx | TokenTx) & { kind: Action })[]>();
  for (const r of records) byHash.set(r.hash, [...(byHash.get(r.hash) ?? []), r]);
  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];
  let idx = 0;
  for (const [hash, rs] of byHash) {
    idx++;
    const net = new Map<string, InstanceType<typeof D>>();
    const add = (asset: string, q: InstanceType<typeof D>) => net.set(asset, (net.get(asset) ?? new D(0)).plus(q));
    let fee = new D(0);
    let unknownToken = false;
    let failed = false;
    for (const r of rs) {
      const from = r.from.toLowerCase();
      const to = (r.to ?? '').toLowerCase();
      if (r.kind === 'tokentx') {
        const t = r as TokenTx;
        const dec = Number(t.tokenDecimal);
        if (!Number.isInteger(dec) || dec < 0 || dec > 36) { issues.push({ rowNumber: idx, message: `Jeton ${t.contractAddress} : décimales illisibles` }); continue; }
        const { asset, known } = tokenAsset(t);
        const q = new D(t.value).div(new D(10).pow(dec));
        if (!known) unknownToken = true;
        if (own.has(to)) add(asset, q);
        if (own.has(from)) add(asset, q.neg());
      } else {
        const ok = r.isError !== '1';
        if (!ok) failed = true;
        const q = new D(r.value || '0').div(WEI);
        if (ok && own.has(to)) add('ETH', q);
        if (ok && own.has(from)) add('ETH', q.neg());
        // The sender of an external transaction pays gas, even when it fails.
        if (r.kind === 'txlist' && own.has(from) && r.gasUsed && r.gasPrice) fee = fee.plus(new D(r.gasUsed).times(r.gasPrice).div(WEI));
      }
    }
    const movements: Movement[] = [...net].filter(([, q]) => !q.isZero())
      .map(([asset, q]) => ({ direction: q.isPositive() ? 'in' as const : 'out' as const, asset, quantity: q.abs().toString() }));
    if (fee.gt(0)) movements.push({ direction: 'fee', asset: 'ETH', quantity: fee.toString() });
    if (movements.length === 0) continue;
    const onlyFee = movements.every((m) => m.direction === 'fee');
    const ts = Math.min(...rs.map((r) => Number(r.timeStamp)));
    transactions.push({
      externalId: hash, txHash: hash, occurredAt: new Date(ts * 1000),
      rawType: [...new Set(rs.map((r) => r.kind))].join('+') + (failed ? ':failed' : ''), movements,
      raw: rs.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !['input', 'logs'].includes(k)).map(([k, v]) => [k, String(v ?? '')]))),
      rowNumbers: [idx],
      hint: unknownToken
        ? { classification: 'unknown', confidence: 0.2, reason: 'Jeton non reconnu (souvent du spam envoyé gratuitement) : à vérifier' }
        : failed && onlyFee ? { classification: 'network_fee', confidence: 0.95, reason: 'Transaction échouée : seuls les frais de gas ont été payés' }
          : onlyFee ? { classification: 'network_fee', confidence: 0.7, reason: 'Interaction de contrat sans mouvement de vos actifs : frais de gas' } : null,
      note: rs.some((r) => r.kind !== 'tokentx' && r.to === '') ? 'Création de contrat' : null,
    });
  }
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues };
}

export const ethereumConnector: SourceConnector = {
  id: 'ethereum_address_v1',
  version: 1,
  provider: 'ethereum',
  label: 'Ethereum — adresses publiques',
  kind: 'wallet',
  support: 'partial',
  fields: [{ name: 'addresses', label: 'Adresses Ethereum publiques 0x… (une par ligne)', secret: false, multiline: true, placeholder: '0x…' }],
  help: 'Copiez l’adresse publique de votre wallet (MetaMask, Ledger, Trezor, Rabby…). Jamais de phrase de récupération ni de clé privée.',
  limits: 'Réseau Ethereum principal : ETH, jetons ERC-20 et ETH reçus de contrats. Pas encore : NFT, autres réseaux (Arbitrum, Base, Polygon…) ni interprétation DeFi (swaps, pools) : ces opérations arrivent en revue.',
  async verify(creds, fx) {
    const list = splitAddresses(creds.addresses);
    if (list.length === 0) throw new ConnectorError('credentials_missing');
    const bad = list.filter((a) => !/^0x[0-9a-fA-F]{40}$/.test(a));
    if (bad.length) throw new ConnectorError('invalid_address', bad.slice(0, 3).join(', '));
    if (list.length > 50) throw new ConnectorError('too_many_addresses');
    if (!fx.env.ETHERSCAN_API_KEY) throw new ConnectorError('etherscan_not_configured');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    await ethereumConnector.verify(creds, fx);
    const addrs = splitAddresses(creds.addresses).map((a) => a.toLowerCase());
    const st: EthState = { addrIndex: 0, actionIndex: 0, records: {}, nextBlock: {}, ...(raw as EthState) };
    while (st.addrIndex! < addrs.length) {
      const a = addrs[st.addrIndex!]!;
      const action = ACTIONS[st.actionIndex!]!;
      if (outOfTime(fx)) {
        return { transactions: [], issues: [], evidence: null, complete: false, state: st,
          progress: `Ethereum : adresse ${st.addrIndex! + 1}/${addrs.length}, ${Object.keys(st.records!).length} opérations lues — relancez pour continuer.` };
      }
      const key = `${a}:${action}`;
      const start = st.startBlock ?? st.nextBlock![key] ?? 0;
      const rows = await call<EthTx | TokenTx>(fx, { action, address: a, startblock: String(start), endblock: '999999999' });
      for (const r of rows) {
        const logIndex = (r as { logIndex?: string }).logIndex ?? (r as { traceId?: string }).traceId ?? '';
        st.records![`${action}:${r.hash}:${logIndex}:${r.from}:${r.to}:${r.value}`] = { ...r, kind: action };
      }
      const last = rows.at(-1);
      if (rows.length === PAGE && last) {
        // Continue from the last block (inclusive); records are keyed, so the overlap is harmless.
        st.startBlock = Number(last.blockNumber);
      } else {
        st.nextBlock![key] = last ? Number(last.blockNumber) : start;
        st.startBlock = undefined;
        st.actionIndex = st.actionIndex! + 1;
        if (st.actionIndex! >= ACTIONS.length) { st.actionIndex = 0; st.addrIndex = st.addrIndex! + 1; }
      }
      await fx.sleep(250); // free tier: 5 calls per second
    }
    const records = Object.values(st.records!);
    const mapped = mapEthereum(addrs, records);
    return { ...mapped, evidence: { addresses: addrs, records }, complete: true, state: { nextBlock: st.nextBlock },
      progress: `Ethereum : ${mapped.transactions.length} transactions sur ${addrs.length} adresse(s).` };
  },
};
