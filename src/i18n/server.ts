import 'server-only';
import { CLASSIFICATION_LABELS, translator } from './dictionaries';
import { getLocale } from './locale';

export async function getI18n() {
  const locale = await getLocale();
  const t = translator(locale);
  const cls = (c: string) => CLASSIFICATION_LABELS[locale][c] ?? c;
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-CH' : `${locale}-CH`, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const chf = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : `CHF ${nf.format(Number(v))}`);
  const df = new Intl.DateTimeFormat(`${locale}-CH`, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' });
  const date = (d: Date | string | null | undefined) => (d ? df.format(new Date(d)) : '—');
  return { locale, t, cls, chf, date };
}
