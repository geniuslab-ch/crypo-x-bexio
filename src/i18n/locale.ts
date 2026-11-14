import 'server-only';
import { cookies, headers } from 'next/headers';
import { currentSession } from '@/server/auth/next';
import type { Locale } from './dictionaries';
import { fromAcceptLanguage, isLocale, LOCALE_COOKIE } from './negotiate';

export { fromAcceptLanguage, isLocale, LOCALE_COOKIE };

/**
 * Language of the current request: the logged-in user's setting, else the visitor's chosen language (cookie),
 * else the browser's Accept-Language, else French.
 */
export async function getLocale(): Promise<Locale> {
  const s = await currentSession();
  if (s && isLocale(s.locale)) return s.locale;
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  return fromAcceptLanguage((await headers()).get('accept-language'));
}
