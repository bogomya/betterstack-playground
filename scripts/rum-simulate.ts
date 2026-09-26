/**
 * Drives real (headless Chromium) browser sessions through the storefront so Better Stack RUM has
 * sessions, replays, identified users, custom events and frontend errors to look at.
 *   pnpm rum:simulate                 # 6 sessions against the tunnel URL (or LOCAL_URL)
 *   pnpm rum:simulate 12 --headed     # more sessions, visible browser
 * Session mix: good checkout journeys (alice/guest), declined card (bob), slow pages (carol),
 * frontend errors + rage clicks (dave), abandoned carts.
 */
import { chromium, type Page } from 'playwright';
import { readState } from './lib/bs.js';

const state = readState();
const BASE = (process.env.LOCAL_URL ?? process.env.PUBLIC_URL ?? state.publicUrl ?? 'http://localhost:8080').replace(/\/$/, '');
const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 6);
const HEADED = process.argv.includes('--headed');

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
];

type Journey = 'good_checkout' | 'declined' | 'slow_user' | 'frontend_errors' | 'abandoned_cart' | 'async_fail';
const MIX: [Journey, number][] = [
  ['good_checkout', 35],
  ['abandoned_cart', 15],
  ['declined', 15],
  ['slow_user', 10],
  ['frontend_errors', 15],
  ['async_fail', 10],
];
const USER_FOR: Record<Journey, string> = {
  good_checkout: 'u-alice',
  abandoned_cart: 'guest',
  declined: 'u-bob',
  slow_user: 'u-carol',
  frontend_errors: 'u-dave',
  async_fail: 'u-dave',
};

function pick<T>(items: [T, number][]): T {
  let r = Math.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [i, w] of items) if ((r -= w) <= 0) return i;
  return items[0][0];
}

async function switchUser(page: Page, userId: string): Promise<void> {
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await pause(rnd(800, 1500));
  await page.getByTestId(`switch-user-${userId}`).click();
  await pause(rnd(1000, 2000));
}

async function shop(page: Page, products: number[]): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await pause(rnd(1500, 3000));
  for (const p of products) {
    await page.goto(`${BASE}/product/${p}`, { waitUntil: 'networkidle' });
    await pause(rnd(1000, 2500));
    await page.getByTestId('add-to-cart').click();
    await pause(rnd(500, 1200));
  }
}

async function checkout(page: Page): Promise<string> {
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' });
  await pause(rnd(1000, 2000));
  await page.getByTestId('checkout').click();
  await page.waitForSelector('text=/Order|Checkout failed/', { timeout: 30_000 }).catch(() => undefined);
  const text = (await page.locator('main').innerText()).slice(0, 200).replace(/\s+/g, ' ');
  await pause(rnd(1500, 3000));
  return text;
}

async function runJourney(journey: Journey, index: number): Promise<string> {
  const browser = await chromium.launch({ headless: !HEADED });
  const mobile = Math.random() < 0.3;
  const context = await browser.newContext({
    userAgent: UAS[index % UAS.length],
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 850 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  let summary = '';
  try {
    await switchUser(page, USER_FOR[journey]);
    switch (journey) {
      case 'good_checkout':
        await shop(page, [1, 4]);
        summary = await checkout(page);
        await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
        await pause(6000);
        break;
      case 'abandoned_cart':
        await shop(page, [2]);
        await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' });
        await pause(rnd(2000, 4000));
        summary = 'left with items in cart';
        break;
      case 'declined':
        await shop(page, [3]);
        summary = await checkout(page);
        // second try, still declined
        await shop(page, [3]);
        summary += ' | ' + (await checkout(page));
        break;
      case 'slow_user':
        await page.goto(`${BASE}/slow`, { waitUntil: 'networkidle' });
        await pause(1500);
        await shop(page, [5]);
        summary = await checkout(page);
        break;
      case 'async_fail':
        await shop(page, [6]);
        summary = await checkout(page);
        await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
        await pause(12_000);
        break;
      case 'frontend_errors':
        await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle' });
        await pause(2000);
        for (const s of ['fe_throw', 'fe_reject', 'fe_fetch_404', 'fe_track']) {
          page.once('dialog', (d) => void d.dismiss());
          await page.locator(`[data-scenario="${s}"]`).click().catch(() => undefined);
          await pause(rnd(800, 1600));
        }
        const rage = page.getByTestId('rage-target');
        for (let i = 0; i < 7; i++) {
          await rage.click({ delay: 20 });
          await pause(120);
        }
        await pause(1500);
        await page.goto(`${BASE}/boom`, { waitUntil: 'networkidle' }).catch(() => undefined);
        await pause(2500);
        summary = 'frontend errors + rage clicks + render crash';
        break;
    }
  } catch (e) {
    summary = `error: ${(e as Error).message.slice(0, 120)}`;
  }
  // let the tag flush
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await pause(3000);
  await context.close();
  await browser.close();
  return summary;
}

async function main(): Promise<void> {
  console.log(`Simulating ${COUNT} sessions against ${BASE} (${HEADED ? 'headed' : 'headless'})`);
  for (let i = 0; i < COUNT; i++) {
    const journey = pick(MIX);
    const started = Date.now();
    const summary = await runJourney(journey, i);
    console.log(`#${i + 1} ${journey.padEnd(16)} ${USER_FOR[journey].padEnd(8)} ${Math.round((Date.now() - started) / 1000)}s  ${summary}`);
  }
  console.log('Done. Open https://rum.betterstack.com/team/0/sessions');
}

main().catch((err) => {
  console.error('rum-simulate failed:', err);
  process.exit(1);
});
