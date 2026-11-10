import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crypto2Books',
  description: 'Vos transactions crypto, converties en écritures comptables suisses dans bexio.',
  icons: { icon: '/brand/icon-64.png', apple: '/brand/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
