/**
 * Creates (idempotently) everything the demo needs inside your Better Stack account and writes .env.bs:
 *   Telemetry: one OpenTelemetry source (logs+metrics+traces from all services), one Docker collector
 *   Errors:    one application per service, correlated with the telemetry source
 *   Uptime:    severity (e-mail + push), escalation policy, heartbeat for the cron job, monitor group
 * Monitors and the status page need the public tunnel URL and are created by bs-sync.ts.
 */
import { PREFIX, errors, listAll, loadDotEnv, log, readState, telemetry, uptime, writeEnvBs, writeState } from './lib/bs.js';

loadDotEnv();
const state = readState();

async function discoverTeamName(): Promise<string> {
  if (process.env.BS_TEAM_NAME) return process.env.BS_TEAM_NAME;
  if (state.teamName) return state.teamName;
  const sources = await telemetry('/api/v2/sources');
  const fromSource = sources?.data?.[0]?.attributes?.team_name;
  if (fromSource) return fromSource;
  const monitors = await uptime('/api/v2/monitors');
  const fromMonitor = monitors?.data?.[0]?.attributes?.team_name;
  if (fromMonitor) return fromMonitor;
  throw new Error('Could not discover the team name; set BS_TEAM_NAME in .env');
}

async function main(): Promise<void> {
  const teamName = await discoverTeamName();
  state.teamName = teamName;
  const region = process.env.BS_DATA_REGION;
  log(`team: ${teamName}${region ? ` (region ${region})` : ''}`);

  // 1. Telemetry source for OTLP traces, metrics and logs
  const sourceName = `${PREFIX}-otel`;
  let source = (await listAll('https://telemetry.betterstack.com', '/api/v2/sources?per_page=50')).find((s) => s.attributes.name === sourceName);
  if (!source) {
    const created = await telemetry('/api/v2/sources', {
      method: 'POST',
      body: { name: sourceName, platform: 'open_telemetry', team_name: teamName, ...(region ? { data_region: region } : {}) },
    });
    source = created.data ?? created;
    log(`created telemetry source ${sourceName}`);
  } else log(`telemetry source ${sourceName} exists`);
  const sa = source.attributes;
  state.source = { id: String(source.id), token: sa.token, ingesting_host: sa.ingesting_host, table_name: sa.table_name, team_id: sa.team_id };

  // 2. Collector (Docker platform). Its secret drives the `collector` compose profile.
  const collectorName = `${PREFIX}-collector`;
  let collector = (await listAll('https://telemetry.betterstack.com', `/api/v1/collectors?team_name=${encodeURIComponent(teamName)}&per_page=100`)).find(
    (c) => c.attributes.name === collectorName,
  );
  if (!collector) {
    collector = await telemetry('/api/v1/collectors', {
      method: 'POST',
      body: { name: collectorName, platform: 'docker', team_name: teamName, note: 'bsdemo local Docker Desktop', ...(region ? { data_region: region } : {}) },
    });
    log(`created collector ${collectorName}`);
  } else log(`collector ${collectorName} exists`);
  const collectorAttrs = collector.data?.attributes ?? collector.attributes;
  state.collector = { id: String(collector.data?.id ?? collector.id), secret: collectorAttrs.secret, source_id: collectorAttrs.source_id ? String(collectorAttrs.source_id) : undefined };

  // 3. Errors applications, one per service, correlated with the telemetry source
  const apps: [string, string][] = [
    ['web', 'next_js_errors'],
    ['orders-api', 'fastify_errors'],
    ['inventory-api', 'fastify_errors'],
    ['payments', 'fastapi_errors'],
    ['worker', 'node_errors'],
    ['cron', 'node_errors'],
  ];
  const existingApps = await listAll('https://errors.betterstack.com', `/api/v2/applications?team_name=${encodeURIComponent(teamName)}&per_page=100`);
  state.apps = state.apps ?? {};
  for (const [svc, platform] of apps) {
    const name = `${PREFIX}-${svc}`;
    let app = existingApps.find((a) => a.attributes.name === name);
    if (!app) {
      const created = await errors('/api/v2/applications', {
        method: 'POST',
        body: {
          name,
          platform,
          team_name: teamName,
          correlate_with_source_id: state.source.id,
          code_mapping_stack_root: svc === 'web' ? '/app/apps/web/' : svc === 'payments' ? '/app/' : `/app/services/${svc}/`,
          code_mapping_source_root: svc === 'web' ? 'apps/web/' : svc === 'payments' ? 'services/payments/' : `services/${svc}/`,
          ...(region ? { data_region: region === 'us_west' ? undefined : region } : {}),
        },
      });
      app = created.data ?? created;
      log(`created errors application ${name} (${platform})`);
    } else log(`errors application ${name} exists`);
    const a = app.attributes;
    state.apps[svc] = { id: String(app.id), token: a.token, js_tag_token: a.js_tag_token, ingesting_host: a.ingesting_host, platform };
  }

  // 4. Severity: e-mail + push
  const urgencyName = `${PREFIX}: e-mail + push`;
  let urgency = (await listAll('https://uptime.betterstack.com', '/api/v2/urgencies?per_page=250')).find((u) => u.attributes.name === urgencyName);
  if (!urgency) {
    urgency = (await uptime('/api/v2/urgencies', { method: 'POST', body: { name: urgencyName, email: true, push: true, sms: false, call: false, critical_alert: false, team_name: teamName } })).data;
    log(`created severity "${urgencyName}"`);
  } else log(`severity "${urgencyName}" exists`);
  state.urgency = { id: String(urgency.id) };

  // 5. Escalation policy: alert the whole team, repeat once after 5 minutes. Without it monitors use their own e-mail/push.
  const policyName = `${PREFIX} escalation`;
  let policy = (await listAll('https://uptime.betterstack.com', '/api/v3/policies?per_page=250')).find((p) => p.attributes.name === policyName);
  if (!policy) {
    try {
      policy = (
        await uptime('/api/v3/policies', {
          method: 'POST',
          body: {
            name: policyName,
            team_name: teamName,
            repeat_count: 1,
            repeat_delay: 300,
            steps: [{ type: 'escalation', wait_before: 0, urgency_id: Number(state.urgency.id), step_members: [{ type: 'entire_team' }] }],
          },
        })
      ).data;
      log(`created escalation policy "${policyName}"`);
    } catch (e) {
      log(`escalation policy not available on this plan, using per-monitor e-mail + push instead (${(e as Error).message.slice(0, 160)})`);
    }
  } else log(`escalation policy "${policyName}" exists`);
  state.policy = policy ? { id: String(policy.id) } : undefined;

  // 6. Heartbeat for the cron job (period 60 s, grace 30 s -> incident ~90 s after the last beat)
  const hbName = `${PREFIX} cron hourly-report`;
  let hb = (await listAll('https://uptime.betterstack.com', '/api/v2/heartbeats?per_page=250')).find((h) => h.attributes.name === hbName);
  if (!hb) {
    hb = (
      await uptime('/api/v2/heartbeats', {
        method: 'POST',
        body: { name: hbName, period: 60, grace: 30, email: true, push: true, ...(state.policy ? { policy_id: Number(state.policy.id) } : {}), team_name: teamName },
      })
    ).data;
    log(`created heartbeat "${hbName}"`);
  } else log(`heartbeat "${hbName}" exists`);
  state.heartbeat = { id: String(hb.id), url: hb.attributes.url };

  // 7. Monitor group
  let group = (await listAll('https://uptime.betterstack.com', '/api/v2/monitor-groups?per_page=250')).find((g) => g.attributes.name === PREFIX);
  if (!group) {
    group = (await uptime('/api/v2/monitor-groups', { method: 'POST', body: { name: PREFIX, team_name: teamName } })).data;
    log(`created monitor group "${PREFIX}"`);
  } else log(`monitor group "${PREFIX}" exists`);
  state.monitorGroup = { id: String(group.id) };

  writeState(state);

  const dsn = (svc: string) => {
    const a = state.apps![svc];
    return `https://${state.source!.token}@${a.ingesting_host}/${a.id}`;
  };
  const release = process.env.APP_RELEASE ?? gitSha();
  writeEnvBs({
    APP_ENV: process.env.APP_ENV ?? 'demo',
    APP_RELEASE: release,
    BS_TEAM_NAME: teamName,
    BS_SOURCE_ID: state.source.id,
    BS_SOURCE_TOKEN: state.source.token,
    BS_INGESTING_HOST: state.source.ingesting_host,
    OTEL_EXPORTER_OTLP_ENDPOINT: `https://${state.source.ingesting_host}`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${state.source.token}`,
    NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN: state.source.token,
    NEXT_PUBLIC_BETTER_STACK_INGESTING_URL: `https://${state.source.ingesting_host}`,
    BS_JS_TAG_TOKEN: state.apps.web.js_tag_token,
    BS_ERRORS_DSN_WEB: dsn('web'),
    BS_ERRORS_DSN_ORDERS: dsn('orders-api'),
    BS_ERRORS_DSN_INVENTORY: dsn('inventory-api'),
    BS_ERRORS_DSN_PAYMENTS: dsn('payments'),
    BS_ERRORS_DSN_WORKER: dsn('worker'),
    BS_ERRORS_DSN_CRON: dsn('cron'),
    BS_HEARTBEAT_URL: state.heartbeat.url,
    COLLECTOR_SECRET: state.collector.secret,
    COLLECTOR_HOSTNAME: 'bsdemo-docker-desktop',
  });
  log('wrote .env.bs and .bs-state.json');
  console.log(`
Next steps:
  docker compose --env-file .env.bs up -d --build     # start the stack
  pnpm bs:sync                                        # monitors + status page for the tunnel URL
  docker compose --env-file .env.bs --profile collector up -d   # optional: Better Stack collector (eBPF, Docker logs, DB dashboards)
`);
}

function gitSha(): string {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const sha = execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (sha) return `1.0.0+${sha}`;
  } catch {
    /* no commits yet */
  }
  return `1.0.0+${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}

main().catch((err) => {
  console.error('bs-setup failed:', err.message ?? err);
  process.exit(1);
});
