import type { NextConfig } from 'next';
import { withBetterStack } from '@logtail/next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@bsdemo/shared'],
  // Keep browser source maps so they can be uploaded to Better Stack Errors (Sentry-compatible tooling).
  productionBrowserSourceMaps: true,
  serverExternalPackages: ['@sentry/node', 'import-in-the-middle', 'require-in-the-middle'],
};

// withBetterStack proxies browser logs and Web Vitals; it is a no-op without the env vars.
export default withBetterStack(config);
