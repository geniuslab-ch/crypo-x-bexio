import Link from 'next/link';
import { loginAction } from '@/app/actions';
import { Flash } from '@/components/Flash';
import { translator } from '@/i18n/dictionaries';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; next?: string }> }) {
  const sp = await searchParams;
  const t = translator('fr');
  return (
    <div className="card stack" style={{ padding: 28 }}>
      <div>
        <h1>{t('auth.login')}</h1>
        <p className="subtitle">Crypto2Books · {t('app.tagline')}</p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={loginAction} className="stack">
        {sp.next && <input type="hidden" name="next" value={sp.next} />}
        <label>{t('auth.email')}<input name="email" type="email" autoComplete="email" required /></label>
        <label>{t('auth.password')}<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="btn btn-primary" type="submit">{t('auth.login')}</button>
      </form>
      <p className="small muted">{t('auth.noAccount')} <Link href="/register">{t('auth.register')}</Link></p>
    </div>
  );
}
