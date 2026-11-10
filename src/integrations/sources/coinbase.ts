import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { normalizeAsset } from '@/core/assets';
import { D } from '@/core/decimal';
import type { Classification, Movement, ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson } from './http';
import { ConnectorError, type FetchContext, type SourceConnector, type SyncState } from './types';

/**
 * Coinbase App read-only API with a CDP API key ("View" permission only).
 * Verified against docs.cdp.coinbase.com, 2026-11-10:
 * - JWT ES256, header {alg, kid: key name, nonce}, claims {iss: "cdp", sub: key name, nbf, exp: +120 s,
 *   uri: "<METHOD> api.coinbase.com<path>"}, one JWT per request, sent as Bearer. Ed25519 keys are not supported.
 * - GET /api/v3/brokerage/key_permissions → can_view, can_trade, can_transfer.
 * - GET /v2/accounts and GET /v2/accounts/:id/transactions with pagination.next_uri.
 * - Transaction: id, type, status, amount{amount,currency} (signed), native_amount, created_at, network{hash},
 *   advanced_trade_fill{order_id, product_id, fill_price, commission, order_side}; buy/sell/trade objects
 *   exist but their sub-fields are not documented, so we only read an `id` from them when present.
 * Each transaction is one leg on one account. Legs of the same trade are grouped (same buy/sell/trade id, or
 * same advanced-trade order and time); anything that cannot be paired stays a single leg for review.
 */
const HOST = 'api.coinbase.com';

interface Money { amount: string; currency: string }
interface CbTx {
  id: string; type: string; status: string; amount: Money; native_amount?: Money; created_at: string; description?: string | null;
  network?: { hash?: string; status?: string };
  buy?: { id?: string }; sell?: { id?: string }; trade?: { id?: string };
  advanced_trade_fill?: { order_id?: string; product_id?: string; fill_price?: string; commission?: string; order_side?: string };
}
interface Page<T> { data: T[]; pagination?: { next_uri?: string | null } }

interface CbState extends SyncState {
  accounts?: string[];
  accountIndex?: number;
  nextUri?: string | null;
  txs?: CbTx[];
}

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

export function coinbaseJwt(keyName: string, privateKeyPem: string, method: string, path: string, nowSec: number): string {
  const header = { alg: 'ES256', kid: keyName, nonce: randomBytes(16).toString('hex'), typ: 'JWT' };
  const payload = { iss: 'cdp', sub: keyName, nbf: nowSec, exp: nowSec + 120, uri: `${method} ${HOST}${path}` };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  let key;
  try {
    key = createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));
  } catch {
    throw new ConnectorError('credentials_invalid_format', 'clé privée EC (ES256) attendue');
  }
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

async function get<T>(fx: FetchContext, creds: Record<string, string>, pathWithQuery: string): Promise<T> {
  const path = pathWithQuery.split('?')[0]!;
  const jwt = coinbaseJwt(creds.keyName ?? '', creds.privateKey ?? '', 'GET', path, Math.floor(fx.now() / 1000));
  return requestJson<T>(fx, `https://${HOST}${pathWithQuery}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

const HINTS: Record<string, { c: Classification; conf: number }> = {
  fiat_deposit: { c: 'fiat_deposit', conf: 0.95 },
  fiat_withdrawal: { c: 'fiat_withdrawal', conf: 0.95 },
  staking_transfer: { c: 'internal_transfer', conf: 0.9 },
  unstaking_transfer: { c: 'internal_transfer', conf: 0.9 },
  earn_payout: { c: 'staking_reward', conf: 0.8 },
  incentives_rewards_payout: { c: 'airdrop', conf: 0.6 },
  send: { c: 'withdrawal', conf: 0.6 },
  receive: { c: 'deposit', conf: 0.6 },
};

function groupKey(t: CbTx): string {
  const id = t.buy?.id ?? t.sell?.id ?? t.trade?.id;
  if (id) return `${t.type}:${id}`;
  const f = t.advanced_trade_fill;
  if (f?.order_id) return `fill:${f.order_id}:${t.created_at}`;
  return `tx:${t.id}`;
}

export function mapCoinbase(txs: CbTx[]): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const groups = new Map<string, { legs: CbTx[]; idx: number[] }>();
  txs.forEach((t, i) => {
    if (t.status !== 'completed') return;
    const g = groups.get(groupKey(t)) ?? { legs: [], idx: [] };
    g.legs.push(t);
    g.idx.push(i + 1);
    groups.set(groupKey(t), g);
  });
  const transactions: ParsedTransaction[] = [];
  for (const [key, g] of groups) {
    const net = new Map<string, InstanceType<typeof D>>();
    let bad = false;
    for (const leg of g.legs) {
      let amt;
      try { amt = new D(leg.amount.amount); } catch { bad = true; break; }
      const asset = normalizeAsset(leg.amount.currency);
      net.set(asset, (net.get(asset) ?? new D(0)).plus(amt));
    }
    if (bad) { issues.push({ rowNumber: g.idx[0] ?? 0, message: `Transaction Coinbase ${g.legs[0]?.id} : montant illisible` }); continue; }
    const movements: Movement[] = [...net].filter(([, a]) => !a.isZero())
      .map(([asset, a]) => ({ direction: a.isPositive() ? 'in' as const : 'out' as const, asset, quantity: a.abs().toString() }));
    const first = g.legs.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
    const type = first.type;
    const hint = HINTS[type];
    const single = g.legs.length === 1;
    const chfLeg = g.legs.find((l) => l.native_amount?.currency === 'CHF' && !['CHF', 'EUR', 'USD', 'GBP'].includes(l.amount.currency));
    transactions.push({
      externalId: key, occurredAt: new Date(first.created_at), rawType: type, movements,
      raw: g.legs.map((l) => ({ id: l.id, type: l.type, status: l.status, amount: l.amount.amount, currency: l.amount.currency,
        native_amount: l.native_amount?.amount ?? '', native_currency: l.native_amount?.currency ?? '', created_at: l.created_at,
        description: l.description ?? '', hash: l.network?.hash ?? '', order_id: l.advanced_trade_fill?.order_id ?? '',
        product_id: l.advanced_trade_fill?.product_id ?? '', commission: l.advanced_trade_fill?.commission ?? '' })),
      rowNumbers: g.idx, txHash: g.legs.find((l) => l.network?.hash)?.network?.hash ?? null,
      hint: hint ? { classification: hint.c, confidence: hint.conf, reason: `Type Coinbase « ${type} »` }
        : single && ['buy', 'sell', 'trade', 'advanced_trade_fill'].includes(type)
          ? { classification: 'unknown', confidence: 0.3, reason: `Coinbase « ${type} » : une seule jambe trouvée, contrepartie à vérifier` }
          : null,
      sourceChfValue: chfLeg?.native_amount ? new D(chfLeg.native_amount.amount).abs().toString() : null,
      note: type === 'advanced_trade_fill' && first.advanced_trade_fill?.commission
        ? `Commission Coinbase ${first.advanced_trade_fill.commission} (devise de cotation, non déduite séparément : à vérifier)` : null,
    });
  }
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues };
}

export const coinbaseApiConnector: SourceConnector = {
  id: 'coinbase_api_v1',
  version: 1,
  provider: 'coinbase',
  label: 'Coinbase — API lecture seule',
  kind: 'exchange',
  support: 'partial',
  fields: [
    { name: 'keyName', label: 'Nom de la clé (organizations/…/apiKeys/…)', secret: false },
    { name: 'privateKey', label: 'Clé privée (-----BEGIN EC PRIVATE KEY-----…)', secret: true, multiline: true },
  ],
  help: 'Coinbase Developer Platform → API Keys → Créer une clé de type « Secret API key », algorithme ECDSA (pas Ed25519). Permission : « View » uniquement. Nous refusons toute clé avec Trade ou Transfer.',
  limits: 'Les sous-champs des achats/ventes ne sont pas documentés par Coinbase : les frais intégrés au prix ne sont pas séparés et une jambe non appariée est envoyée en revue.',
  async verify(creds, fx) {
    if (!creds.keyName || !creds.privateKey) throw new ConnectorError('credentials_missing');
    const p = await get<{ can_view?: boolean; can_trade?: boolean; can_transfer?: boolean }>(fx, creds, '/api/v3/brokerage/key_permissions');
    if (p.can_trade || p.can_transfer) throw new ConnectorError('api_key_not_read_only', [p.can_trade && 'trade', p.can_transfer && 'transfer'].filter(Boolean).join(', '));
    if (!p.can_view) throw new ConnectorError('api_key_cannot_read');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    await coinbaseApiConnector.verify(creds, fx);
    const st: CbState = { txs: [], ...(raw as CbState) };
    if (!st.accounts) {
      const ids: string[] = [];
      let uri: string | null | undefined = '/v2/accounts';
      while (uri) {
        const page: Page<{ id: string }> = await get(fx, creds, uri);
        ids.push(...page.data.map((a) => a.id));
        uri = page.pagination?.next_uri;
      }
      st.accounts = ids;
      st.accountIndex = 0;
      st.nextUri = null;
    }
    while ((st.accountIndex ?? 0) < st.accounts.length) {
      if (outOfTime(fx)) {
        return { transactions: [], issues: [], evidence: null, complete: false, state: st,
          progress: `Coinbase : comptes lus ${st.accountIndex}/${st.accounts.length} (${st.txs!.length} transactions) — relancez pour continuer.` };
      }
      const acc = st.accounts[st.accountIndex!]!;
      const page: Page<CbTx> = await get(fx, creds, st.nextUri ?? `/v2/accounts/${acc}/transactions`);
      st.txs!.push(...page.data);
      st.nextUri = page.pagination?.next_uri ?? null;
      if (!st.nextUri) st.accountIndex = st.accountIndex! + 1;
    }
    const mapped = mapCoinbase(st.txs!);
    // Coinbase lists newest first and documents no "since" filter: each pass re-reads the history;
    // already imported transactions are skipped by fingerprint.
    return { ...mapped, evidence: { transactions: st.txs }, complete: true, state: {},
      progress: `Coinbase : ${st.txs!.length} mouvements sur ${st.accounts.length} comptes.` };
  },
};
