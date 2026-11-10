'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={path === i.href || path.startsWith(`${i.href}/`) ? 'active' : ''}>
          <span>{i.label}</span>
          {i.count ? <span className="count">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
