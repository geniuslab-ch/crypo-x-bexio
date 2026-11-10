import { D } from '@/core/decimal';
import type { Movement, ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson, splitAddresses } from './http';
import { ConnectorError, type SourceConnector, type SyncState } from './types';

/**
 * Bitcoin public addresses through the mempool.space Esplora API (no key, read-only by nature).
 * Verified against the Esplora API reference (github.com/Blockstream/esplora/blob/master/API.md), 2026-11-10:
 * - GET /api/address/:address/txs/chain[/:last_seen_txid], confirmed only, 25 per page, newest first;
 * - tx: txid, fee (sats), vin[].prevout {scriptpubkey_address, value}, vout[] {scriptpubkey_address, value},
 *   status {confirmed, block_time}. Amounts are in satoshis.
 * All addresses of the source are treated as the same wallet: payments between them net to a network fee.
 * xpub/descriptor import is not available through this API.
 */
const BASE = 'https://mempool.space/api';
const SATS = new D(100_000_000);

interface Out { scriptpubkey_address?: string; value: number }
interface BtcTx { txid: string; fee: number; vin: { prevout?: Out | null }[]; vout: Out[]; status: { confirmed: boolean; block_time?: number | null } }

interface BtcState extends SyncState {
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

const ADDRESS = /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/;

export const bitcoinConnector: SourceConnector = {
  id: 'bitcoin_address_v1',
  version: 1,
  provider: 'bitcoin',
  label: 'Bitcoin — adresses publiques',
  kind: 'wallet',
  support: 'partial',
  fields: [{ name: 'addresses', label: 'Adresses Bitcoin publiques (une par ligne)', secret: false, multiline: true, placeholder: 'bc1q…' }],
  help: 'Copiez les adresses de réception de votre wallet (Ledger Live, Trezor Suite, BlueWallet…). Jamais de phrase de récupération ni de clé privée : elles ne sont pas nécessaires.',
  limits: 'Adresses une par une : l’import par xpub n’est pas encore disponible. Les wallets qui changent d’adresse à chaque réception demandent toutes les adresses utilisées. Données via mempool.space.',
  async verify(creds) {
    const list = splitAddresses(creds.addresses);
    if (list.length === 0) throw new ConnectorError('credentials_missing');
    const bad = list.filter((a) => !ADDRESS.test(a));
    if (bad.length) throw new ConnectorError('invalid_address', bad.slice(0, 3).join(', '));
    if (list.length > 200) throw new ConnectorError('too_many_addresses');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    await bitcoinConnector.verify(creds, fx);
    const addrs = splitAddresses(creds.addresses);
    const st: BtcState = { txs: {}, addrIndex: 0, lastSeen: null, newestSeen: {}, passNewest: {}, ...(raw as BtcState) };
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
    return { ...mapped, evidence: { addresses: addrs, transactions: txs }, complete: true,
      state: { newestSeen: { ...st.newestSeen, ...st.passNewest } },
      progress: `Bitcoin : ${txs.length} transactions sur ${addrs.length} adresse(s).` };
  },
};
