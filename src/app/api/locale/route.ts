import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { isLocale, LOCALE_COOKIE } from '@/i18n/locale';
import { currentSession } from '@/server/auth/next';
import { safeNextPath } from '@/server/auth/nextPath';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';

/**
 * Language switch: `/api/locale?l=de&next=/login`. Remembers the choice in a cookie for visitors and,
 * when someone is logged in, saves it on their user too (the user setting wins over the cookie).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const l = url.searchParams.get('l');
  const next = safeNextPath(url.searchParams.get('next') ?? '/');
  const res = NextResponse.redirect(new URL(next, url));
  if (!isLocale(l)) return res;
  res.cookies.set(LOCALE_COOKIE, l, { sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 86400 });
  const s = await currentSession().catch(() => null);
  if (s && s.locale !== l) await getDb().update(users).set({ locale: l }).where(eq(users.id, s.userId));
  return res;
}
