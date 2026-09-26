'use client';

import { useEffect } from 'react';
import type { DemoUser } from '@bsdemo/shared/users';
import { identify, track } from '@/lib/rum';

/** Identifies the current demo user to RUM and keeps a session id cookie for backend correlation. */
export default function RumIdentify({ user }: { user: DemoUser }) {
  useEffect(() => {
    if (!document.cookie.includes('bs_sid=')) {
      const sid = `s-${Math.random().toString(36).slice(2, 10)}`;
      document.cookie = `bs_sid=${sid}; path=/; max-age=1800; SameSite=Lax`;
    }
    identify(user.id === 'guest' ? null : user);
    track('demo-user-context', { user_id: user.id, personality: user.personality });
  }, [user.id, user.personality]);
  return null;
}
