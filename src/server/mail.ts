import 'server-only';

/**
 * Transactional e-mail through the Resend HTTP API (resend.com), without an extra dependency.
 * Needs RESEND_API_KEY and MAIL_FROM (an address on a domain verified in Resend, e.g. "Crypto2Books <no-reply@crypto2books.ch>").
 * Outside production, when no key is set, the message is printed to the server log instead so the flow can be tested locally.
 */
export interface Mail { to: string; subject: string; text: string }

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM) || process.env.NODE_ENV !== 'production';
}

export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === 'production') throw new Error('mail_not_configured');
    console.info(`[mail] (not sent, RESEND_API_KEY/MAIL_FROM not set) to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`mail_send_failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
