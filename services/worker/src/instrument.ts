import { initTelemetry } from '@bsdemo/shared/telemetry';

// ioredis instrumentation is disabled here: BullMQ's blocking poll commands would create a
// never-ending stream of multi-second Redis spans that drown the interesting job spans.
initTelemetry({ serviceName: 'worker', disable: ['@opentelemetry/instrumentation-ioredis'] });

import('./worker.js')
  .then((m) => m.start())
  .catch((err) => {
    console.error('worker failed to start', err);
    process.exit(1);
  });
