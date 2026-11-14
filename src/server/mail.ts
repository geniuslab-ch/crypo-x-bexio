import 'server-only';

/**
 * Transactional e-mail through the Brevo API (brevo.com, POST /v3/smtp/email), without an extra dependency.
 * Needs BREVO_API_KEY (restricted key with "Emails transactionnels" access) and MAIL_FROM, e.g.
 * "Crypto2Books <contact@crypto2books.ch>", whose address must be a sender or domain verified in Brevo.
 * Outside production, when no key is set, the message is printed to the server log instead so the flow can be tested locally.
 */
export interface MailAttachment { name: string; content: string }
export interface Mail { to: string; subject: string; text: string; replyTo?: string; attachments?: MailAttachment[] }

export function mailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM) || process.env.NODE_ENV !== 'production';
}

/** "Name <a@b.ch>" or "a@b.ch" → Brevo sender object. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^>\s]+)\s*>\s*$/.exec(from);
  if (m) return m[1] ? { name: m[1].replace(/^"|"$/g, ''), email: m[2]! } : { email: m[2]! };
  return { email: from.trim() };
}

export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === 'production') throw new Error('mail_not_configured');
    const files = mail.attachments?.length ? `\n[attachments: ${mail.attachments.map((a) => a.name).join(', ')}]` : '';
    console.info(`[mail] (not sent, BREVO_API_KEY/MAIL_FROM not set) to=${mail.to} subject=${mail.subject}\n${mail.text}${files}`);
    return;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseSender(from), to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text,
      ...(mail.replyTo ? { replyTo: { email: mail.replyTo } } : {}),
      // Brevo takes attachments as base64 and only accepts some extensions (csv and txt among them).
      ...(mail.attachments?.length ? { attachment: mail.attachments.map((a) => ({ name: a.name, content: Buffer.from(a.content, 'utf8').toString('base64') })) } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`mail_send_failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
