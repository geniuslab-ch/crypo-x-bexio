import { D } from '@/core/decimal';
import type { ParsedTransaction, ParseIssue } from '@/core/types';
import { requestJson, splitAddresses } from './http';
import { ConnectorError, type SourceConnector } from './types';

/**
 * Cardano staking rewards through the public Koios API (no key on the public tier).
 * Verified against the Koios OpenAPI spec (koios-artifacts/specs/results/koiosapi-mainnet.yaml), 2026-11-10:
 * - POST /api/v1/account_reward_history { _stake_addresses: [...] } -> [{ stake_address, earned_epoch,
 *   spendable_epoch, amount, type: member|leader|treasury|reserves|refund, pool_id_bech32 }];
 * - POST /api/v1/address_info { _addresses: [...] } -> [{ address, stake_address, ... }];
 * - results are paginated by 1000 rows (offset/limit query parameters); request bodies are limited to 1 kB;
 *   burst limit 100 requests per 10 s.
 * Amounts are in lovelace (1 ADA = 1 000 000 lovelace). Epochs last 5 days: epoch 0 started at 1506203091
 * (spec example of /epoch_info), so epoch N starts at 1506203091 + N × 432000.
 * A reward is counted as received at the start of its spendable epoch, when it is credited to the account.
 */
const BASE = 'https://api.koios.rest/api/v1';
const LOVELACE = new D(1_000_000);
const EPOCH0 = 1506203091;
const EPOCH_SECONDS = 432000;
const BATCH = 10;

interface Reward { stake_address: string; earned_epoch: number; spendable_epoch: number; amount: string; type: string; pool_id_bech32?: string | null }

export const epochStart = (n: number) => new Date((EPOCH0 + n * EPOCH_SECONDS) * 1000);

export function mapCardano(rewards: Reward[], now: number): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const transactions: ParsedTransaction[] = [];
  const issues: ParseIssue[] = [];
  rewards.forEach((r, i) => {
    const at = epochStart(r.spendable_epoch);
    if (at.getTime() > now) return; // not credited yet
    const q = new D(r.amount || '0');
    if (!q.isFinite() || q.lte(0)) return;
    const staking = r.type === 'member' || r.type === 'leader';
    transactions.push({
      externalId: `ada:${r.stake_address}:${r.earned_epoch}:${r.type}:${r.pool_id_bech32 ?? ''}`,
      occurredAt: at, rawType: `reward:${r.type}`,
      movements: [{ direction: 'in', asset: 'ADA', quantity: q.div(LOVELACE).toString() }],
      raw: [Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]))],
      rowNumbers: [i + 1],
      note: `Époque gagnée ${r.earned_epoch}, disponible à l’époque ${r.spendable_epoch}${r.pool_id_bech32 ? `, pool ${r.pool_id_bech32}` : ''}`,
      hint: staking
        ? { classification: 'staking_reward', confidence: 0.9, reason: 'Récompense de délégation Cardano' }
        : r.type === 'refund'
          ? { classification: 'unknown', confidence: 0.3, reason: 'Remboursement de dépôt (pool ou enregistrement) : pas un revenu, à vérifier' }
          : { classification: 'unknown', confidence: 0.4, reason: 'Paiement du trésor ou des réserves Cardano (Catalyst, MIR) : à qualifier' },
    });
  });
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues };
}

const STAKE = /^stake1[02-9ac-hj-np-z]{50,60}$/;
const PAYMENT = /^addr1[02-9ac-hj-np-z]{50,110}$/;

async function post<T>(fx: Parameters<SourceConnector['sync']>[2], path: string, body: unknown): Promise<T> {
  return requestJson<T>(fx, `${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
}

export const cardanoConnector: SourceConnector = {
  id: 'cardano_staking_v1',
  version: 1,
  provider: 'cardano',
  label: 'Cardano — staking (wallet)',
  kind: 'wallet',
  support: 'partial',
  fields: [{ name: 'addresses', label: 'Adresse de staking (stake1…) ou une adresse de réception (addr1…) par wallet', secret: false, multiline: true, placeholder: 'stake1u…' }],
  help: 'Dans Yoroi, Eternl, Lace ou Daedalus, copiez l’adresse de staking (stake1…) ou une adresse de réception : l’adresse de staking en est déduite. Jamais de phrase de récupération.',
  limits: 'Lit les récompenses de délégation ADA (date : début de l’époque où elles deviennent disponibles). Les envois et réceptions du wallet ne sont pas encore lus : importez-les depuis la plateforme d’origine ou par CSV. Données via Koios.',
  async verify(creds) {
    const list = splitAddresses(creds.addresses);
    if (list.length === 0) throw new ConnectorError('credentials_missing');
    const bad = list.filter((a) => !STAKE.test(a) && !PAYMENT.test(a));
    if (bad.length) throw new ConnectorError('invalid_address', bad.slice(0, 3).join(', '));
    if (list.length > 50) throw new ConnectorError('too_many_addresses');
    return { readOnly: 'verified' };
  },
  async sync(creds, _state, fx) {
    await cardanoConnector.verify(creds, fx);
    const list = splitAddresses(creds.addresses);
    const stake = new Set(list.filter((a) => STAKE.test(a)));
    const payments = list.filter((a) => PAYMENT.test(a));
    for (let i = 0; i < payments.length; i += BATCH) {
      const info = await post<{ address: string; stake_address: string | null }[]>(fx, '/address_info', { _addresses: payments.slice(i, i + BATCH) });
      for (const a of info) if (a.stake_address) stake.add(a.stake_address);
      await fx.sleep(200);
    }
    const issues: ParseIssue[] = [];
    if (stake.size === 0) issues.push({ rowNumber: 0, message: 'Aucune adresse de staking trouvée : le wallet n’a peut-être jamais délégué.' });
    const rewards: Reward[] = [];
    const stakes = [...stake];
    for (let i = 0; i < stakes.length; i += BATCH) {
      for (let offset = 0; ; offset += 1000) {
        const page = await post<Reward[]>(fx, `/account_reward_history?offset=${offset}&limit=1000`, { _stake_addresses: stakes.slice(i, i + BATCH) });
        rewards.push(...page);
        await fx.sleep(200);
        if (page.length < 1000) break;
      }
    }
    const mapped = mapCardano(rewards, fx.now());
    return { transactions: mapped.transactions, issues: [...issues, ...mapped.issues], evidence: { stakeAddresses: stakes, rewards }, complete: true, state: {},
      progress: `Cardano : ${mapped.transactions.length} récompense(s) sur ${stakes.length} compte(s) de staking.` };
  },
};
