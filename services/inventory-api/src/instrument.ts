import { initTelemetry } from '@bsdemo/shared/telemetry';

initTelemetry({ serviceName: 'inventory-api' });

import('./server.js')
  .then((m) => m.start())
  .catch((err) => {
    console.error('inventory-api failed to start', err);
    process.exit(1);
  });
