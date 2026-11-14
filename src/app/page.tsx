import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';
import { landingMetadata } from '@/components/landing/metadata';
import { getLocale } from '@/i18n/locale';
import { currentSession } from '@/server/auth/next';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata(await getLocale(), '/');
}

/** Home: the landing page in the visitor's language (account setting, chosen language, or browser language). */
export default async function Home() {
  const [locale, session] = await Promise.all([getLocale(), currentSession().catch(() => null)]);
  return <Landing locale={locale} loggedIn={!!session} />;
}
