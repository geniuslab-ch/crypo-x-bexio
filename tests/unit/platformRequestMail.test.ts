import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { attachmentName, platformRequestMail, platformRequestRecipient } = await import('@/server/services/platformRequests');
const { sendMail } = await import('@/server/mail');

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const notice = {
  platform: 'Bitpanda', kind: 'exchange', wanted: 'csv', note: 'Export trades 2025', requesterName: 'Anna Muster', requesterEmail: 'anna@example.test',
  orgName: 'Muster SA', total: 3, createdAt: new Date('2026-11-14T12:00:00Z'), sample: { name: 'bitpanda.csv', content: 'date,asset\n2025-01-01,BTC\n' },
};

describe('platform request notification', () => {
  it('goes to contact@crypto2books.ch unless overridden', () => {
    expect(platformRequestRecipient()).toBe('contact@crypto2books.ch');
    vi.stubEnv('PLATFORM_REQUEST_NOTIFY_TO', 'ops@example.test');
    expect(platformRequestRecipient()).toBe('ops@example.test');
  });

  it('names the platform, requester, file and count, and attaches the example', () => {
    const m = platformRequestMail(notice, 'contact@crypto2books.ch');
    expect(m.subject).toBe('Demande de plateforme : Bitpanda (3 demandes)');
    expect(m.replyTo).toBe('anna@example.test');
    expect(m.text).toContain('Plateforme : Bitpanda');
    expect(m.text).toContain('Demandé par : Anna Muster <anna@example.test>');
    expect(m.text).toContain('Dossier : Muster SA');
    expect(m.text).toContain('Demandes pour cette plateforme à ce jour : 3');
    expect(m.text).toContain('Export trades 2025');
    expect(m.attachments).toEqual([{ name: 'bitpanda.csv', content: notice.sample.content }]);
  });

  it('works without an example file', () => {
    const m = platformRequestMail({ ...notice, total: 1, sample: null, note: null, requesterName: null }, 'x@y.ch');
    expect(m.subject).toBe('Demande de plateforme : Bitpanda (1 demande)');
    expect(m.text).toContain("Fichier d'exemple : aucun");
    expect(m.attachments).toBeUndefined();
  });

  it('keeps attachment names Brevo accepts', () => {
    expect(attachmentName('export.CSV')).toBe('export.CSV');
    expect(attachmentName('ledger.xlsx')).toBe('ledger.xlsx.txt');
    expect(attachmentName('')).toBe('exemple.txt');
  });

  it('sends the example base64-encoded with a reply-to', async () => {
    vi.stubEnv('BREVO_API_KEY', 'k');
    vi.stubEnv('MAIL_FROM', 'Crypto2Books <contact@crypto2books.ch>');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendMail(platformRequestMail(notice, 'contact@crypto2books.ch'));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.to).toEqual([{ email: 'contact@crypto2books.ch' }]);
    expect(body.replyTo).toEqual({ email: 'anna@example.test' });
    expect(body.attachment[0].name).toBe('bitpanda.csv');
    expect(Buffer.from(body.attachment[0].content, 'base64').toString('utf8')).toBe(notice.sample.content);
  });
});
