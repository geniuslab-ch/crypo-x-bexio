import 'server-only';

/**
 * Transactional e-mail through the Brevo API (brevo.com, POST /v3/smtp/email), without an extra dependency.
 * Needs BREVO_API_KEY (restricted key with "Emails transactionnels" access) and MAIL_FROM, e.g.
 * "Crypto2Books <contact@crypto2books.ch>", whose address must be a sender or domain verified in Brevo.
 * Outside production, when no key is set, the message is printed to the server log instead so the flow can be tested locally.
 */
export interface Mail { to: string; subject: string; text: string }

export function mailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM) || process.env.NODE_ENV !== 'production';
}

/** "Name <a@b.ch>" or "a@b.ch" → Brevo sender object. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^>\s]+)\s*>\s*$/.exec(from);
  if (m) return m[1] ? { name: m[1].replace(/^"|"$/g, ''), email: m[2]! } : { email: m[2]! };
  return { email: from.trim() };
}

/** Sends the e-mail and returns the provider's message id (null when only logged in development). */
export async function sendMail(mail: Mail): Promise<string | null> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === 'production') throw new Error('mail_not_configured');
    console.info(`[mail] (not sent, BREVO_API_KEY/MAIL_FROM not set) to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return null;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: parseSender(from), to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  // Brevo explains refusals in the body (unvalidated sender, unauthorised IP, account not activated…): keep it.
  if (!res.ok) throw new Error(`mail_send_failed ${res.status}: ${body.slice(0, 300)}`);
  try {
    return (JSON.parse(body) as { messageId?: string }).messageId ?? null;
  } catch {
    return null;
  }
}
