import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/node';
import { UpstreamError, pgErrorCode } from './errors.js';
import { linkToActiveSpan } from './sentry.js';
import type { DemoUser } from './users.js';

export interface CaptureContext {
  user?: DemoUser;
  tags?: Record<string, string | number | boolean>;
  extra?: Record<string, unknown>;
}

/** For errors outside a request (jobs, cron). Request errors are captured by Sentry's Fastify integration. */
export function captureException(err: unknown, ctx: CaptureContext = {}): void {
  if (!process.env.BS_ERRORS_DSN) return;
  Sentry.withScope((scope) => {
    if (ctx.user) scope.setUser(toSentryUser(ctx.user));
    if (ctx.tags) scope.setTags(ctx.tags);
    if (ctx.extra) scope.setExtras(ctx.extra);
    Sentry.captureException(err);
  });
}

/** Attaches the acting user to errors captured during the current request. */
export function setErrorUser(user: DemoUser & { sessionId?: string }): void {
  Sentry.setUser(toSentryUser(user));
}

/** beforeSend hook for the backends: links the error to its trace and tags it by type. */
export function enrichError(event: ErrorEvent, hint: EventHint): ErrorEvent {
  linkToActiveSpan(event);
  const err = hint.originalException;
  const tags = { ...event.tags };
  if (err instanceof UpstreamError) {
    Object.assign(tags, { kind: 'cascade', upstream: err.service, upstream_status: err.statusCode });
    event.extra = { ...event.extra, upstream_body: err.body };
  } else if (pgErrorCode(err)) {
    Object.assign(tags, { kind: 'database', pg_code: pgErrorCode(err) });
  }
  tags.kind ??= 'unhandled';
  event.tags = tags;
  return event;
}

function toSentryUser(user: DemoUser & { sessionId?: string }): Sentry.User {
  return { id: user.id, username: user.name, email: user.email || undefined, plan: user.plan, session_id: user.sessionId };
}
