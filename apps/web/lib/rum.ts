'use client';

import type { DemoUser } from '@bsdemo/shared/users';

/** Typed wrapper around the Better Stack JS tag; calls made before b.js loads are queued by the loader. */
type BetterStackFn = (command: 'init' | 'config' | 'user' | 'track', ...args: unknown[]) => void;

declare global {
  interface Window {
    betterstack?: BetterStackFn;
    Sentry?: { captureException?: (e: unknown) => unknown };
  }
}

export function rum(): BetterStackFn | undefined {
  return typeof window !== 'undefined' ? window.betterstack : undefined;
}

export function identify(user: DemoUser | null): void {
  const bs = rum();
  if (!bs) return;
  if (!user || user.id === 'guest') {
    bs('user', null);
    return;
  }
  bs('user', {
    id: user.id,
    email: user.email,
    username: user.name,
    plan: user.plan,
    personality: user.personality,
    group_id: user.group ? user.group.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined,
    group_name: user.group || undefined,
  });
}

export function track(event: string, data: Record<string, unknown> = {}): void {
  rum()?.('track', event, data);
}

export function tagLoaded(): boolean {
  return typeof window !== 'undefined' && typeof window.betterstack === 'function';
}
