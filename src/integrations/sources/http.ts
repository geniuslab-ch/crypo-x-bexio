import { ConnectorError, type FetchContext } from './types';

/** Sends a request with a per-request timeout and parses JSON. HTTP errors become ConnectorError. */
export async function requestJson<T>(fx: FetchContext, url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fx.fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    throw new ConnectorError('provider_unreachable', (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (res.status === 429 || res.status === 418) throw new ConnectorError('rate_limited', `HTTP ${res.status}`);
  if (res.status === 401 || res.status === 403) throw new ConnectorError('credentials_rejected', `HTTP ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) throw new ConnectorError('provider_error', `HTTP ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ConnectorError('provider_error', 'invalid JSON response');
  }
}

/** True when there is not enough time left for another request. */
export function outOfTime(fx: FetchContext, reserveMs = 8_000): boolean {
  return fx.now() > fx.deadline - reserveMs;
}

/** Splits a list of addresses entered by the user (newlines, commas, spaces). */
export function splitAddresses(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean))];
}
