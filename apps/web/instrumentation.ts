/**
 * Server-side observability (Node runtime only): @vercel/otel with OTLP exporters and @sentry/node for errors.
 * onRequestError is Next's hook for uncaught errors in route handlers, server components and actions.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const release = process.env.APP_RELEASE ?? 'dev';
  const environment = process.env.APP_ENV ?? 'demo';

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { registerOTel } = await import('@vercel/otel');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-http');
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const { BatchLogRecordProcessor } = await import('@opentelemetry/sdk-logs');

    registerOTel({
      serviceName: 'web',
      attributes: { 'service.version': release, 'deployment.environment.name': environment, 'service.namespace': 'bsdemo' },
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 15000 })],
      logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
      // Propagate W3C trace context on every outgoing fetch (orders-api lives on the compose network)
      instrumentationConfig: { fetch: { propagateContextUrls: [/.*/] } },
    });
  } else {
    console.warn('[web] OTEL_EXPORTER_OTLP_ENDPOINT not set; running without OpenTelemetry export');
  }

  if (process.env.BS_ERRORS_DSN) {
    const Sentry = await import('@sentry/node');
    const { linkToActiveSpan, untracedTransport } = await import('@bsdemo/shared/sentry');
    Sentry.init({
      dsn: process.env.BS_ERRORS_DSN,
      environment,
      release,
      initialScope: { tags: { service: 'web', runtime: 'server' } },
      transport: untracedTransport,
      beforeSend: linkToActiveSpan,
    });
  } else {
    console.warn('[web] BS_ERRORS_DSN not set; running without server-side error tracking');
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.BS_ERRORS_DSN) return;
  const Sentry = await import('@sentry/node');
  Sentry.withScope((scope) => {
    scope.setTag('route_path', context.routePath);
    scope.setTag('route_type', context.routeType);
    scope.setTag('kind', 'next_request_error');
    scope.setContext('request', { method: request.method, url: request.path, headers: { 'user-agent': request.headers['user-agent'] } });
    const userId = request.headers.cookie?.toString().match(/bs_user=([^;]+)/)?.[1];
    if (userId) scope.setUser({ id: userId });
    Sentry.captureException(err);
  });
}
