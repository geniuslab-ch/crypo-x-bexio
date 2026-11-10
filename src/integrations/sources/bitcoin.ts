import { D } from '@/core/decimal';
import type { Movement, ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson, splitAddresses } from './http';
import { ConnectorError, type FetchContext, type SourceConnector, type SyncState } from './types';
import { addressTypesFor, deriveAddress, isExtendedPrivateKey, isExtendedPublicKey, parseExtendedKey, type AddressType } from './xpub';

/**
 * Bitcoin public addresses through the mempool.space Esplora API (no key, read-only by nature).
 * Verified against the Esplora API reference (github.com/Blockstream/esplora/blob/master/API.md), 2026-11-10:
 * - GET /api/address/:address/txs/chain[/:last_seen_txid], confirmed only, 25 per page, newest first;
 * - tx: txid, fee (sats), vin[].prevout {scriptpubkey_address, value}, vout[] {scriptpubkey_address, value},
 *   status {confirmed, block_time}. Amounts are in satoshis.
 * All addresses of the source are treated as the same wallet: payments between them net to a network fee.
 * - GET /api/address/:address -> chain_stats.tx_count, used to discover the addresses of an extended public key.
 * Extended public keys (xpub/ypub/zpub) are expanded locally (see xpub.ts): receive and change chains are scanned
 * until 20 consecutive unused addresses (BIP-44 gap limit).
 */
const GAP_LIMIT = 20;
const BASE = 'https://mempool.space/api';
const SATS = new D(100_000_000);

interface Out { scriptpubkey_address?: string; value: number }
interface BtcTx { txid: string; fee: number; vin: { prevout?: Out | null }[]; vout: Out[]; status: { confirmed: boolean; block_time?: number | null } }

interface ChainScan { next: number; gap: number; used: string[] }

interface BtcState extends SyncState {
  /** Discovery per extended key, address type and chain ("<key>|<type>|<chain>"). */
  scan?: Record<string, ChainScan>;
  addrIndex?: number;
  lastSeen?: string | null;
  txs?: Record<string, BtcTx>;
  /** Newest confirmed txid already read, per address: later passes stop there. */
  newestSeen?: Record<string, string>;
  passNewest?: Record<string, string>;
}

const btc = (sats: number | InstanceType<typeof D>) => new D(sats).div(SATS).toString();

export function mapBitcoin(addresses: string[], txs: BtcTx[]): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const own = new Set(addresses);
  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];
  txs.forEach((t, i) => {
    if (!t.status?.confirmed || !t.status.block_time) return;
    const ownInputs = t.vin.filter((v) => v.prevout?.scriptpubkey_address && own.has(v.prevout.scriptpubkey_address));
    const spent = ownInputs.reduce((a, v) => a.plus(v.prevout!.value), new D(0));
    const received = t.vout.filter((o) => o.scriptpubkey_address && own.has(o.scriptpubkey_address)).reduce((a, o) => a.plus(o.value), new D(0));
    const movements: Movement[] = [];
    let note: string | null = null;
    let hint: ParsedTransaction['hint'] = null;
    if (spent.isZero()) {
      if (received.isZero()) return;
      movements.push({ direction: 'in', asset: 'BTC', quantity: btc(received) });
    } else {
      const allInputsOwn = ownInputs.length === t.vin.length;
      const fee = allInputsOwn ? new D(t.fee) : new D(0);
      const sent = spent.minus(received).minus(fee);
      if (sent.gt(0)) movements.push({ direction: 'out', asset: 'BTC', quantity: btc(sent) });
      else if (sent.lt(0)) movements.push({ direction: 'in', asset: 'BTC', quantity: btc(sent.abs()) });
      if (fee.gt(0)) movements.push({ direction: 'fee', asset: 'BTC', quantity: btc(fee) });
      if (!allInputsOwn) {
        note = 'Transaction à plusieurs propriétaires (CoinJoin/PayJoin ?) : les frais ne sont pas attribués, à vérifier.';
        hint = { classification: 'unknown', confidence: 0.3, reason: 'Entrées appartenant à d’autres adresses : répartition à vérifier' };
      } else if (sent.isZero()) {
        hint = { classification: 'network_fee', confidence: 0.9, reason: 'Envoi entre vos propres adresses : seuls les frais de réseau sont une dépense' };
      }
    }
    if (movements.length === 0) return;
    transactions.push({
      externalId: t.txid, txHash: t.txid, occurredAt: new Date(t.status.block_time * 1000), rawType: spent.isZero() ? 'receive' : 'send',
      movements, raw: [{ txid: t.txid, fee_sats: String(t.fee), own_inputs_sats: spent.toString(), own_outputs_sats: received.toString() }],
      rowNumbers: [i + 1], note, hint,
    });
  });
  if (txs.some((t) => t.vin.some((v) => !v.prevout))) issues.push({ rowNumber: 0, message: 'Certaines entrées sans détail (coinbase de minage) : comptées comme reçues.' });
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues };
}

function splitEntries(raw: string | undefined): { addresses: string[]; xpubs: string[] } {
  const all = splitAddresses(raw);
  return { addresses: all.filter((a) => !isExtendedPublicKey(a)), xpubs: all.filter(isExtendedPublicKey) };
}

function scanKeys(xpubs: string[]): { id: string; xpub: string; type: AddressType; chain: 0 | 1 }[] {
  return xpubs.flatMap((xpub) => addressTypesFor(xpub).flatMap((type) => ([0, 1] as const).map((chain) => ({ id: `${xpub}|${type}|${chain}`, xpub, type, chain }))));
}

/** Discovers used addresses of the extended keys. Returns false when the run is out of time. */
async function discover(xpubs: string[], st: BtcState, fx: FetchContext): Promise<boolean> {
  for (const k of scanKeys(xpubs)) {
    const key = parseExtendedKey(k.xpub);
    const s = (st.scan![k.id] ??= { next: 0, gap: 0, used: [] });
    while (s.gap < GAP_LIMIT) {
      if (outOfTime(fx)) return false;
      const addr = deriveAddress(key, k.type, k.chain, s.next);
      const info = await requestJson<{ chain_stats: { tx_count: number } }>(fx, `${BASE}/address/${addr}`);
      if (info.chain_stats.tx_count > 0) { if (!s.used.includes(addr)) s.used.push(addr); s.gap = 0; } else s.gap += 1;
      s.next += 1;
      await fx.sleep(200);
    }
  }
  return true;
}

const ADDRESS = /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/;

export const bitcoinConnector: SourceConnector = {
  id: 'bitcoin_address_v1',
  version: 1,
  provider: 'bitcoin',
  label: 'Bitcoin — adresses publiques',
  kind: 'wallet',
  support: 'partial',
  fields: [{ name: 'addresses', label: 'Clé publique étendue (xpub, ypub, zpub) ou adresses Bitcoin, une par ligne', secret: false, multiline: true, placeholder: 'zpub6r… ou bc1q…' }],
  help: 'Le plus simple : la clé publique étendue du compte (Ledger Live : Compte → Modifier → Avancé ; Trezor Suite : Détails → Afficher la clé publique ; Sparrow/Electrum : Wallet → Informations). Toutes les adresses du wallet sont retrouvées automatiquement. Une xpub permet seulement de lire, jamais de dépenser. Jamais de phrase de récupération ni de clé privée (xprv).',
  limits: 'Recherche des adresses jusqu’à 20 adresses inutilisées de suite (règle standard des wallets). Une « xpub » simple est lue dans les trois formats d’adresses (bc1q, 3…, 1…). Taproot (bc1p) et les multisig ne sont pas encore pris en charge. Données via mempool.space.',
  async verify(creds) {
    const list = splitAddresses(creds.addresses);
    if (list.length === 0) throw new ConnectorError('credentials_missing');
    if (list.some(isExtendedPrivateKey)) throw new ConnectorError('private_key_refused');
    const bad = list.filter((a) => !ADDRESS.test(a) && !isExtendedPublicKey(a));
    if (bad.length) throw new ConnectorError('invalid_address', bad.slice(0, 3).join(', '));
    for (const x of list.filter(isExtendedPublicKey)) {
      try { parseExtendedKey(x); } catch { throw new ConnectorError('invalid_address', `${x.slice(0, 12)}…`); }
    }
    if (list.length > 200) throw new ConnectorError('too_many_addresses');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    await bitcoinConnector.verify(creds, fx);
    const { addresses, xpubs } = splitEntries(creds.addresses);
    const st: BtcState = { scan: {}, txs: {}, addrIndex: 0, lastSeen: null, newestSeen: {}, passNewest: {}, ...(raw as BtcState) };
    if (!(await discover(xpubs, st, fx))) {
      const found = Object.values(st.scan!).reduce((n, s) => n + s.used.length, 0);
      return { transactions: [], issues: [], evidence: null, complete: false, state: st,
        progress: `Bitcoin : recherche des adresses du wallet, ${found} adresse(s) utilisée(s) trouvée(s) — relancez pour continuer.` };
    }
    const derived = Object.values(st.scan!).flatMap((s) => s.used);
    const addrs = [...new Set([...addresses, ...derived])];
    while (st.addrIndex! < addrs.length) {
      if (outOfTime(fx)) {
        return { transactions: [], issues: [], evidence: null, complete: false, state: st,
          progress: `Bitcoin : adresses lues ${st.addrIndex}/${addrs.length} — relancez pour continuer.` };
      }
      const a = addrs[st.addrIndex!]!;
      const page = await requestJson<BtcTx[]>(fx, `${BASE}/address/${a}/txs/chain${st.lastSeen ? `/${st.lastSeen}` : ''}`);
      if (!st.lastSeen && page[0]) st.passNewest![a] = page[0].txid;
      let reachedKnown = false;
      for (const t of page) {
        if (t.txid === st.newestSeen![a]) { reachedKnown = true; break; }
        st.txs![t.txid] = t;
      }
      if (page.length < 25 || reachedKnown) {
        st.addrIndex = st.addrIndex! + 1;
        st.lastSeen = null;
      } else {
        st.lastSeen = page[page.length - 1]!.txid;
      }
      await fx.sleep(300);
    }
    const txs = Object.values(st.txs!);
    const mapped = mapBitcoin(addrs, txs);
    // Next pass resumes discovery after the last address found, with a fresh gap window.
    const scan = Object.fromEntries(Object.entries(st.scan!).map(([id, s]) => {
      const lastUsed = s.next - s.gap - 1;
      return [id, { next: lastUsed + 1, gap: 0, used: s.used }];
    }));
    return { ...mapped, evidence: { addresses: addrs, extendedKeys: xpubs.length, transactions: txs }, complete: true,
      state: { newestSeen: { ...st.newestSeen, ...st.passNewest }, scan },
      progress: `Bitcoin : ${txs.length} transactions sur ${addrs.length} adresse(s).` };
  },
};
