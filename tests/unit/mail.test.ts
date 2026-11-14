import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { parseSender, sendMail } = await import('@/server/mail');

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Brevo mail', () => {
  it('reads MAIL_FROM with or without a display name', () => {
    expect(parseSender('Crypto2Books <contact@crypto2books.ch>')).toEqual({ name: 'Crypto2Books', email: 'contact@crypto2books.ch' });
    expect(parseSender('"Crypto2Books" <a@b.ch>')).toEqual({ name: 'Crypto2Books', email: 'a@b.ch' });
    expect(parseSender(' a@b.ch ')).toEqual({ email: 'a@b.ch' });
  });

  it('posts a text e-mail to the Brevo transactional API with the key header', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    vi.stubEnv('MAIL_FROM', 'Crypto2Books <contact@crypto2books.ch>');
    const fetchMock = vi.fn(async () => new Response('{"messageId":"<1@brevo>"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendMail({ to: 'user@example.test', subject: 'Sujet', text: 'Corps' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { name: 'Crypto2Books', email: 'contact@crypto2books.ch' }, to: [{ email: 'user@example.test' }], subject: 'Sujet', textContent: 'Corps',
    });
  });

  it('fails loudly when Brevo refuses (e.g. unverified sender)', async () => {
    vi.stubEnv('BREVO_API_KEY', 'k');
    vi.stubEnv('MAIL_FROM', 'a@b.ch');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"unauthorized"}', { status: 401 })));
    await expect(sendMail({ to: 'x@y.ch', subject: 's', text: 't' })).rejects.toThrow('mail_send_failed 401');
  });
});
