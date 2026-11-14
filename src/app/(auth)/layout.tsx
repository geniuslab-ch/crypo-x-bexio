import Image from 'next/image';
import Link from 'next/link';
import { LangLinks } from '@/components/LangLinks';
import { getI18n } from '@/i18n/server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = await getI18n();
  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <Link href={`/${locale}`}><Image src="/brand/crypto2books-logo-640.png" alt="Crypto2Books — From crypto to books." width={640} height={410} priority /></Link>
        <ul>
          <li>{t('auth.b1')}</li>
          <li>{t('auth.b2')}</li>
          <li>{t('auth.b3')}</li>
          <li>{t('auth.b4')}</li>
        </ul>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-top"><Link href={`/${locale}`} className="small muted">← {t('auth.home')}</Link><LangLinks current={locale} /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
