import { D } from '@/core/decimal';
import type { ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson, splitAddresses } from './http';
import { ConnectorError, type FetchContext, type SourceConnector, type SyncState } from './types';

/**
 * Solana native staking rewards through the public JSON-RPC (solana.com/docs/rpc), 2026-11-10:
 * - getEpochInfo -> { epoch, ... } (current epoch);
 * - getInflationReward(addresses[], { epoch }) -> per address null or { epoch, effectiveSlot, amount, postBalance,
 *   commission }; the reward for epoch E is credited at effectiveSlot, at the start of epoch E+1;
 * - getBlockTime(slot) -> Unix time in seconds.
 * Amounts are in lamports (1 SOL = 10^9 lamports). The server may set SOLANA_RPC_URL to a dedicated RPC provider.
 * History is read backwards from the last finished epoch; reading stops after STOP_AFTER_EMPTY epochs in a row
 * without any reward for the given stake accounts, or at epochs the node no longer serves.
 */
const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';
const LAMPORTS = new D(1_000_000_000);
const STOP_AFTER_EMPTY = 30;

interface Reward { epoch: number; effectiveSlot: number; amount: number; postBalance: number; commission: number | null }
interface Found { address: string; epoch: number; slot: number; amount: string; postBalance: string; commission: string; time: number }

interface SolState extends SyncState {
  /** Last epoch already imported (next passes stop there). */
  doneUpTo?: number;
  /** Pass in progress. */
  topEpoch?: number;
  cursor?: number;
  empty?: number;
  found?: Found[];
}

async function rpc<T>(fx: FetchContext, method: string, params: unknown[]): Promise<T> {
  const url = fx.env.SOLANA_RPC_URL || PUBLIC_RPC;
  const r = await requestJson<{ result?: T; error?: { code: number; message: string } }>(fx, url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (r.error) throw new ConnectorError('provider_error', `${method}: ${r.error.code} ${r.error.message}`.slice(0, 200));
  return r.result as T;
}

export function mapSolana(found: Found[]): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const transactions = found.filter((f) => new D(f.amount).gt(0)).map((f, i): ParsedTransaction => ({
    externalId: `sol:${f.address}:${f.epoch}`,
    occurredAt: new Date(f.time * 1000), rawType: 'inflation_reward',
    movements: [{ direction: 'in', asset: 'SOL', quantity: new D(f.amount).div(LAMPORTS).toString() }],
    raw: [{ ...f, time: String(f.time), epoch: String(f.epoch), slot: String(f.slot) }],
    rowNumbers: [i + 1],
    note: `Compte de staking ${f.address}, époque ${f.epoch}`,
    hint: { classification: 'staking_reward', confidence: 0.9, reason: 'Récompense de staking Solana (inflation)' },
  }));
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues: [] };
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const solanaConnector: SourceConnector = {
  id: 'solana_staking_v1',
  version: 1,
  provider: 'solana',
  label: 'Solana — staking (wallet)',
  kind: 'wallet',
  support: 'partial',
  fields: [{ name: 'addresses', label: 'Adresses des comptes de staking Solana (une par ligne)', secret: false, multiline: true, placeholder: 'Stake account…' }],
  help: 'Dans Phantom, Solflare ou Ledger Live, ouvrez la position de staking et copiez l’adresse du compte de staking (pas celle du validateur). Jamais de phrase de récupération.',
  limits: 'Lit les récompenses de staking natif SOL, époque par époque (environ 2 jours chacune) : un long historique demande plusieurs synchronisations. Le staking liquide (mSOL, JitoSOL…) et les envois/réceptions du wallet ne sont pas encore lus. Le RPC public peut ne pas servir les époques très anciennes.',
  async verify(creds) {
    const list = splitAddresses(creds.addresses);
    if (list.length === 0) throw new ConnectorError('credentials_missing');
    const bad = list.filter((a) => !ADDRESS.test(a));
    if (bad.length) throw new ConnectorError('invalid_address', bad.slice(0, 3).join(', '));
    if (list.length > 50) throw new ConnectorError('too_many_addresses');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    await solanaConnector.verify(creds, fx);
    const addrs = splitAddresses(creds.addresses);
    const st: SolState = { found: [], empty: 0, ...(raw as SolState) };
    const issues: ParseIssue[] = [];
    if (st.topEpoch === undefined) {
      const info = await rpc<{ epoch: number }>(fx, 'getEpochInfo', []);
      st.topEpoch = info.epoch - 1; // last finished epoch
      st.cursor = st.topEpoch;
      st.empty = 0;
      st.found = [];
    }
    const floor = st.doneUpTo ?? -1;
    const times = new Map<number, number>();
    while (st.cursor! > floor && (st.doneUpTo !== undefined || st.empty! < STOP_AFTER_EMPTY)) {
      if (outOfTime(fx)) {
        return { transactions: [], issues: [], evidence: null, complete: false, state: st,
          progress: `Solana : époque ${st.cursor} lue, ${st.found!.length} récompense(s) trouvée(s) — relancez pour continuer.` };
      }
      let rewards: (Reward | null)[];
      try {
        rewards = await rpc<(Reward | null)[]>(fx, 'getInflationReward', [addrs, { epoch: st.cursor }]);
      } catch (e) {
        if (e instanceof ConnectorError && e.code === 'provider_error' && st.found!.length > 0) {
          issues.push({ rowNumber: 0, message: `Le serveur RPC ne fournit pas l’époque ${st.cursor} et les précédentes : historique arrêté là.` });
          break;
        }
        throw e;
      }
      let any = false;
      for (let i = 0; i < addrs.length; i++) {
        const r = rewards[i];
        if (!r || !r.amount) continue;
        any = true;
        let time = times.get(r.effectiveSlot);
        if (time === undefined) {
          time = await rpc<number>(fx, 'getBlockTime', [r.effectiveSlot]);
          times.set(r.effectiveSlot, time);
        }
        st.found!.push({ address: addrs[i]!, epoch: r.epoch, slot: r.effectiveSlot, amount: String(r.amount), postBalance: String(r.postBalance), commission: String(r.commission ?? ''), time });
      }
      st.empty = any ? 0 : st.empty! + 1;
      st.cursor = st.cursor! - 1;
      await fx.sleep(150);
    }
    const mapped = mapSolana(st.found!);
    return { transactions: mapped.transactions, issues, evidence: { addresses: addrs, rewards: st.found }, complete: true,
      state: { doneUpTo: st.topEpoch },
      progress: `Solana : ${mapped.transactions.length} récompense(s) jusqu’à l’époque ${st.topEpoch}.` };
  },
};
