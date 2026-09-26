import { context, isSpanContextValid, trace } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';

/** Sentry transport whose requests to the errors endpoint stay out of the OpenTelemetry traces. */
export function untracedTransport(options: Parameters<typeof Sentry.makeNodeTransport>[0]): ReturnType<typeof Sentry.makeNodeTransport> {
  const transport = Sentry.makeNodeTransport(options);
  return { ...transport, send: (envelope) => context.with(suppressTracing(context.active()), () => transport.send(envelope)) };
}

/** beforeSend hook: links the error to the active OpenTelemetry span. */
export function linkToActiveSpan(event: ErrorEvent): ErrorEvent {
  const span = trace.getActiveSpan()?.spanContext();
  if (span && isSpanContextValid(span)) {
    event.contexts = { ...event.contexts, trace: { trace_id: span.traceId, span_id: span.spanId } };
  }
  return event;
}
