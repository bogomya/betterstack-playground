import { withBetterStack, type BetterStackRequest } from '@logtail/next';
import { NextResponse } from 'next/server';
import { ordersApi } from '@/lib/api';
import { currentUser } from '@/lib/user';

export const POST = withBetterStack(async (request: BetterStackRequest) => {
  const user = await currentUser();
  const body = (await request.json().catch(() => ({}))) as { items?: unknown; chaos?: string };
  request.log.info('checkout requested', { userId: user.id, items: Array.isArray(body.items) ? body.items.length : 0, chaos: body.chaos });
  const res = await ordersApi<Record<string, unknown>>('/orders', { user, body: { items: body.items ?? [], chaos: body.chaos ?? '' }, timeoutMs: 20_000 });
  if (res.status >= 400) request.log.warn('checkout failed', { status: res.status, error: (res.data as { error?: string })?.error, userId: user.id });
  return NextResponse.json({ status: res.status, durationMs: res.durationMs, data: res.data }, { status: 200 });
});
