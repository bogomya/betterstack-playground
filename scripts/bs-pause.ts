/**
 * Pauses or resumes everything that can page you: monitors, the heartbeat and telemetry alerts.
 *   pnpm bs:pause | bs:resume | bs:status   [--monitors] [--heartbeat] [--alerts]
 */
import { loadDotEnv, log, readState, telemetry, uptime } from './lib/bs.js';

loadDotEnv();
const state = readState();
const mode = process.argv[2];
const flags = process.argv.slice(3);
const all = !flags.some((f) => ['--monitors', '--heartbeat', '--alerts'].includes(f));
const scope = {
  monitors: all || flags.includes('--monitors'),
  heartbeat: all || flags.includes('--heartbeat'),
  alerts: all || flags.includes('--alerts'),
};

async function setPaused(paused: boolean): Promise<void> {
  if (scope.monitors) {
    for (const [key, m] of Object.entries(state.monitors ?? {})) {
      const res = await uptime(`/api/v2/monitors/${m.id}`, { method: 'PATCH', body: { paused } });
      log(`monitor ${key}: ${res.data.attributes.paused ? 'paused' : 'active'} (${res.data.attributes.status})`);
    }
  }
  if (scope.heartbeat && state.heartbeat) {
    const res = await uptime(`/api/v2/heartbeats/${state.heartbeat.id}`, { method: 'PATCH', body: { paused } });
    log(`heartbeat: ${res.data.attributes.paused_at ? 'paused' : 'active'}`);
  }
  if (scope.alerts) {
    for (const [key, id] of Object.entries(state.alerts ?? {})) {
      const res = await telemetry(`/api/v2/alerts/${id}`, { method: 'PATCH', body: { paused } });
      log(`alert ${key}: ${res.data.attributes.paused ? 'paused' : 'active'}`);
    }
  }
}

async function status(): Promise<void> {
  for (const [key, m] of Object.entries(state.monitors ?? {})) {
    const a = (await uptime(`/api/v2/monitors/${m.id}`)).data.attributes;
    log(`monitor ${key.padEnd(9)} ${a.paused ? 'PAUSED' : 'active'} status=${a.status} confirmation=${a.confirmation_period}s url=${a.url}`);
  }
  if (state.heartbeat) {
    const a = (await uptime(`/api/v2/heartbeats/${state.heartbeat.id}`)).data.attributes;
    log(`heartbeat          ${a.paused_at ? 'PAUSED' : 'active'} status=${a.status}`);
  }
  for (const [key, id] of Object.entries(state.alerts ?? {})) {
    const a = (await telemetry(`/api/v2/alerts/${id}`)).data.attributes;
    log(`alert ${key.padEnd(17)} ${a.paused ? 'PAUSED' : 'active'} type=${a.alert_type}${a.anomaly_trigger ? ` trigger=${a.anomaly_trigger}` : ''}`);
  }
  const open = (await uptime('/api/v3/incidents?resolved=false&per_page=50')).data ?? [];
  log(`open incidents: ${open.length}`);
  for (const i of open) log(`  ${i.attributes.status} ${i.attributes.started_at} ${i.attributes.name} | ${i.attributes.cause}`);
}

async function main(): Promise<void> {
  if (mode === 'pause') await setPaused(true);
  else if (mode === 'resume') await setPaused(false);
  else if (mode === 'status') await status();
  else {
    console.log('usage: bs-pause.ts pause|resume|status [--monitors] [--heartbeat] [--alerts]');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('bs-pause failed:', err.message ?? err);
  process.exit(1);
});
