/**
 * Deletes everything bs-setup/bs-sync/bs-verify created (by the IDs stored in .bs-state.json).
 *   pnpm bs:teardown --yes
 */
import fs from 'node:fs';
import { ENV_BS_FILE, STATE_FILE, errors, loadDotEnv, log, readState, telemetry, uptime } from './lib/bs.js';

loadDotEnv();
const state = readState();

async function del(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    log(`deleted ${label}`);
  } catch (e) {
    log(`skip ${label}: ${(e as Error).message.slice(0, 120)}`);
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes the bsdemo monitors, status page, heartbeat, policy, severity, error applications, collector, source, connection and dashboard from your Better Stack account.');
    console.log('Re-run with --yes to confirm.');
    return;
  }
  for (const [k, m] of Object.entries(state.monitors ?? {})) await del(`monitor ${k}`, () => uptime(`/api/v2/monitors/${m.id}`, { method: 'DELETE' }));
  if (state.statusPage) await del('status page', () => uptime(`/api/v2/status-pages/${state.statusPage!.id}`, { method: 'DELETE' }));
  if (state.heartbeat) await del('heartbeat', () => uptime(`/api/v2/heartbeats/${state.heartbeat!.id}`, { method: 'DELETE' }));
  if (state.monitorGroup) await del('monitor group', () => uptime(`/api/v2/monitor-groups/${state.monitorGroup!.id}`, { method: 'DELETE' }));
  for (const [k, id] of Object.entries(state.alerts ?? {})) await del(`alert ${k}`, () => telemetry(`/api/v2/alerts/${id}`, { method: 'DELETE' }));
  if (state.dashboard) await del('dashboard', () => telemetry(`/api/v2/dashboards/${state.dashboard!.id}`, { method: 'DELETE' }));
  if (state.policy) await del('escalation policy', () => uptime(`/api/v3/policies/${state.policy!.id}`, { method: 'DELETE' }));
  if (state.urgency) await del('severity', () => uptime(`/api/v2/urgencies/${state.urgency!.id}`, { method: 'DELETE' }));
  for (const [k, a] of Object.entries(state.apps ?? {})) await del(`errors application ${k}`, () => errors(`/api/v2/applications/${a.id}`, { method: 'DELETE' }));
  if (state.connection) await del('SQL API connection', () => telemetry(`/api/v1/connections/${state.connection!.id}`, { method: 'DELETE' }));
  if (state.collector) await del('collector', () => telemetry(`/api/v1/collectors/${state.collector!.id}`, { method: 'DELETE' }));
  if (state.source) await del('telemetry source', () => telemetry(`/api/v2/sources/${state.source!.id}`, { method: 'DELETE' }));
  for (const f of [STATE_FILE, ENV_BS_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  log('removed .bs-state.json and .env.bs');
}

main().catch((err) => {
  console.error('bs-teardown failed:', err.message ?? err);
  process.exit(1);
});
