/**
 * Minimal bexio REST client for the accounting endpoints Crypto2Books uses.
 * Endpoints and payloads: docs.bexio.com (index, auth, rate limits) and its mirror for request bodies —
 * see docs/FEASIBILITY.md section B for verification status.
 */
export const BEXIO_API = 'https://api.bexio.com';

export interface BexioAccount {
  id: number;
  uuid?: string;
  account_no: string;
  name: string;
  account_type?: number;
  tax_id?: number | null;
  fibu_account_group_id?: number;
  is_active: boolean;
  is_locked: boolean;
}

export interface BexioCurrency {
  id: number;
  name: string;
}

export interface BexioTax {
  id: number;
  uuid?: string;
  name: string;
  code: string;
  digit?: string | null;
  type: string; // sales_tax | pre_tax
  value: number;
  is_active: boolean;
  display_name?: string | null;
}

export interface BexioBusinessYear {
  id: number;
  start: string;
  end: string;
  status: string;
  closed_at?: string | null;
}

export interface ManualEntryLine {
  debit_account_id: number;
  credit_account_id: number;
  amount: number;
  description: string;
  currency_id: number;
  currency_factor: number;
  tax_id?: number;
  tax_account_id?: number;
}

export interface ManualEntryRequest {
  type: 'manual_single_entry' | 'manual_group_entry' | 'manual_compound_entry';
  date: string;
  reference_nr: string;
  entries: ManualEntryLine[];
}

export interface ManualEntryResponse {
  id: number;
  type: string;
  date: string;
  reference_nr: string | null;
  entries: (ManualEntryLine & { id: number })[];
  is_locked?: boolean;
  locked_info?: string | null;
}

export class BexioHttpError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

export interface TokenProvider {
  /** Returns a valid access token (refreshing if needed). `force` refreshes even if not expired. */
  getAccessToken(force?: boolean): Promise<string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BexioClient {
  constructor(private tokens: TokenProvider, private fetchImpl: typeof fetch = fetch, private maxRateLimitWaitMs = 60_000) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await this.tokens.getAccessToken(false);
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const res = await this.fetchImpl(`${BEXIO_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'accept-language': 'fr',
          ...(payload ? { 'content-type': 'application/json' } : {}),
        },
        body: payload,
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.tokens.getAccessToken(true);
        continue;
      }
      if (res.status === 429) {
        // bexio documents RateLimit-Reset (seconds until the window resets) but not the numeric limit.
        const reset = Number(res.headers.get('ratelimit-reset') ?? '5');
        const wait = Math.min(Math.max(reset, 1) * 1000, this.maxRateLimitWaitMs);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        const msg = typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : `HTTP ${res.status}`;
        throw new BexioHttpError(res.status, data, `bexio ${method} ${path}: ${msg}`);
      }
      return data as T;
    }
    throw new BexioHttpError(429, null, `bexio ${method} ${path}: rate limit still exceeded after retries`);
  }

  /** Pages through a list endpoint (limit max 2000). */
  async listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const limit = 2000;
    for (let offset = 0; ; offset += limit) {
      const sep = path.includes('?') ? '&' : '?';
      const page = await this.request<T[]>('GET', `${path}${sep}limit=${limit}&offset=${offset}`);
      out.push(...page);
      if (page.length < limit) return out;
    }
  }

  accounts() {
    return this.listAll<BexioAccount>('/2.0/accounts');
  }

  currencies() {
    return this.request<BexioCurrency[]>('GET', '/3.0/currencies');
  }

  /** VAT codes of the company, with the names and rates the company gave them. */
  taxes() {
    return this.request<BexioTax[]>('GET', '/3.0/taxes?scope=active&limit=2000');
  }

  businessYears() {
    return this.listAll<BexioBusinessYear>('/3.0/accounting/business_years');
  }

  manualEntries() {
    return this.listAll<ManualEntryResponse>('/3.0/accounting/manual_entries');
  }

  createManualEntry(body: ManualEntryRequest) {
    return this.request<ManualEntryResponse>('POST', '/3.0/accounting/manual_entries', body);
  }
}
