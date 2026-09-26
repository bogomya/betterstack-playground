import { userHeaders, type DemoUser } from '@bsdemo/shared/users';

/** Server-side client for orders-api (the BFF). fetch is instrumented by @vercel/otel, so traceparent propagates. */
export const ORDERS_URL = process.env.ORDERS_URL ?? 'http://localhost:4001';

export interface ApiResult<T> {
  status: number;
  data: T;
  durationMs: number;
}

export async function ordersApi<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; user?: DemoUser & { sessionId?: string }; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${ORDERS_URL}${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.user ? userHeaders(opts.user, opts.user.sessionId) : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* raw */
    }
    return { status: res.status, data: data as T, durationMs: Date.now() - started };
  } catch (err) {
    const name = (err as Error).name;
    return {
      status: name === 'AbortError' ? 504 : 502,
      data: { error: name === 'AbortError' ? 'web_timeout' : 'web_upstream_unreachable', message: (err as Error).message } as T,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  price_cents: number;
  stock: number;
  emoji: string;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
