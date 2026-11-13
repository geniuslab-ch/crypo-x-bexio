import { sha224 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base32nopad } from '@scure/base';
import { D } from '@/core/decimal';
import type { Movement, ParsedTransaction, ParseIssue } from '@/core/types';
import { outOfTime, requestJson, splitAddresses } from './http';
import { ConnectorError, type SourceConnector, type SyncState } from './types';

/**
 * Internet Computer: native ICP (ICP Ledger API) and the OGY token (ICRC Token API), public, no key.
 * Checked against the published OpenAPI specs and live responses, 2026-11-10:
 * - ICP: GET https://ledger-api.internetcomputer.org/accounts/{account_identifier}/transactions?limit≤100&offset
 *   -> { total, blocks: [{ block_height, transaction_hash, from_account_identifier, to_account_identifier,
 *   transfer_type: send|mint|burn|approve, amount, fee, created_at (Unix s) }] }, newest first. Amounts in e8s
 *   (the standard 0.0001 ICP fee reads "10000").
 * - OGY: GET https://icrc-api.internetcomputer.org/api/v1/ledgers/lkwrt-vyaaa-aaaaq-aadhq-cai/accounts/{principal}
 *   /transactions?limit≤100&offset -> { data: [{ index, kind: transfer|mint|burn|approve, from_owner, to_owner,
 *   amount, fee, timestamp (ns) }], total_transactions }, newest first. OGY has 8 decimals (ledger metadata).
 * NNS staking: maturity paid out to an account arrives as a mint; it is proposed as staking income for review.
 */
const ICP_API = 'https://ledger-api.internetcomputer.org';
const ICRC_API = 'https://icrc-api.internetcomputer.org/api/v1';
const OGY_LEDGER = 'lkwrt-vyaaa-aaaaq-aadhq-cai';
const E8S = new D(100_000_000);
const PAGE = 100;

interface IcpBlock { block_height: string; transaction_hash: string; from_account_identifier: string | null; to_account_identifier: string | null; transfer_type: string; amount: string; fee: string | null; created_at: number; suspicious?: number | null; from_account_suspicious?: boolean | null }
interface IcrcTx { index: number; transaction_hash?: string; kind: string; from_owner: string | null; to_owner: string | null; amount: string; fee: string | null; timestamp: number | string }

type Target = { kind: 'icp'; id: string } | { kind: 'ogy'; id: string };
interface IcpState extends SyncState {
  index?: number;
  offset?: number;
  records?: Record<string, { target: string; kind: 'icp' | 'ogy'; rec: IcpBlock | IcrcTx }>;
  /** Newest record already read, per target. */
  newestSeen?: Record<string, string>;
  passNewest?: Record<string, string>;
}

const ACCOUNT_ID = /^[0-9a-f]{64}$/;
const PRINCIPAL = /^[a-z0-9]{5}(-[a-z0-9]{5}){3,9}(-[a-z0-9]{1,5})?$/;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * ICP Account ID of a principal's default subaccount (ICP ledger spec): crc32(h) || h,
 * h = sha224(0x0A || "account-id" || principal bytes || 32 zero bytes).
 */
export function accountIdOfPrincipal(principal: string): string {
  const raw = base32nopad.decode(principal.replace(/-/g, '').toUpperCase());
  const h = sha224(new Uint8Array([0x0a, ...new TextEncoder().encode('account-id'), ...raw.slice(4), ...new Uint8Array(32)]));
  const c = crc32(h);
  return bytesToHex(new Uint8Array([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, ...h]));
}

/** A Principal is read on the OGY ledger and, through its default Account ID, on the ICP ledger. */
function targets(raw: string | undefined): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  const add = (t: Target) => { if (!seen.has(`${t.kind}:${t.id}`)) { seen.add(`${t.kind}:${t.id}`); out.push(t); } };
  for (const a of splitAddresses(raw)) {
    if (ACCOUNT_ID.test(a.toLowerCase())) add({ kind: 'icp', id: a.toLowerCase() });
    else { add({ kind: 'ogy', id: a }); add({ kind: 'icp', id: accountIdOfPrincipal(a) }); }
  }
  return out;
}

const units = (v: string | null | undefined) => new D(v || '0').div(E8S);

export function mapIcp(own: Target[], records: { kind: 'icp' | 'ogy'; rec: IcpBlock | IcrcTx }[]): { transactions: ParsedTransaction[]; issues: ParseIssue[] } {
  const ownIcp = new Set(own.filter((t) => t.kind === 'icp').map((t) => t.id));
  const ownOgy = new Set(own.filter((t) => t.kind === 'ogy').map((t) => t.id));
  const transactions: ParsedTransaction[] = [];
  const seen = new Set<string>();
  records.forEach(({ kind, rec }, i) => {
    const asset = kind === 'icp' ? 'ICP' : 'OGY';
    let id: string; let type: string; let from: string | null; let to: string | null; let at: Date;
    if (kind === 'icp') {
      const b = rec as IcpBlock;
      id = `icp:${b.block_height}`; type = b.transfer_type; from = b.from_account_identifier; to = b.to_account_identifier; at = new Date(b.created_at * 1000);
    } else {
      const t = rec as IcrcTx;
      id = `ogy:${t.index}`; type = t.kind; from = t.from_owner; to = t.to_owner; at = new Date(Number(BigInt(String(t.timestamp)) / 1_000_000n));
    }
    if (seen.has(id)) return;
    seen.add(id);
    const mine = kind === 'icp' ? ownIcp : ownOgy;
    const fromMe = !!from && mine.has(from);
    const toMe = !!to && mine.has(to);
    const amount = units(rec.amount);
    const fee = units(rec.fee);
    const movements: Movement[] = [];
    if (type !== 'approve') {
      if (fromMe && !toMe && amount.gt(0)) movements.push({ direction: 'out', asset, quantity: amount.toString() });
      if (toMe && !fromMe && amount.gt(0)) movements.push({ direction: 'in', asset, quantity: amount.toString() });
    }
    if (fromMe && fee.gt(0)) movements.push({ direction: 'fee', asset, quantity: fee.toString() });
    if (movements.length === 0) return;
    const suspicious = kind === 'icp' && toMe && !fromMe && ((rec as IcpBlock).from_account_suspicious || ((rec as IcpBlock).suspicious ?? 0) > 0);
    let hint: ParsedTransaction['hint'] = null;
    if (type === 'mint' && toMe) hint = { classification: 'staking_reward', confidence: 0.6, reason: `${asset} créés (mint) vers votre compte : récompense de staking (maturité NNS) probable, à confirmer` };
    else if (type === 'burn') hint = { classification: 'unknown', confidence: 0.3, reason: `${asset} détruits (burn), par exemple conversion en cycles : à qualifier` };
    else if (type === 'approve') hint = { classification: 'network_fee', confidence: 0.9, reason: 'Autorisation (approve) : seuls les frais sont payés' };
    else if (fromMe && toMe) hint = { classification: 'network_fee', confidence: 0.9, reason: 'Envoi entre vos propres comptes : seuls les frais sont une dépense' };
    else if (suspicious) hint = { classification: 'unknown', confidence: 0.2, reason: 'Expéditeur signalé comme suspect par le tableau de bord ICP (souvent du spam) : à vérifier' };
    transactions.push({
      externalId: id, txHash: (rec as { transaction_hash?: string }).transaction_hash ?? null, occurredAt: at, rawType: `${kind}:${type}`,
      movements, raw: [Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'token_value').map(([k, v]) => [k, String(v ?? '')]))], rowNumbers: [i + 1], hint,
    });
  });
  transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions, issues: [] };
}

export const icpConnector: SourceConnector = {
  id: 'icp_ledger_v1',
  version: 1,
  provider: 'icp',
  label: 'Internet Computer — ICP et OGY',
  kind: 'wallet',
  support: 'partial',
  fields: [{ name: 'addresses', label: 'Principal ID (lit OGY et ICP) et/ou Account ID ICP (64 caractères), un par ligne', secret: false, multiline: true, placeholder: 'd3e1… ou abcde-…-cai' }],
  help: 'ICP et OGY sont deux registres différents : un Principal ID (xxxxx-xxxxx-…-cai) est lu sur les deux (OGY directement, ICP via son Account ID par défaut). Un Account ID de 64 caractères ne sert que pour ICP (par exemple un compte NNS ou un sous-compte). Un wallet par ligne, ou une source par wallet si chacun a son compte bexio. Jamais de phrase de récupération.',
  limits: 'Lit les mouvements ICP et OGY. Les récompenses NNS sont reconnues quand la maturité est versée sur un compte (création de jetons) et passent en revue. Le blocage d’ICP dans un neurone apparaît comme un envoi : confirmez-le comme transfert interne. Les sous-comptes OGY d’un Principal sont regroupés ; pour les ICP d’un sous-compte, ajoutez son Account ID. Les autres jetons ICRC ne sont pas encore lus. Données : tableau de bord officiel ICP.',
  async verify(creds) {
    const list = splitAddresses(creds.addresses);
    if (list.length === 0) throw new ConnectorError('credentials_missing');
    const bad = list.filter((a) => !ACCOUNT_ID.test(a.toLowerCase()) && !PRINCIPAL.test(a));
    if (bad.length) throw new ConnectorError('invalid_address', bad.slice(0, 3).join(', '));
    if (list.length > 50) throw new ConnectorError('too_many_addresses');
    return { readOnly: 'verified' };
  },
  async sync(creds, raw, fx) {
    await icpConnector.verify(creds, fx);
    const list = targets(creds.addresses);
    const st: IcpState = { index: 0, offset: 0, records: {}, newestSeen: {}, passNewest: {}, ...(raw as IcpState) };
    while (st.index! < list.length) {
      if (outOfTime(fx)) {
        return { transactions: [], issues: [], evidence: null, complete: false, state: st,
          progress: `ICP : compte ${st.index! + 1}/${list.length}, ${Object.keys(st.records!).length} opérations lues — relancez pour continuer.` };
      }
      const t = list[st.index!]!;
      const key = `${t.kind}:${t.id}`;
      let page: (IcpBlock | IcrcTx)[];
      if (t.kind === 'icp') {
        const r = await requestJson<{ total: number; blocks: IcpBlock[] }>(fx, `${ICP_API}/accounts/${t.id}/transactions?limit=${PAGE}&offset=${st.offset}`);
        page = r.blocks ?? [];
      } else {
        const r = await requestJson<{ data: IcrcTx[] }>(fx, `${ICRC_API}/ledgers/${OGY_LEDGER}/accounts/${encodeURIComponent(t.id)}/transactions?limit=${PAGE}&offset=${st.offset}`);
        page = r.data ?? [];
      }
      const idOf = (p: IcpBlock | IcrcTx) => (t.kind === 'icp' ? (p as IcpBlock).block_height : String((p as IcrcTx).index));
      if (st.offset === 0 && page[0]) st.passNewest![key] = idOf(page[0]);
      let reachedKnown = false;
      for (const p of page) {
        if (idOf(p) === st.newestSeen![key]) { reachedKnown = true; break; }
        st.records![`${t.kind}:${idOf(p)}`] = { target: key, kind: t.kind, rec: p };
      }
      if (page.length < PAGE || reachedKnown) { st.index = st.index! + 1; st.offset = 0; } else st.offset = st.offset! + PAGE;
      await fx.sleep(200);
    }
    const records = Object.values(st.records!);
    const mapped = mapIcp(list, records);
    return { ...mapped, evidence: { accounts: list, records }, complete: true,
      state: { newestSeen: { ...st.newestSeen, ...st.passNewest } },
      progress: `ICP : ${mapped.transactions.length} opérations sur ${list.length} compte(s).` };
  },
};
