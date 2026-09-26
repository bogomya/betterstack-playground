export const config = {
  port: Number(process.env.PORT ?? 4001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://bsdemo:bsdemo@localhost:5432/bsdemo',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  inventoryUrl: process.env.INVENTORY_URL ?? 'http://localhost:4002',
  paymentsUrl: process.env.PAYMENTS_URL ?? 'http://localhost:4003',
  webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 5000),
  serviceName: 'orders-api',
};
