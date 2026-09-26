/**
 * OpenTelemetry + Better Stack Errors bootstrap for Node services; must run before application modules load
 * (see src/instrument.ts). Configured by the standard OTEL_EXPORTER_OTLP_* env vars and BS_ERRORS_DSN.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import * as Sentry from '@sentry/node';
import { enrichError } from './capture.js';
import { untracedTransport } from './sentry.js';
import { isServerError } from './errors.js';

export interface TelemetryOptions {
  serviceName: string;
  /** Disable noisy instrumentations per service (e.g. ioredis in the BullMQ worker). */
  disable?: string[];
}

let sdk: NodeSDK | undefined;

export function initTelemetry(opts: TelemetryOptions): void {
  const release = process.env.APP_RELEASE ?? 'dev';
  const environment = process.env.APP_ENV ?? 'demo';
  const otlpEnabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

  if (process.env.OTEL_DEBUG === '1') diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  if (otlpEnabled) {
    const disabled = new Set(['@opentelemetry/instrumentation-fs', ...(opts.disable ?? [])]);
    const instrumentationConfig: Record<string, { enabled: boolean }> = {};
    for (const name of disabled) instrumentationConfig[name] = { enabled: false };

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: opts.serviceName,
        [ATTR_SERVICE_VERSION]: release,
        'deployment.environment.name': environment,
        'service.namespace': 'bsdemo',
      }),
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 15000),
        }),
      ],
      logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
      instrumentations: [getNodeAutoInstrumentations(instrumentationConfig as never)],
    });
    sdk.start();
  } else {
    console.warn(`[telemetry] OTEL_EXPORTER_OTLP_ENDPOINT not set; ${opts.serviceName} runs without OpenTelemetry export`);
  }

  const dsn = process.env.BS_ERRORS_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      environment,
      release,
      initialScope: { tags: { service: opts.serviceName } },
      integrations: [Sentry.fastifyIntegration({ shouldHandleError: isServerError })],
      transport: untracedTransport,
      beforeSend: enrichError,
    });
  } else {
    console.warn(`[telemetry] BS_ERRORS_DSN not set; ${opts.serviceName} runs without error tracking`);
  }

  const shutdown = async () => {
    try {
      await Promise.race([Promise.all([sdk?.shutdown(), Sentry.flush(2000)]), new Promise((r) => setTimeout(r, 4000))]);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
