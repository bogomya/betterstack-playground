import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { DEMO_USERS, GUEST_USER, createLogger, sleep, userHeaders, type DemoUser } from '@bsdemo/shared';

/**
 * Synthetic traffic. Deliberately NOT instrumented with OpenTelemetry: like a real browser without
 * tracing, so traces begin at the first server (web or orders-api).
 * Config lives in Redis hash loadgen:config {enabled, rps, profile}; stats in loadgen:stats.
 */
const log = createLogger('loadgen');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const ORDERS = process.env.ORDERS_URL ?? 'http://localhost:4001';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

type Profile = 'healthy' | 'mixed' | 'broken';

const CHAOS_SCENARIOS = ['throw', 'inventory_throw', 'payments_crash', 'db_bad_query', 'db_slow', 'async_fail', 'payments_timeout', 'db_write_fail'];
const PRODUCT_IDS = [1, 2, 3, 4, 5, 6, 7];

const sessions = new Map<string, { id: string; startedAt: number }>();
function sessionFor(user: DemoUser): string {
  const s = sessions.get(user.id);
  if (s && Date.now() - s.startedAt < 10 * 60_000) return s.id;
  const id = `lg-${randomUUID().slice(0, 8)}`;
  sessions.set(user.id, { id, startedAt: Date.now() });
  return id;
}

function pick<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of items) {
    if ((r -= w) <= 0) return item;
  }
  return items[items.length - 1][0];
}

function pickUser(profile: Profile): DemoUser {
  const [alice, bob, carol, dave] = DEMO_USERS;
  if (profile === 'healthy') return pick([[alice, 70], [GUEST_USER, 30]]);
  return pick([[alice, 45], [bob, 15], [carol, 15], [dave, 10], [GUEST_USER, 15]]);
}

async function hit(name: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    await res.arrayBuffer();
    return { status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { status: 0, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function oneRequest(profile: Profile): Promise<{ action: string; status: number; ms: number }> {
  const user = pickUser(profile);
  const headers = { 'content-type': 'application/json', 'user-agent': 'bsdemo-loadgen/1.0', ...userHeaders(user, sessionFor(user)) };
  const action = pick<string>(
    profile === 'healthy'
      ? [['browse', 55], ['order', 30], ['orders_list', 5], ['web_page', 10]]
      : profile === 'mixed'
        ? [['browse', 45], ['order', 30], ['chaos_order', 8], ['orders_list', 7], ['web_page', 10]]
        : [['browse', 25], ['order', 20], ['chaos_order', 45], ['orders_list', 5], ['web_page', 5]],
  );
  switch (action) {
    case 'browse': {
      const r = await hit('products', `${ORDERS}/products`, { headers });
      return { action, ...r };
    }
    case 'orders_list': {
      const r = await hit('orders', `${ORDERS}/orders?limit=5`, { headers });
      return { action, ...r };
    }
    case 'web_page': {
      const path = pick<string>([['/', 50], ['/product/1', 20], ['/product/4', 15], ['/orders', 15]]);
      const r = await hit('web', `${WEB}${path}`, { headers: { 'user-agent': 'bsdemo-loadgen/1.0', cookie: `bs_user=${user.id}` } });
      return { action: `web ${path}`, ...r };
    }
    case 'order':
    case 'chaos_order': {
      const chaos = action === 'chaos_order' ? pick(CHAOS_SCENARIOS.map((s) => [s, 1] as [string, number])) : '';
      const items = [{ productId: pick(PRODUCT_IDS.map((p) => [p, 1] as [number, number])), qty: pick([[1, 70], [2, 25], [3, 5]]) }];
      const r = await hit('order', `${ORDERS}/orders`, { method: 'POST', headers, body: JSON.stringify({ items, chaos }) });
      return { action: chaos ? `order:${chaos}` : 'order', ...r };
    }
    default:
      return { action, status: 0, ms: 0 };
  }
}

async function main(): Promise<void> {
  log.info({ orders: ORDERS, web: WEB }, 'loadgen started (idle until enabled from the Lab)');
  let inFlight = 0;
  for (;;) {
    const cfg = await redis.hgetall('loadgen:config');
    const enabled = cfg.enabled === '1';
    const rps = Math.max(0.1, Math.min(20, Number(cfg.rps ?? 2)));
    const profile = (['healthy', 'mixed', 'broken'].includes(cfg.profile) ? cfg.profile : 'mixed') as Profile;
    if (!enabled) {
      await sleep(1000);
      continue;
    }
    const gapMs = 1000 / rps;
    if (inFlight < 25) {
      inFlight += 1;
      void oneRequest(profile)
        .then(async (r) => {
          const ok = r.status >= 200 && r.status < 400;
          await redis.hincrby('loadgen:stats', 'requests', 1);
          await redis.hincrby('loadgen:stats', ok ? 'ok' : 'errors', 1);
          await redis.hset('loadgen:stats', { last: `${r.action} -> ${r.status} in ${r.ms}ms`, updated_at: new Date().toISOString() });
          if (!ok) log.warn({ action: r.action, status: r.status, ms: r.ms }, 'synthetic request failed (expected for chaos profiles)');
        })
        .finally(() => {
          inFlight -= 1;
        });
    }
    await sleep(gapMs);
  }
}

main().catch((err) => {
  log.error({ err }, 'loadgen crashed');
  process.exit(1);
});
