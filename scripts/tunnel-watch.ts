/** Restarts the Cloudflare quick tunnel when it dies (e.g. after a laptop sleep) and re-points monitors via bs-sync. */
import { execSync, spawnSync } from 'node:child_process';
import { ROOT, log, readState, tunnelUrlFromDocker } from './lib/bs.js';

const INTERVAL_MS = 30_000;
const FAILURES_BEFORE_RESTART = 4;

function compose(args: string): string {
  return execSync(`docker compose --env-file .env.bs ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

async function probe(url: string): Promise<number> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${url}/svc/orders/health`, { signal: controller.signal, cache: 'no-store' });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

async function rotate(oldUrl: string | undefined): Promise<void> {
  log('restarting the tunnel container');
  compose('restart tunnel');
  let fresh: string | undefined;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const logs = compose('logs --no-log-prefix --no-color --tail 40 tunnel');
    const m = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    fresh = m?.[m.length - 1];
    if (fresh && fresh !== oldUrl) break;
  }
  if (!fresh) {
    log('no new tunnel URL appeared within 90 s; will retry on the next tick');
    return;
  }
  log(`new tunnel URL ${fresh}; re-pointing monitors and status page`);
  const r = spawnSync('node_modules/.bin/tsx', ['scripts/bs-sync.ts', fresh], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) log('bs-sync failed; run `pnpm bs:sync` manually');
}

async function main(): Promise<void> {
  let url = readState().publicUrl ?? tunnelUrlFromDocker();
  let failures = 0;
  log(`watching ${url ?? '(no URL yet)'} every ${INTERVAL_MS / 1000}s`);
  for (;;) {
    const recentLogs = compose('logs --no-log-prefix --no-color --tail 15 tunnel');
    const tunnelGone = (recentLogs.match(/Tunnel not found/g) ?? []).length >= 5;
    const status = url ? await probe(url) : 0;
    if (status >= 200 && status < 500) {
      if (failures) log(`recovered (${status})`);
      failures = 0;
    } else {
      failures += 1;
      log(`probe ${status || 'failed'} (${failures}/${FAILURES_BEFORE_RESTART})${tunnelGone ? ', cloudflared reports "Tunnel not found"' : ''}`);
    }
    if (tunnelGone || failures >= FAILURES_BEFORE_RESTART) {
      await rotate(url);
      url = readState().publicUrl ?? tunnelUrlFromDocker();
      failures = 0;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('tunnel-watch failed:', err);
  process.exit(1);
});
