import { createHash, createHmac } from 'node:crypto';
import { parseKrakenLedgerRows } from '@/core/importers/kraken';
import { outOfTime, requestJson } from './http';
import { ConnectorError, type FetchContext, type SourceConnector, type SyncState } from './types';

/**
 * Kraken read-only API — POST https://api.kraken.com/0/private/Ledgers
 * Verified against docs.kraken.com (Get Ledgers Info; Spot REST authentication), 2026-11-10:
 * - permission "Data - Query ledger entries", 50 entries per call, newest first;
 *   body: nonce, start/end (Unix time, start exclusive, end inclusive), with_cursor + cursor;
 * - entry fields: refid, time, type, subtype, aclass, asset, amount, fee, balance — the same
 *   fields as the ledger CSV, so the CSV parser is reused and both paths give identical results;
 * - API-Sign = base64(HMAC-SHA512(base64decode(secret), path + SHA256(nonce + postdata))),
 *   form-urlencoded body.
 * Kraken offers no endpoint to read a key's permissions: the user is told to create a key with
 * only "Query ledger entries", and we never call any other private endpoint.
 */
const BASE = 'https://api.kraken.com';
const PATH = '/0/private/Ledgers';

interface LedgerEntry { refid: string; time: number; type: string; subtype?: string; aclass?: string; asset: string; amount: string; fee: string; balance?: string }
interface LedgersResponse { error: string[]; result?: { ledger: Record<string, LedgerEntry>; count: number | null; cursor?: { next: string | null } } }

interface KrakenState extends SyncState {
  /** Exclusive lower bound of the current pass (Unix seconds); undefined = full history. */
  start?: number;
  cursor?: string | null;
  /** Entries collected in the current pass, keyed by ledger id. */
  pending?: Record<string, LedgerEntry>;
  /** Newest entry time seen across all passes. */
  newest?: number;
}

let lastNonce = 0;
function nonce(): string {
  lastNonce = Math.max(lastNonce + 1, Date.now() * 1000);
  return String(lastNonce);
}

export function krakenSign(path: string, body: string, nonceValue: string, secretB64: string): string {
  const inner = createHash('sha256').update(nonceValue + body).digest();
  return createHmac('sha512', Buffer.from(secretB64, 'base64')).update(Buffer.concat([Buffer.from(path), inner])).digest('base64');
}

async function ledgers(fx: FetchContext, creds: Record<string, string>, params: Record<string, string>): Promise<LedgersResponse> {
  const n = nonce();
  const body = new URLSearchParams({ nonce: n, ...params }).toString();
  const res = await requestJson<LedgersResponse>(fx, BASE + PATH, {
    method: 'POST',
    headers: {
      'API-Key': creds.apiKey ?? '',
      'API-Sign': krakenSign(PATH, body, n, creds.apiSecret ?? ''),
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body,
  });
  if (res.error?.length) {
    const err = res.error.join(', ');
    if (/Rate limit/i.test(err)) throw new ConnectorError('rate_limited', err);
    if (/Invalid key|Invalid signature|Invalid nonce|Permission denied/i.test(err)) throw new ConnectorError('credentials_rejected', err);
    throw new ConnectorError('provider_error', err);
  }
  return res;
}

/** Converts API entries to the CSV row shape expected by the shared Kraken parser. */
export function krakenEntriesToRows(entries: Record<string, LedgerEntry>): { rows: Record<string, string>[]; lines: number[] } {
  const list = Object.entries(entries).sort(([, a], [, b]) => a.time - b.time);
  return {
    rows: list.map(([id, e]) => ({
      txid: id, refid: e.refid, time: new Date(Math.round(e.time * 1000)).toISOString(), type: e.type, subtype: e.subtype ?? '',
      aclass: e.aclass ?? '', asset: e.asset, amount: e.amount, fee: e.fee, balance: e.balance ?? '',
    })),
    lines: list.map((_, i) => i + 1),
  };
}

export const krakenApiConnector: SourceConnector = {
  id: 'kraken_api_v1',
  version: 1,
  provider: 'kraken',
  label: 'Kraken — API lecture seule',
  kind: 'exchange',
  support: 'partial',
  fields: [
    { name: 'apiKey', label: 'Clé API (API key)', secret: false },
    { name: 'apiSecret', label: 'Clé privée (Private key)', secret: true },
  ],
  help: 'Kraken → Paramètres → API → Créer une clé. Cochez uniquement « Query ledger entries » (Données). Ne cochez ni trading, ni dépôt, ni retrait.',
  limits: 'Kraken ne permet pas de vérifier les droits d’une clé : nous n’appelons que la lecture du registre. Écrit selon la documentation officielle, à valider avec un vrai compte.',
  async verify(creds, fx) {
    if (!creds.apiKey || !creds.apiSecret) throw new ConnectorError('credentials_missing');
    await ledgers(fx, creds, { without_count: 'true' });
    return { readOnly: 'not_checkable' };
  },
  async sync(creds, raw, fx) {
    const state: KrakenState = { ...(raw as KrakenState) };
    const pending: Record<string, LedgerEntry> = { ...(state.pending ?? {}) };
    let cursor = state.cursor ?? null;
    let pages = 0;
    let finished = false;
    while (!outOfTime(fx)) {
      const params: Record<string, string> = { with_cursor: 'true' };
      if (state.start !== undefined) params.start = String(state.start);
      if (cursor) params.cursor = cursor;
      let res: LedgersResponse;
      try {
        res = await ledgers(fx, creds, params);
      } catch (e) {
        // Kraken's call-rate counter decays slowly: keep what we have and continue on the next run.
        if (e instanceof ConnectorError && e.code === 'rate_limited') break;
        throw e;
      }
      pages++;
      for (const [id, entry] of Object.entries(res.result?.ledger ?? {})) pending[id] = entry;
      cursor = res.result?.cursor?.next ?? null;
      if (!cursor) { finished = true; break; }
      await fx.sleep(1_000);
    }
    if (!finished) {
      return {
        transactions: [], issues: [], evidence: null, complete: false,
        state: { ...state, cursor, pending },
        progress: `${Object.keys(pending).length} écritures Kraken lues (${pages} pages) — relancez pour continuer.`,
      };
    }
    const { rows, lines } = krakenEntriesToRows(pending);
    const parsed = parseKrakenLedgerRows(rows, lines);
    const newest = Math.max(state.newest ?? 0, ...Object.values(pending).map((e) => e.time));
    return {
      transactions: parsed.transactions, issues: parsed.issues, evidence: { endpoint: PATH, entries: pending }, complete: true,
      // Next pass: overlap one hour so late-settling entries are caught; duplicates are skipped by fingerprint.
      state: { start: newest > 0 ? Math.floor(newest) - 3600 : state.start, newest, cursor: null, pending: {} },
      progress: `${rows.length} écritures Kraken lues.`,
    };
  },
};
