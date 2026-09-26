import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { metrics, trace } from '@opentelemetry/api';
import { AppError, ChaosStore, createLogger, pgErrorCode, setErrorUser, sleep, userFromHeaders, type DemoUser } from '@bsdemo/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user: DemoUser & { sessionId?: string };
  }
}

interface ReserveBody {
  orderId: string;
  items: { productId: number; qty: number }[];
  chaos?: string;
}

const SERVICE = 'inventory-api';
const port = Number(process.env.PORT ?? 4002);
const startedAt = Date.now();

const meter = metrics.getMeter(SERVICE);
const reservations = meter.createCounter('inventory.reservations', { description: 'Stock reservations by outcome' });
const stockGauge = meter.createObservableGauge('inventory.stock', { description: 'Units in stock per product' });

export async function start(): Promise<void> {
  const log = createLogger(SERVICE);
  const chaos = ChaosStore.fromEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://bsdemo:bsdemo@localhost:5432/bsdemo', max: 10, application_name: SERVICE });

  stockGauge.addCallback(async (result) => {
    try {
      const { rows } = await pool.query<{ sku: string; stock: number }>('SELECT sku, stock FROM products');
      for (const r of rows) result.observe(Number(r.stock), { sku: r.sku });
    } catch {
      /* metrics are best effort */
    }
  });

  const app = Fastify({ loggerInstance: log, genReqId: () => randomUUID(), requestIdLogLabel: 'request_id' });
  app.decorateRequest('user', undefined as never);

  app.addHook('onRequest', async (req) => {
    req.user = userFromHeaders(req.headers as Record<string, unknown>);
    setErrorUser(req.user);
    trace.getActiveSpan()?.setAttributes({ 'enduser.id': req.user.id, 'user.plan': req.user.plan });
    req.log = req.log.child({ user_id: req.user.id });
  });

  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/health')) return;
    const flags = await chaos.get('inventory');
    const latency = Number(flags.latency_ms ?? 0);
    if (latency > 0) await sleep(latency);
    const errorRate = Number(flags.error_rate ?? 0);
    if (errorRate > 0 && Math.random() * 100 < errorRate) {
      throw new Error(`Chaos: random failure injected in inventory-api (error_rate=${errorRate}%)`);
    }
  });

  // 5xx errors are reported by Sentry's Fastify integration; this handler only logs and shapes the response.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, trace_id: traceId }, err.message);
      reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details, trace_id: traceId });
      return;
    }
    if (err.statusCode && err.statusCode < 500) {
      reply.status(err.statusCode).send({ error: 'bad_request', message: err.message, trace_id: traceId });
      return;
    }
    const pgCode = pgErrorCode(err);
    req.log.error({ err, pg_code: pgCode, trace_id: traceId }, pgCode ? 'database error' : 'unhandled error');
    reply.status(500).send({ error: pgCode ? 'database_error' : 'internal_error', message: err.message, trace_id: traceId });
  });

  app.get('/health', async (req, reply) => {
    if ((await chaos.flag('inventory', 'health_fail')) === '1') {
      req.log.warn('health check failing on purpose (chaos health_fail)');
      return reply.status(503).send({ status: 'failing', service: SERVICE, reason: 'chaos:health_fail' });
    }
    return { status: 'ok', service: SERVICE, uptime_s: Math.round((Date.now() - startedAt) / 1000) };
  });

  app.get('/health/deep', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', checks: { postgres: 'ok' } };
    } catch (e) {
      return reply.status(503).send({ status: 'degraded', checks: { postgres: (e as Error).message } });
    }
  });

  app.get('/products', async () => {
    const { rows } = await pool.query('SELECT id, sku, name, description, price_cents, stock, emoji FROM products ORDER BY id');
    return { products: rows };
  });

  app.post<{ Body: ReserveBody }>('/reserve', async (req, reply) => {
    const { orderId, items, chaos: scenario = '' } = req.body ?? ({} as ReserveBody);
    if (!orderId || !Array.isArray(items) || !items.length) throw new AppError(400, 'invalid_reservation', 'orderId and items are required');
    const span = trace.getActiveSpan();
    span?.setAttributes({ 'order.id': orderId, 'order.chaos': scenario || 'none' });
    req.log.info({ order_id: orderId, items, chaos: scenario || undefined }, 'reserving stock');

    if (scenario === 'inventory_throw') {
      throw new Error('Chaos: unhandled exception in inventory-api while reserving stock');
    }

    const dbMode = (await chaos.flag('inventory', 'db_mode')) ?? 'ok';
    if (scenario === 'db_bad_query' || dbMode === 'bad_query') {
      // Deliberate bug: the table is called "products", not "stocks" -> Postgres 42P01 undefined_table
      await pool.query('SELECT stock FROM stocks WHERE product_id = $1', [items[0].productId]);
    }
    if (scenario === 'db_slow' || dbMode === 'slow') {
      await pool.query('SELECT pg_sleep(3)');
    } else if (req.user.personality === 'slow') {
      // Carol always gets a slow query: a latency regression that only affects one customer segment
      await pool.query('SELECT pg_sleep(1.5)');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reserved: { product_id: number; name: string; qty: number; price_cents: number }[] = [];
      for (const it of items) {
        const { rows } = await client.query<{ id: number; name: string; price_cents: number; stock: number }>(
          'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING id, name, price_cents, stock',
          [it.productId, it.qty],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          reservations.add(1, { outcome: 'out_of_stock' });
          const { rows: p } = await pool.query<{ name: string; stock: number }>('SELECT name, stock FROM products WHERE id = $1', [it.productId]);
          if (!p[0]) throw new AppError(404, 'product_not_found', `Product ${it.productId} does not exist`);
          req.log.warn({ order_id: orderId, product_id: it.productId, requested: it.qty, available: p[0].stock }, 'out of stock');
          throw new AppError(409, 'out_of_stock', `Only ${p[0].stock} left of "${p[0].name}", requested ${it.qty}`, { product_id: it.productId, available: p[0].stock });
        }
        reserved.push({ product_id: rows[0].id, name: rows[0].name, qty: it.qty, price_cents: rows[0].price_cents });
        if (rows[0].stock <= 2) req.log.warn({ product_id: rows[0].id, stock_left: rows[0].stock }, 'stock running low');
      }
      await client.query('COMMIT');
      reservations.add(1, { outcome: 'ok' });
      const total = reserved.reduce((s, r) => s + r.price_cents * r.qty, 0);
      req.log.info({ order_id: orderId, total_cents: total }, 'stock reserved');
      return reply.status(201).send({ total_cents: total, items: reserved });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  app.post<{ Body: { orderId: string; items: { productId: number; qty: number }[] } }>('/release', async (req) => {
    const { orderId, items } = req.body ?? ({} as { orderId: string; items: [] });
    for (const it of items ?? []) {
      await pool.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [it.productId, it.qty]);
    }
    req.log.info({ order_id: orderId, items }, 'stock released');
    reservations.add(1, { outcome: 'released' });
    return { ok: true };
  });

  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'inventory-api listening');
}
