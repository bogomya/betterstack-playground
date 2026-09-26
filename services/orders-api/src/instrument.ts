// Telemetry must be registered before any application module is loaded.
import { initTelemetry } from '@bsdemo/shared/telemetry';

initTelemetry({ serviceName: 'orders-api' });

import('./server.js')
  .then((m) => m.start())
  .catch((err) => {
    console.error('orders-api failed to start', err);
    process.exit(1);
  });
