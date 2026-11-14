import Image from 'next/image';
import Link from 'next/link';
import { and, count, eq, inArray } from 'drizzle-orm';
import { logoutAction, switchOrgAction } from '@/app/actions';
import { ClientSwitcher } from '@/components/ClientSwitcher';
import { NavLinks } from '@/components/NavLinks';
import { getI18n } from '@/i18n/server';
import { requireCtx } from '@/server/auth/next';
import { journalEntries, transactions } from '@/server/db/schema';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, session } = await requireCtx();
  const { t } = await getI18n();
  const [[review], [toValidate]] = await Promise.all([
    ctx.db.select({ n: count() }).from(transactions).where(and(eq(transactions.orgId, ctx.orgId), eq(transactions.reviewStatus, 'needs_review'))),
    ctx.db.select({ n: count() }).from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), inArray(journalEntries.status, ['draft', 'sync_failed']))),
  ]);
  const items = [
    { href: '/dashboard', label: t('nav.dashboard') },
    { href: '/transactions', label: t('nav.transactions') },
    { href: '/review', label: t('nav.review'), count: Number(review?.n ?? 0) },
    { href: '/sources', label: t('nav.sources') },
    { href: '/accounting', label: t('nav.accounting'), count: Number(toValidate?.n ?? 0) },
    { href: '/reconciliation', label: t('nav.reconciliation') },
    { href: '/closing', label: t('nav.closing') },
    { href: '/bexio', label: t('nav.bexio') },
    { href: '/reports', label: t('nav.reports') },
    { href: '/fiduciary', label: t('nav.fiduciary') },
    { href: '/settings', label: t('nav.settings') },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <Image src="/brand/crypto2books-mark.png" alt="" width={44} height={44} />
          <span>
            <span className="brand-name">Crypto<b>2</b>Books</span><br />
            <span className="brand-tag">{t('app.tagline')}</span>
          </span>
        </Link>
        <NavLinks items={items} />
        <div className="sidebar-foot">
          <div>{session.email}</div>
          <form action={logoutAction}><button className="btn" type="submit" style={{ width: '100%' }}>{t('nav.logout')}</button></form>
          <div className="swiss-line"><span className="swiss-flag" aria-hidden /> Made for Swiss accounting</div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <ClientSwitcher
            orgs={session.orgs.map((o) => ({ id: o.id, name: o.name }))}
            activeId={session.orgId ?? null}
            action={switchOrgAction}
            labels={{ client: t('client.label'), search: t('client.search'), none: t('client.none'), add: t('client.add') }}
          />
        </div>
        {children}
      </main>
    </div>
  );
}
