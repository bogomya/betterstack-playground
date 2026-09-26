import { UpstreamError, UpstreamTimeoutError } from './errors.js';

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface CallResult<T> {
  status: number;
  data: T;
}

/**
 * fetch() is auto-instrumented (undici), so traceparent is propagated and the call becomes a client span.
 * Non-2xx responses are returned, not thrown: the caller decides what is a business error.
 */
export async function callService<T = unknown>(service: string, url: string, opts: CallOptions = {}): Promise<CallResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    return { status: res.status, data: data as T };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new UpstreamTimeoutError(service, timeoutMs);
    throw new UpstreamError(service, 502, `${service} is unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Throws UpstreamError for any non-2xx status (use when the caller treats every failure as a cascade). */
export function expectOk<T>(service: string, res: CallResult<T>): T {
  if (res.status >= 200 && res.status < 300) return res.data;
  const body = res.data as { error?: string; message?: string } | string | null;
  const msg = typeof body === 'object' && body ? body.message ?? body.error : undefined;
  throw new UpstreamError(service, res.status, `${service} responded ${res.status}${msg ? `: ${msg}` : ''}`, res.data);
}
