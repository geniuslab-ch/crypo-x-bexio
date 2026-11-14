import type { Metadata } from 'next';
import { LOCALES, type Locale } from '@/i18n/dictionaries';
import { LANDING } from '@/i18n/landing';

const SITE = process.env.APP_URL || 'https://www.crypto2books.ch';

export function landingMetadata(locale: Locale, path: string): Metadata {
  const c = LANDING[locale];
  return {
    metadataBase: new URL(SITE),
    title: c.meta.title,
    description: c.meta.description,
    alternates: {
      canonical: path === '/' ? `/${locale}` : path,
      languages: { ...Object.fromEntries(LOCALES.map((l) => [`${l}-CH`, `/${l}`])), 'x-default': '/' },
    },
    openGraph: {
      title: c.meta.title, description: c.meta.description, url: path, siteName: 'Crypto2Books', locale: `${locale}_CH`, type: 'website',
      images: [{ url: '/landing/dashboard.webp', width: 1360, height: 900, alt: c.shots.dashboard }],
    },
  };
}
