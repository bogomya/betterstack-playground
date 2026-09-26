import type { App } from './types.js';
import { callService, type ChaosStore } from '@bsdemo/shared';
import { config } from './config.js';
import { ordersQueue } from './queue.js';

/** Chaos control plane used by the Lab page. */
export function registerAdminRoutes(app: App, chaos: ChaosStore): void {
  app.get('/admin/chaos', async () => chaos.all());

  app.put<{ Params: { service: string }; Body: { key: string; value: string | null } }>('/admin/chaos/:service', async (req) => {
    const { key, value } = req.body ?? ({} as { key: string; value: string | null });
    if (!key) return { error: 'key required' };
    await chaos.set(req.params.service, key, value);
    req.log.info({ chaos_service: req.params.service, key, value }, 'chaos flag changed');
    return { ok: true, flags: await chaos.get(req.params.service) };
  });

  app.delete<{ Params: { service?: string } }>('/admin/chaos/:service?', async (req) => {
    await chaos.reset(req.params.service || undefined);
    req.log.info({ chaos_service: req.params.service ?? '*' }, 'chaos flags reset');
    return { ok: true };
  });

  app.get('/admin/loadgen', async () => {
    const cfg = await chaos.client.hgetall('loadgen:config');
    return { enabled: cfg.enabled === '1', rps: Number(cfg.rps ?? 2), profile: cfg.profile ?? 'mixed', stats: await chaos.client.hgetall('loadgen:stats') };
  });

  app.put<{ Body: { enabled?: boolean; rps?: number; profile?: string } }>('/admin/loadgen', async (req) => {
    const b = req.body ?? {};
    const update: Record<string, string> = {};
    if (b.enabled !== undefined) update.enabled = b.enabled ? '1' : '0';
    if (b.rps !== undefined) update.rps = String(Math.max(0.1, Math.min(20, Number(b.rps))));
    if (b.profile) update.profile = b.profile;
    if (Object.keys(update).length) await chaos.client.hset('loadgen:config', update);
    req.log.info({ loadgen: update }, 'loadgen config changed');
    return { ok: true, config: await chaos.client.hgetall('loadgen:config') };
  });

  app.post<{ Body: { seconds?: number } }>('/admin/jobs/cpu-burn', async (req) => {
    const seconds = Math.min(Number(req.body?.seconds ?? 10), 60);
    const job = await ordersQueue.add('cpu-burn', { seconds }, { attempts: 1 });
    req.log.info({ job_id: job.id, seconds }, 'cpu-burn job queued');
    return { ok: true, jobId: job.id, seconds };
  });

  app.post<{ Body: { mb?: number } }>('/admin/jobs/memory-hog', async (req) => {
    const mb = Math.min(Number(req.body?.mb ?? 200), 800);
    const job = await ordersQueue.add('memory-hog', { mb }, { attempts: 1 });
    return { ok: true, jobId: job.id, mb };
  });

  // Aggregated view for the Lab page header
  app.get('/admin/status', async () => {
    const [counts, cronState, loadgen, flags] = await Promise.all([
      ordersQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      chaos.client.hgetall('cron:state'),
      chaos.client.hgetall('loadgen:config'),
      chaos.all(),
    ]);
    const probe = async (name: string, url: string) => {
      try {
        const res = await callService(name, url, { timeoutMs: 2000 });
        return { name, status: res.status, body: res.data };
      } catch (e) {
        return { name, status: 0, body: (e as Error).message };
      }
    };
    const services = await Promise.all([
      probe('orders-api', `http://localhost:${config.port}/health`),
      probe('inventory-api', `${config.inventoryUrl}/health`),
      probe('payments', `${config.paymentsUrl}/health`),
    ]);
    return { services, queue: counts, cron: cronState, loadgen, chaos: flags, release: process.env.APP_RELEASE ?? 'dev' };
  });
}
