import Link from 'next/link';
import { forgotPasswordAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { t, locale } = await getI18n();
  return (
    <div className="card stack" style={{ padding: 28 }}>
      <div>
        <h1>{t('pw.forgotTitle')}</h1>
        <p className="subtitle">{t('pw.forgotIntro')}</p>
      </div>
      <Flash error={sp.error} ok={sp.ok} locale={locale} />
      <form action={forgotPasswordAction} className="stack">
        <label>{t('auth.email')}<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <button className="btn btn-primary" type="submit">{t('pw.send')}</button>
      </form>
      <p className="small muted"><Link href="/login">← {t('pw.backToLogin')}</Link></p>
    </div>
  );
}
