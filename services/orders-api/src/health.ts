import type { App } from './types.js';
import type { ChaosStore } from '@bsdemo/shared';
import { pool } from './db.js';
import { config } from './config.js';

const startedAt = Date.now();

export function registerHealthRoutes(app: App, chaos: ChaosStore): void {
  // Shallow health: what the Better Stack Uptime monitor hits. The Lab can flip it to 503.
  app.get('/health', async (req, reply) => {
    const failing = (await chaos.flag('orders', 'health_fail')) === '1';
    if (failing) {
      req.log.warn('health check failing on purpose (chaos health_fail)');
      return reply.status(503).send({ status: 'failing', service: config.serviceName, reason: 'chaos:health_fail' });
    }
    return { status: 'ok', service: config.serviceName, uptime_s: Math.round((Date.now() - startedAt) / 1000), release: process.env.APP_RELEASE ?? 'dev' };
  });

  app.get('/health/deep', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await pool.query('SELECT 1');
      checks.postgres = 'ok';
    } catch (e) {
      checks.postgres = `error: ${(e as Error).message}`;
    }
    try {
      await chaos.client.ping();
      checks.redis = 'ok';
    } catch (e) {
      checks.redis = `error: ${(e as Error).message}`;
    }
    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
  });
}
