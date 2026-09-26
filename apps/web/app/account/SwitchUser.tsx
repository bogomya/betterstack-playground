'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DemoUser } from '@bsdemo/shared/users';
import { identify, track } from '@/lib/rum';

const blurbs: Record<DemoUser['personality'], string> = {
  good: 'Everything works. Use for "good session" baselines.',
  declined: 'Card always declined by payments (handled 402, no exception).',
  slow: 'Inventory query is slow only for this user (latency regression for one segment).',
  'async-fail': 'Orders are paid but always fail in the worker after 3 retries (async error).',
};

export default function SwitchUser({ user, active }: { user: DemoUser; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`panel p-4 text-left ${active ? 'border-[#f5a524]' : 'hover:border-[#2c3a4b]'}`}
      data-testid={`switch-user-${user.id}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/user', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: user.id }) });
        identify(user.id === 'guest' ? null : user);
        track('user-switched', { user_id: user.id });
        router.refresh();
        setBusy(false);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{user.name}</span>
        <span className="tag">{user.plan}</span>
      </div>
      <div className="muted mt-1 text-xs">{user.email || 'anonymous visitor'}{user.group ? ` · ${user.group}` : ''}</div>
      <div className="mt-2 text-sm">{blurbs[user.personality]}</div>
      {active ? <div className="mt-2 text-xs text-[#f5a524]">current</div> : null}
    </button>
  );
}
