import { LOCALES, type Locale } from './dictionaries';

/** Cookie that remembers the language chosen by a visitor who is not logged in. */
export const LOCALE_COOKIE = 'c2b_locale';

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Best supported language from an Accept-Language header (fr when nothing matches). */
export function fromAcceptLanguage(header: string | null | undefined): Locale {
  const prefs = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: (tag ?? '').split('-')[0] ?? '', q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((p) => p.lang && p.q > 0)
    .sort((a, b) => b.q - a.q);
  return prefs.map((p) => p.lang).find(isLocale) ?? 'fr';
}
