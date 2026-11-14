import type { Metadata } from 'next';
import Link from 'next/link';
import { resetPasswordAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { getI18n } from '@/i18n/server';
import { isResetTokenValid } from '@/server/auth/service';
import { getDb } from '@/server/db';

// The reset token is in the URL: never send it to another site in the Referer header.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { t, locale } = await getI18n();
  const token = typeof sp.token === 'string' ? sp.token : '';
  const valid = await isResetTokenValid(getDb(), token);
  return (
    <div className="card stack" style={{ padding: 28 }}>
      <div>
        <h1>{t('pw.resetTitle')}</h1>
        {valid && <p className="subtitle">{t('pw.resetIntro')}</p>}
      </div>
      {valid && <Flash error={sp.error} ok={sp.ok} locale={locale} />}
      {valid ? (
        <form action={resetPasswordAction} className="stack">
          <input type="hidden" name="token" value={token} />
          <label>{t('pw.newPassword')}<input name="password" type="password" minLength={10} maxLength={200} required autoComplete="new-password" />
            <span className="muted small">{t('auth.passwordHint')}</span></label>
          <label>{t('auth.passwordConfirm')}<input name="passwordConfirm" type="password" minLength={10} maxLength={200} required autoComplete="new-password" /></label>
          <button className="btn btn-primary" type="submit">{t('pw.save')}</button>
        </form>
      ) : (
        <>
          <div className="alert alert-bad" role="status">{t('pw.linkInvalid')}</div>
          <Link className="btn btn-primary" href="/forgot-password">{t('pw.requestNew')}</Link>
        </>
      )}
      <p className="small muted"><Link href="/login">← {t('pw.backToLogin')}</Link></p>
    </div>
  );
}
