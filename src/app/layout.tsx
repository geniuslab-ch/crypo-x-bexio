import type { Metadata } from 'next';
import { getLocale } from '@/i18n/locale';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crypto2Books',
  description: 'Vos transactions crypto, converties en écritures comptables suisses dans bexio.',
  icons: { icon: '/brand/icon-64.png', apple: '/brand/apple-touch-icon.png' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
