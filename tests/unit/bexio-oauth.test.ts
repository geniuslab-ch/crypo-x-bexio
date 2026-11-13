import { afterEach, describe, expect, it } from 'vitest';
import { bexioConfig, canonicalRedirect } from '@/integrations/bexio/oauth';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('bexio redirect URL', () => {
  it('builds the callback from APP_URL, without double slash', () => {
    process.env.BEXIO_CLIENT_ID = 'id'; process.env.BEXIO_CLIENT_SECRET = 's'; process.env.APP_URL = 'https://www.crypto2books.ch/';
    expect(bexioConfig()?.redirectUri).toBe('https://www.crypto2books.ch/api/bexio/callback');
  });

  it('restarts the flow on the APP_URL host when the request comes from another host', () => {
    process.env.APP_URL = 'https://www.crypto2books.ch';
    const apex = new Request('https://crypto2books.ch/api/bexio/connect', { headers: { host: 'crypto2books.ch' } });
    expect(canonicalRedirect(apex, '/api/bexio/connect')).toBe('https://www.crypto2books.ch/api/bexio/connect');
    const proxied = new Request('https://internal/api/bexio/connect', { headers: { 'x-forwarded-host': 'crypo-x-bexio.vercel.app' } });
    expect(canonicalRedirect(proxied, '/api/bexio/connect')).toBe('https://www.crypto2books.ch/api/bexio/connect');
  });

  it('does nothing on the APP_URL host or without APP_URL', () => {
    process.env.APP_URL = 'https://www.crypto2books.ch';
    const same = new Request('https://www.crypto2books.ch/api/bexio/connect', { headers: { host: 'WWW.crypto2books.ch' } });
    expect(canonicalRedirect(same, '/api/bexio/connect')).toBeNull();
    delete process.env.APP_URL;
    expect(canonicalRedirect(same, '/api/bexio/connect')).toBeNull();
  });
});
