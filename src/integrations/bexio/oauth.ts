/**
 * bexio OpenID Connect / OAuth 2.0 Authorization Code flow (auth.bexio.com, realm "bexio").
 * Source: https://docs.bexio.com/ — Authentication, Authorization Code Flow, Refresh Token Flow (read 10.11.2026).
 * Token endpoint parameters must be sent in the request body. Refresh tokens rotate: always store the new one.
 */
export const BEXIO_AUTH_URL = 'https://auth.bexio.com/realms/bexio/protocol/openid-connect/auth';
export const BEXIO_TOKEN_URL = 'https://auth.bexio.com/realms/bexio/protocol/openid-connect/token';
/** `accounting` is bexio's only accounting scope (write; includes read). */
export const BEXIO_SCOPES = ['openid', 'offline_access', 'company_profile', 'accounting'];

export interface BexioConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function bexioConfig(): BexioConfig | null {
  const clientId = process.env.BEXIO_CLIENT_ID;
  const clientSecret = process.env.BEXIO_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  return { clientId, clientSecret, redirectUri: `${appUrl.replace(/\/$/, '')}/api/bexio/callback` };
}

/** Host of the request as seen by the user (Vercel and other proxies set x-forwarded-host). */
export function requestHost(req: Request): string {
  return (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host).split(',')[0]!.trim().toLowerCase();
}

/**
 * When APP_URL is set and the request arrived on another host, returns the same path on the APP_URL origin.
 * Returns null when the host already matches or APP_URL is not set.
 */
export function canonicalRedirect(req: Request, path: string): string | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return null;
  let canonical: URL;
  try { canonical = new URL(appUrl); } catch { return null; }
  if (canonical.host.toLowerCase() === requestHost(req)) return null;
  return new URL(path, canonical.origin).toString();
}

export function authorizationUrl(cfg: BexioConfig, state: string, nonce: string): string {
  const u = new URL(BEXIO_AUTH_URL);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', BEXIO_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  return u.toString();
}

export interface BexioTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
  idTokenClaims: Record<string, unknown> | null;
}

function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
  if (!jwt) return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch): Promise<BexioTokens> {
  const res = await fetchImpl(BEXIO_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== 'string') {
    const err = typeof body.error_description === 'string' ? body.error_description : typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`bexio token endpoint: ${err}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: Date.now() + (typeof body.expires_in === 'number' ? body.expires_in : 300) * 1000,
    scope: typeof body.scope === 'string' ? body.scope : '',
    // The ID token comes straight from bexio's token endpoint over TLS; we only read display claims from it.
    idTokenClaims: decodeJwtPayload(typeof body.id_token === 'string' ? body.id_token : undefined),
  };
}

export function exchangeCode(cfg: BexioConfig, code: string, fetchImpl: typeof fetch = fetch): Promise<BexioTokens> {
  return tokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret,
  }, fetchImpl);
}

export function refreshTokens(cfg: BexioConfig, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<BexioTokens> {
  return tokenRequest({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret,
  }, fetchImpl);
}
