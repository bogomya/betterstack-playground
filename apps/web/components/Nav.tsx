'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { DemoUser } from '@bsdemo/shared/users';
import { readCart } from '@/lib/cart';

export default function Nav({ user }: { user: DemoUser }) {
  const [count, setCount] = useState(0);
  const path = usePathname();
  useEffect(() => {
    const update = () => setCount(readCart().reduce((s, i) => s + i.qty, 0));
    update();
    window.addEventListener('bs-cart', update);
    return () => window.removeEventListener('bs-cart', update);
  }, []);
  const link = (href: string, label: string) => (
    <Link href={href} className={`px-3 py-1.5 rounded-lg text-sm ${path === href ? 'bg-[#1c2531]' : 'hover:bg-[#161d27]'}`}>
      {label}
    </Link>
  );
  return (
    <header className="border-b border-[#1f2a37] bg-[#0d1218]">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-4 text-lg font-semibold">
          ☕ Brew &amp; Bean <span className="muted text-xs font-normal">Better Stack demo shop</span>
        </Link>
        {link('/', 'Shop')}
        {link('/orders', 'Orders')}
        {link('/cart', `Cart${count ? ` (${count})` : ''}`)}
        {link('/lab', '🧪 Lab')}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/account" className="btn">
            👤 {user.name} <span className="tag">{user.plan}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
