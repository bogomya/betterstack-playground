import { Pool } from 'pg';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { ChaosStore, captureException, createLogger } from '@bsdemo/shared';

/**
 * Every INTERVAL the job aggregates the last hour of orders into daily_reports and then pings the
 * Better Stack heartbeat URL:
 *   GET  $BS_HEARTBEAT_URL        -> "I ran fine"
 *   POST $BS_HEARTBEAT_URL/fail   -> "I ran and failed" (body = diagnostic output)
 * Chaos flag chaos:cron heartbeat = skip | fail | crash controls the behaviour from the Lab.
 */
const SERVICE = 'cron';
const INTERVAL_MS = Number(process.env.CRON_INTERVAL_MS ?? 60_000);
const tracer = trace.getTracer(SERVICE);

export async function start(): Promise<void> {
  const log = createLogger(SERVICE);
  const chaos = ChaosStore.fromEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://bsdemo:bsdemo@localhost:5432/bsdemo', max: 2, application_name: SERVICE });
  const heartbeatUrl = process.env.BS_HEARTBEAT_URL;
  if (!heartbeatUrl) log.warn('BS_HEARTBEAT_URL not set: the report job will run but not ping Better Stack');
  let runs = 0;

  async function pingHeartbeat(mode: string, output: string): Promise<string> {
    if (!heartbeatUrl) return 'not-configured';
    if (mode === 'skip') {
      log.warn('heartbeat ping skipped on purpose (chaos heartbeat=skip)');
      return 'skipped';
    }
    const url = mode === 'fail' ? `${heartbeatUrl}/fail` : heartbeatUrl;
    const res = await fetch(url, { method: 'POST', body: output, headers: { 'content-type': 'text/plain' } });
    log.info({ heartbeat_status: res.status, mode }, 'heartbeat pinged');
    return `${res.status}`;
  }

  async function runOnce(): Promise<void> {
    runs += 1;
    await tracer.startActiveSpan('cron.hourly-report', async (span) => {
      const mode = (await chaos.flag('cron', 'heartbeat')) ?? 'ok';
      span.setAttribute('cron.mode', mode);
      const startedAt = Date.now();
      let output = '';
      try {
        if (mode === 'crash') throw new Error('Cron report job crashed: division by zero in revenue aggregation');
        const { rows } = await pool.query<{ orders_seen: number; revenue_cents: number }>(
          `SELECT count(*)::int AS orders_seen, COALESCE(sum(total_cents), 0)::int AS revenue_cents
             FROM orders WHERE created_at > now() - interval '1 hour'`,
        );
        await pool.query('INSERT INTO daily_reports (orders_seen, revenue_cents) VALUES ($1, $2)', [rows[0].orders_seen, rows[0].revenue_cents]);
        output = `orders_seen=${rows[0].orders_seen} revenue_cents=${rows[0].revenue_cents} duration_ms=${Date.now() - startedAt}`;
        log.info({ ...rows[0], duration_ms: Date.now() - startedAt, run: runs }, 'hourly report stored');
        const hb = await pingHeartbeat(mode, output);
        await chaos.client.hset('cron:state', { last_run: new Date().toISOString(), last_status: 'ok', last_heartbeat: hb, runs: String(runs), mode });
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        log.error({ err, run: runs }, 'report job failed');
        captureException(err, { tags: { job: 'hourly-report', kind: 'cron' }, extra: { run: runs } });
        const hb = await pingHeartbeat('fail', `report job failed: ${(err as Error).message}`).catch(() => 'ping-failed');
        await chaos.client.hset('cron:state', { last_run: new Date().toISOString(), last_status: 'error', last_heartbeat: hb, runs: String(runs), mode });
      } finally {
        span.end();
      }
    });
  }

  log.info({ interval_ms: INTERVAL_MS, heartbeat: heartbeatUrl ? 'configured' : 'missing' }, 'cron started');
  await runOnce();
  setInterval(() => void runOnce(), INTERVAL_MS);
}
