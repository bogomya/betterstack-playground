/** Handled, expected failures (validation, business rules). Not reported as exceptions. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** A downstream service failed. Reported as an exception so cascades are visible in error tracking. */
export class UpstreamError extends Error {
  constructor(
    public readonly service: string,
    public readonly statusCode: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class UpstreamTimeoutError extends UpstreamError {
  constructor(service: string, timeoutMs: number) {
    super(service, 504, `${service} did not answer within ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
  }
}

/** Whether a request error should go to error tracking: everything except client errors (4xx). */
export function isServerError(err: unknown): boolean {
  if (err instanceof UpstreamError) return true;
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode !== 'number' || statusCode >= 500;
}

/** SQLSTATE code of a Postgres error (e.g. 42P01), undefined for anything else. */
export function pgErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}
