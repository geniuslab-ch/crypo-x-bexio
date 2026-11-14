import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Landing } from '@/components/landing/Landing';
import { landingMetadata } from '@/components/landing/metadata';
import { LOCALES } from '@/i18n/dictionaries';
import { isLocale } from '@/i18n/locale';
import { currentSession } from '@/server/auth/next';

/** Landing page per language: /fr, /de, /it, /en. Any other single segment is a 404. */
export const dynamicParams = false;
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return isLocale(lang) ? landingMetadata(lang, `/${lang}`) : {};
}

export default async function LocalizedHome({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const session = await currentSession().catch(() => null);
  return <Landing locale={lang} loggedIn={!!session} />;
}
