import pino, { type Logger } from 'pino';

/**
 * Structured JSON logs on stdout.
 *  - `message` instead of pino's `msg` so Better Stack's default columns pick it up.
 *  - `level` as a label ("info") instead of a number.
 *  - trace_id / span_id are injected by @opentelemetry/instrumentation-pino when a span is active,
 *    and the same records are also shipped over OTLP (log bridge) when telemetry is enabled.
 */
export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service, env: process.env.APP_ENV ?? 'demo' },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export type { Logger };
