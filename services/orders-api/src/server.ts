import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { AppError, ChaosStore, UpstreamError, createLogger, setErrorUser, sleep, userFromHeaders } from '@bsdemo/shared';
import { config } from './config.js';
import { registerOrderRoutes } from './orders.js';
import { registerAdminRoutes } from './admin.js';
import { registerHealthRoutes } from './health.js';
import './types.js';

export async function start(): Promise<void> {
  const log = createLogger(config.serviceName);
  const chaos = ChaosStore.fromEnv();

  const app = Fastify({
    loggerInstance: log,
    genReqId: () => randomUUID(),
    requestIdLogLabel: 'request_id',
  });

  app.decorateRequest('user', undefined as never);

  // Attach the acting user (propagated by the web app / load generator via x-user-* headers)
  app.addHook('onRequest', async (req) => {
    req.user = userFromHeaders(req.headers as Record<string, unknown>);
    setErrorUser(req.user);
    const span = trace.getActiveSpan();
    span?.setAttributes({ 'enduser.id': req.user.id, 'user.name': req.user.name, 'user.plan': req.user.plan });
    if (req.user.sessionId) span?.setAttribute('session.id', req.user.sessionId);
    req.log = req.log.child({ user_id: req.user.id, user_plan: req.user.plan });
  });

  // Service-wide chaos: injected latency and random failures (set from the Lab UI)
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/admin') || req.url.startsWith('/health')) return;
    const flags = await chaos.get('orders');
    const latency = Number(flags.latency_ms ?? 0);
    if (latency > 0) await sleep(latency);
    const errorRate = Number(flags.error_rate ?? 0);
    if (errorRate > 0 && Math.random() * 100 < errorRate) {
      throw new Error(`Chaos: random failure injected in orders-api (error_rate=${errorRate}%)`);
    }
  });

  // 5xx errors are reported by Sentry's Fastify integration; this handler only logs and shapes the response.
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, details: err.details, trace_id: traceId }, err.message);
      reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details, trace_id: traceId });
      return;
    }
    if (err instanceof UpstreamError) {
      req.log.error({ err, upstream: err.service, upstream_status: err.statusCode, trace_id: traceId }, 'upstream call failed');
      reply
        .status(err.statusCode === 504 ? 504 : 502)
        .send({ error: 'upstream_failure', service: err.service, message: err.message, trace_id: traceId });
      return;
    }
    if (err.statusCode && err.statusCode < 500) {
      reply.status(err.statusCode).send({ error: err.validation ? 'validation_failed' : 'bad_request', message: err.message, trace_id: traceId });
      return;
    }
    req.log.error({ err, trace_id: traceId }, 'unhandled error');
    reply.status(500).send({ error: 'internal_error', message: err.message, trace_id: traceId });
  });

  registerHealthRoutes(app, chaos);
  registerOrderRoutes(app, chaos);
  registerAdminRoutes(app, chaos);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port, release: process.env.APP_RELEASE ?? 'dev' }, 'orders-api listening');
}
