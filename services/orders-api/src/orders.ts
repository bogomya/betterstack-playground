import { randomUUID } from 'node:crypto';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AppError, callService, expectOk, userHeaders, type ChaosStore } from '@bsdemo/shared';
import { config } from './config.js';
import { pool } from './db.js';
import { ordersQueue } from './queue.js';
import type { App, CreateOrderBody, ReservationResult } from './types.js';

const meter = metrics.getMeter('orders-api');
const ordersCreated = meter.createCounter('orders.created', { description: 'Orders successfully paid and queued for fulfilment' });
const ordersFailed = meter.createCounter('orders.failed', { description: 'Checkout attempts that failed, by reason' });
const checkoutDuration = meter.createHistogram('checkout.duration', { unit: 'ms', description: 'End-to-end checkout latency' });
const orderValue = meter.createHistogram('orders.value', { unit: 'cents', description: 'Order value distribution' });

export function registerOrderRoutes(app: App, _chaos: ChaosStore): void {
  // Product catalogue lives in inventory-api; this is the BFF pass-through the web app uses.
  app.get('/products', async (req) => {
    const res = await callService('inventory-api', `${config.inventoryUrl}/products`, {
      headers: userHeaders(req.user, req.user.sessionId),
      timeoutMs: config.upstreamTimeoutMs,
    });
    return expectOk('inventory-api', res);
  });

  app.get<{ Querystring: { limit?: string } }>('/orders', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const { rows } = await pool.query(
      `SELECT o.id, o.status, o.total_cents, o.failure_reason, o.trace_id, o.created_at, o.updated_at,
              COALESCE(json_agg(json_build_object('product_id', i.product_id, 'qty', i.qty, 'price_cents', i.price_cents, 'name', p.name))
                       FILTER (WHERE i.product_id IS NOT NULL), '[]') AS items
         FROM orders o
         LEFT JOIN order_items i ON i.order_id = o.id
         LEFT JOIN products p ON p.id = i.product_id
        WHERE o.user_id = $1
        GROUP BY o.id
        ORDER BY o.created_at DESC
        LIMIT $2`,
      [req.user.id, limit],
    );
    return { orders: rows };
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (req) => {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new AppError(404, 'order_not_found', `Order ${req.params.id} not found`);
    return rows[0];
  });

  app.post<{ Body: CreateOrderBody }>('/orders', async (req, reply) => {
    const startedAt = Date.now();
    const body = req.body ?? ({} as CreateOrderBody);
    const chaos = body.chaos ?? '';
    const user = req.user;
    const span = trace.getActiveSpan();

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new AppError(400, 'invalid_order', 'Order must contain at least one item');
    }
    for (const item of body.items) {
      if (!Number.isInteger(item.productId) || !Number.isInteger(item.qty) || item.qty <= 0) {
        throw new AppError(400, 'invalid_order', 'Each item needs an integer productId and a positive qty', { item });
      }
    }

    const orderId = randomUUID();
    span?.setAttributes({ 'order.id': orderId, 'order.chaos': chaos || 'none', 'order.items': body.items.length });
    req.log.info({ order_id: orderId, chaos: chaos || undefined, items: body.items }, 'checkout started');

    // Scenario: a plain unhandled bug in this service.
    if (chaos === 'throw') {
      throw new Error('Chaos: unhandled exception in orders-api (simulated bug in checkout)');
    }
    // Scenario: unhandled async error outside the request (fires after the response)
    if (chaos === 'background_throw') {
      setTimeout(() => {
        Promise.reject(new Error('Chaos: unhandled promise rejection in orders-api background task'));
      }, 50);
    }

    const headers = userHeaders(user, user.sessionId);

    // 1. Reserve stock (inventory-api, Node + Postgres). Any non-2xx is a cascade failure here,
    //    except 409 out-of-stock which is a business error we pass through.
    const reserveRes = await callService<ReservationResult | { error: string; message: string }>(
      'inventory-api',
      `${config.inventoryUrl}/reserve`,
      { body: { orderId, items: body.items, chaos }, headers, timeoutMs: config.upstreamTimeoutMs },
    );
    if (reserveRes.status === 409) {
      const e = reserveRes.data as { error: string; message: string };
      ordersFailed.add(1, { reason: 'out_of_stock' });
      throw new AppError(409, e.error ?? 'out_of_stock', e.message ?? 'Item out of stock');
    }
    const reservation = expectOk('inventory-api', reserveRes) as ReservationResult;

    // 2. Charge the card (payments, Python). 402 = declined (handled). Crash/timeout = cascade.
    let paymentId: string;
    try {
      const chargeRes = await callService<{ payment_id?: string; error?: string; message?: string }>(
        'payments',
        `${config.paymentsUrl}/charge`,
        {
          body: { order_id: orderId, amount_cents: reservation.total_cents, currency: 'USD', user_id: user.id, card: user.card, chaos },
          headers,
          timeoutMs: config.upstreamTimeoutMs,
        },
      );
      if (chargeRes.status === 402) {
        await releaseStock(orderId, body.items, headers);
        ordersFailed.add(1, { reason: 'payment_declined' });
        req.log.warn({ order_id: orderId, card: user.card }, 'payment declined');
        throw new AppError(402, 'payment_declined', chargeRes.data?.message ?? 'Card declined', { card_last4: user.card });
      }
      paymentId = expectOk('payments', chargeRes).payment_id!;
    } catch (err) {
      if (!(err instanceof AppError)) {
        ordersFailed.add(1, { reason: 'payments_failure' });
        await releaseStock(orderId, body.items, headers).catch((e) => req.log.error({ err: e }, 'stock release failed'));
      }
      throw err;
    }

    // 3. Persist the order (Postgres transaction). chaos=db_write_fail violates a CHECK constraint on purpose.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const total = chaos === 'db_write_fail' ? -1 : reservation.total_cents;
      await client.query(
        `INSERT INTO orders (id, user_id, user_name, status, total_cents, payment_id, trace_id)
         VALUES ($1, $2, $3, 'paid', $4, $5, $6)`,
        [orderId, user.id, user.name, total, paymentId, span?.spanContext().traceId ?? null],
      );
      for (const it of reservation.items) {
        await client.query('INSERT INTO order_items (order_id, product_id, qty, price_cents) VALUES ($1, $2, $3, $4)', [
          orderId,
          it.product_id,
          it.qty,
          it.price_cents,
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      ordersFailed.add(1, { reason: 'db_error' });
      throw err;
    } finally {
      client.release();
    }

    // 4. Hand over to the worker. We pass the W3C trace context inside the job payload so the
    //    asynchronous fulfilment shows up in the same trace.
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    const jobChaos = user.personality === 'async-fail' ? 'async_fail' : chaos;
    await ordersQueue.add(
      'fulfill-order',
      { orderId, userId: user.id, userName: user.name, chaos: jobChaos, traceparent: carrier.traceparent, tracestate: carrier.tracestate },
      { jobId: orderId },
    );

    ordersCreated.add(1, { user_plan: user.plan });
    orderValue.record(reservation.total_cents, { user_plan: user.plan });
    checkoutDuration.record(Date.now() - startedAt, { outcome: 'ok' });
    req.log.info({ order_id: orderId, total_cents: reservation.total_cents, payment_id: paymentId, duration_ms: Date.now() - startedAt }, 'checkout completed');

    return reply.status(201).send({
      orderId,
      status: 'paid',
      total_cents: reservation.total_cents,
      items: reservation.items,
      trace_id: span?.spanContext().traceId,
    });
  });
}

async function releaseStock(orderId: string, items: CreateOrderBody['items'], headers: Record<string, string>): Promise<void> {
  const res = await callService('inventory-api', `${config.inventoryUrl}/release`, { body: { orderId, items }, headers, timeoutMs: config.upstreamTimeoutMs });
  expectOk('inventory-api', res);
}
