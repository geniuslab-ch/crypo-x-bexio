'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Org { id: string; name: string }

function normalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Client (organisation) picker shown at the top of every page: a dropdown with a search field.
 * Choosing a client submits the server action and stays on the current page.
 */
export function ClientSwitcher({
  orgs, activeId, action, labels,
}: {
  orgs: Org[];
  activeId: string | null;
  action: (form: FormData) => Promise<void>;
  labels: { client: string; search: string; none: string; add: string };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const path = usePathname();
  const active = orgs.find((o) => o.id === activeId);

  const list = useMemo(() => {
    const n = normalise(q.trim());
    const sorted = [...orgs].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return n ? sorted.filter((o) => normalise(o.name).includes(n)) : sorted;
  }, [orgs, q]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => setHi(0), [q]);

  const choose = (id: string) => {
    setOpen(false);
    if (id === activeId || !idRef.current) return;
    idRef.current.value = id;
    formRef.current?.requestSubmit();
  };

  return (
    <div className="client-switch" ref={box}>
      <form action={action} ref={formRef} hidden>
        <input type="hidden" name="orgId" ref={idRef} />
        <input type="hidden" name="next" value={path} />
      </form>
      <button type="button" className="client-switch-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="client-switch-label">{labels.client}</span>
        <span className="client-switch-name">{active?.name ?? '—'}</span>
        <span aria-hidden className="client-switch-caret">▾</span>
      </button>
      {open ? (
        <div className="client-switch-pop">
          <input
            ref={searchRef}
            type="search"
            placeholder={labels.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); const o = list[hi]; if (o) choose(o.id); }
              else if (e.key === 'Escape') setOpen(false);
            }}
            aria-label={labels.search}
          />
          <ul role="listbox" aria-label={labels.client}>
            {list.length === 0 ? <li className="muted small" style={{ padding: '8px 10px' }}>{labels.none}</li> : null}
            {list.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === activeId}
                className={`${i === hi ? 'hi' : ''} ${o.id === activeId ? 'current' : ''}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(o.id); }}
              >
                {o.name}
                {o.id === activeId ? <span aria-hidden> ✓</span> : null}
              </li>
            ))}
          </ul>
          <Link href="/fiduciary" className="client-switch-add" onClick={() => setOpen(false)}>+ {labels.add}</Link>
        </div>
      ) : null}
    </div>
  );
}
