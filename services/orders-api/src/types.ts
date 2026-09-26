import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import type { Logger } from 'pino';
import type { DemoUser } from '@bsdemo/shared';

/** Fastify instance typed with the pino logger we inject via loggerInstance */
export type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

declare module 'fastify' {
  interface FastifyRequest {
    user: DemoUser & { sessionId?: string };
  }
}

export interface OrderItemInput {
  productId: number;
  qty: number;
}

export interface CreateOrderBody {
  items: OrderItemInput[];
  /** Scenario selector, e.g. "throw", "inventory_throw", "payments_crash", "async_fail" (see docs/scenarios.md) */
  chaos?: string;
}

export interface ReservationResult {
  total_cents: number;
  items: { product_id: number; name: string; qty: number; price_cents: number }[];
}
