import { withBetterStack, type BetterStackRequest } from '@logtail/next';
import { NextResponse } from 'next/server';
import { findUser } from '@bsdemo/shared/users';
import { ordersApi } from '@/lib/api';
import { currentUser } from '@/lib/user';

/**
 * Executes one backend scenario as the current (or an explicitly chosen) user by calling orders-api
 * the same way the storefront does, so the resulting trace is web -> orders-api -> inventory-api/payments -> worker.
 */
export const POST = withBetterStack(async (request: BetterStackRequest) => {
  const body = (await request.json().catch(() => ({}))) as { scenario?: string; userId?: string; productId?: number; qty?: number };
  const me = await currentUser();
  const user = body.userId ? { ...findUser(body.userId), sessionId: me.sessionId } : me;
  const scenario = body.scenario ?? 'success';
  request.log.info('lab scenario started', { scenario, userId: user.id });

  const orderBody = (chaos = '', productId = 1, qty = 1) => ({ items: [{ productId, qty }], chaos });
  let res;
  switch (scenario) {
    case 'success':
      res = await ordersApi('/orders', { user, body: orderBody('', body.productId ?? 1, body.qty ?? 1), timeoutMs: 20_000 });
      break;
    case 'out_of_stock':
      res = await ordersApi('/orders', { user, body: orderBody('', 8, 50), timeoutMs: 20_000 });
      break;
    case 'validation':
      res = await ordersApi('/orders', { user, body: { items: [] }, timeoutMs: 20_000 });
      break;
    case 'not_found':
      res = await ordersApi('/orders/00000000-0000-0000-0000-000000000000', { user });
      break;
    case 'burst': {
      const started = Date.now();
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) => ordersApi('/orders', { user, body: orderBody('', (i % 7) + 1, 1), timeoutMs: 20_000 })),
      );
      const statuses = results.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
      return NextResponse.json({ status: 200, durationMs: Date.now() - started, data: { requests: results.length, statuses } });
    }
    default:
      // Every other scenario is a chaos selector understood by the backends (see docs/scenarios.md)
      res = await ordersApi('/orders', { user, body: orderBody(scenario, body.productId ?? 2, body.qty ?? 1), timeoutMs: 20_000 });
  }
  return NextResponse.json({ status: res.status, durationMs: res.durationMs, data: res.data, user: { id: user.id, name: user.name } });
});
