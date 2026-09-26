import { initTelemetry } from '@bsdemo/shared/telemetry';

initTelemetry({ serviceName: 'cron', disable: ['@opentelemetry/instrumentation-ioredis'] });

import('./cron.js')
  .then((m) => m.start())
  .catch((err) => {
    console.error('cron failed to start', err);
    process.exit(1);
  });
