import { chromium } from 'playwright';
// Quick check that the Better Stack JS tag loads and sends RUM/error requests: pnpm tsx scripts/rum-check.mts
const base = process.env.LOCAL_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const page = await browser.newPage();
const seen: string[] = [];
page.on('response', (r) => {
  const u = r.url();
  if (/betterstack/.test(u)) seen.push(`${r.status()} ${r.request().method().padEnd(4)} ${u.replace(/\?.*$/, '').slice(0, 100)}`);
});
await page.goto(`${base}/lab`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const tag = await page.evaluate(() => ({ betterstack: typeof (window as any).betterstack, Sentry: typeof (window as any).Sentry, traceparentMeta: document.querySelector('meta[name=traceparent]')?.getAttribute('content') }));
page.once('dialog', (d) => void d.dismiss());
await page.locator('[data-scenario="fe_throw"]').click().catch(() => undefined);
await page.locator('[data-scenario="fe_track"]').click().catch(() => undefined);
await page.waitForTimeout(6000);
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
console.log('window:', JSON.stringify(tag));
console.log('requests to Better Stack hosts:');
for (const s of [...new Set(seen)]) console.log('  ' + s);
await browser.close();
