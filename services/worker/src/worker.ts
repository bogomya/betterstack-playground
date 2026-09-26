import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { SpanKind, SpanStatusCode, context, metrics, propagation, trace } from '@opentelemetry/api';
import { ChaosStore, burnCpu, captureException, createLogger, findUser, sleep } from '@bsdemo/shared';

const SERVICE = 'worker';
const QUEUE_NAME = 'orders';
const tracer = trace.getTracer(SERVICE);
const meter = metrics.getMeter(SERVICE);
const jobsProcessed = meter.createCounter('jobs.processed', { description: 'Jobs processed by name and outcome' });
const jobDuration = meter.createHistogram('jobs.duration', { unit: 'ms', description: 'Job processing time' });

interface FulfillJob {
  orderId: string;
  userId: string;
  userName: string;
  chaos?: string;
  traceparent?: string;
  tracestate?: string;
}

export async function start(): Promise<void> {
  const log = createLogger(SERVICE);
  const chaos = ChaosStore.fromEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://bsdemo:bsdemo@localhost:5432/bsdemo', max: 5, application_name: SERVICE });
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const memoryHogs: Buffer[] = [];

  async function fulfillOrder(job: Job<FulfillJob>): Promise<void> {
    const { orderId, userId, chaos: scenario = '' } = job.data;
    const user = findUser(userId);
    const flags = await chaos.get('worker');
    const mode = flags.mode ?? 'ok';
    const attempt = job.attemptsMade + 1;
    const jlog = log.child({ job_id: job.id, job: job.name, order_id: orderId, user_id: userId, attempt });
    jlog.info({ chaos: scenario || undefined, mode }, 'fulfilment started');

    // Simulated work: generate a shipping label with a third-party carrier
    await tracer.startActiveSpan('carrier.create_label', async (span) => {
      await sleep(300 + Math.random() * 900);
      span.end();
    });

    if (scenario === 'worker_slow' || mode === 'slow') await sleep(5000);
    if (scenario === 'worker_cpu' || mode === 'cpu') burnCpu(8000);

    if (scenario === 'async_fail' || mode === 'fail') {
      throw new Error(`Shipping label service rejected order ${orderId}: carrier API returned 500 (attempt ${attempt})`);
    }

    await pool.query("UPDATE orders SET status = 'fulfilled', updated_at = now() WHERE id = $1", [orderId]);
    jlog.info({ user_plan: user.plan }, 'order fulfilled');
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const data = job.data as Partial<FulfillJob>;
      const parentCtx = data.traceparent
        ? propagation.extract(context.active(), { traceparent: data.traceparent, tracestate: data.tracestate })
        : context.active();
      const attempts = job.opts.attempts ?? 1;
      const attempt = job.attemptsMade + 1;

      return tracer.startActiveSpan(
        `process ${job.name}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'bullmq',
            'messaging.operation.type': 'process',
            'messaging.destination.name': QUEUE_NAME,
            'messaging.message.id': String(job.id),
            'job.name': job.name,
            'job.attempt': attempt,
            'job.max_attempts': attempts,
            ...(data.orderId ? { 'order.id': data.orderId, 'enduser.id': data.userId ?? 'unknown' } : {}),
          },
        },
        parentCtx,
        async (span) => {
          const started = Date.now();
          try {
            switch (job.name) {
              case 'fulfill-order':
                await fulfillOrder(job as Job<FulfillJob>);
                break;
              case 'cpu-burn': {
                const seconds = Number((job.data as { seconds?: number }).seconds ?? 10);
                log.warn({ job_id: job.id, seconds }, 'burning CPU on purpose');
                burnCpu(seconds * 1000);
                break;
              }
              case 'memory-hog': {
                const mb = Number((job.data as { mb?: number }).mb ?? 200);
                log.warn({ job_id: job.id, mb }, 'allocating memory on purpose (kept for 60s)');
                const buf = Buffer.alloc(mb * 1024 * 1024, 1);
                memoryHogs.push(buf);
                setTimeout(() => memoryHogs.splice(memoryHogs.indexOf(buf), 1), 60_000);
                break;
              }
              default:
                throw new Error(`Unknown job type ${job.name}`);
            }
            span.setStatus({ code: SpanStatusCode.OK });
            jobsProcessed.add(1, { job: job.name, outcome: 'ok' });
          } catch (err) {
            const final = attempt >= attempts;
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            span.setAttribute('job.final_failure', final);
            jobsProcessed.add(1, { job: job.name, outcome: final ? 'failed' : 'retry' });
            log.error({ err, job_id: job.id, job: job.name, attempt, final, order_id: data.orderId }, final ? 'job failed permanently' : 'job failed, will retry');
            captureException(err, {
              user: data.userId ? findUser(data.userId) : undefined,
              tags: { job: job.name, attempt, final, queue: QUEUE_NAME, kind: 'async' },
              extra: { job_id: job.id, job_data: { ...data, traceparent: undefined } },
            });
            if (final && data.orderId) {
              await pool
                .query("UPDATE orders SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1", [data.orderId, (err as Error).message])
                .catch((e) => log.error({ err: e }, 'could not mark order as failed'));
            }
            throw err;
          } finally {
            jobDuration.record(Date.now() - started, { job: job.name });
            span.end();
          }
        },
      );
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3) },
  );

  worker.on('error', (err) => log.error({ err }, 'worker error'));
  worker.on('ready', () => log.info({ queue: QUEUE_NAME }, 'worker ready'));
}
