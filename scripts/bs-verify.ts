/**
 * End-to-end verification:
 *   1. local stack answers (through the Caddy proxy on :8080)
 *   2. a set of Lab scenarios is executed and their trace_ids collected
 *   3. Better Stack received the data: SQL API (ClickHouse HTTP) counts logs / spans / metrics for the demo
 *      source and looks for the trace ids; heartbeat + monitors are checked through the Uptime API.
 * Needs a global API token (the SQL API connection is created once and stored in .bs-state.json).
 */
import { listAll, loadDotEnv, log, readState, telemetry, uptime, writeState } from './lib/bs.js';

loadDotEnv();
const state = readState();
const LOCAL = process.env.LOCAL_URL ?? 'http://localhost:8080';

async function local<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${LOCAL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text as T };
  }
}

async function sql(query: string): Promise<any[]> {
  const c = state.connection!;
  const res = await fetch(`https://${c.host}:443/?output_format_pretty_row_numbers=0`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64'), 'Content-Type': 'plain/text' },
    body: `${query} FORMAT JSONEachRow`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 300)}`);
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function ensureConnection(): Promise<void> {
  if (state.connection?.password) return;
  const existing = await listAll('https://telemetry.betterstack.com', '/api/v1/connections?per_page=100');
  const mine = existing.find((c) => c.attributes.note === 'bsdemo verify');
  if (mine) {
    // password is only returned on creation: recreate
    await telemetry(`/api/v1/connections/${mine.id}`, { method: 'DELETE' });
  }
  const created = await telemetry('/api/v1/connections', {
    method: 'POST',
    body: { client_type: 'clickhouse', team_names: [state.teamName], note: 'bsdemo verify' },
  });
  const a = created.data.attributes;
  const tables: Record<string, string> = {};
  for (const ds of a.data_sources ?? []) {
    for (const t of ds.data_sources ?? []) tables[`${ds.source_name}|${t}`] = t;
  }
  state.connection = { id: String(created.data.id), host: a.host, username: a.username, password: a.password, tables };
  writeState(state);
  log(`created SQL API connection on ${a.host}`);
}

function tableFor(kind: 'logs' | 'spans' | 'metrics'): string | undefined {
  const entries = Object.entries(state.connection?.tables ?? {});
  const hit = entries.find(([k]) => k.startsWith('bsdemo-otel|') && k.endsWith(`_${kind})`) && k.includes('remote('));
  return hit?.[1];
}

async function main(): Promise<void> {
  const report: string[] = [];
  const ok = (m: string) => report.push(`✅ ${m}`);
  const bad = (m: string) => report.push(`❌ ${m}`);

  // 1. Local stack
  for (const [name, path, expect] of [
    ['proxy → web', '/', 'Better Stack demo shop'],
    ['orders-api health', '/svc/orders/health', '"ok"'],
    ['inventory-api health', '/svc/inventory/health', '"ok"'],
    ['payments health', '/svc/payments/health', '"ok"'],
  ] as const) {
    try {
      const res = await fetch(`${LOCAL}${path}`);
      const text = await res.text();
      if (res.status === 200 && text.includes(expect)) ok(`${name} (${res.status})`);
      else bad(`${name}: HTTP ${res.status} ${text.slice(0, 120)}`);
    } catch (e) {
      bad(`${name}: ${(e as Error).message}`);
    }
  }

  // 2. Scenarios
  const scenarios: [string, string | undefined, number][] = [
    ['success', undefined, 201],
    ['throw', undefined, 500],
    ['inventory_throw', undefined, 502],
    ['payments_crash', undefined, 502],
    ['db_bad_query', undefined, 502], // inventory-api answers 500, orders-api turns it into a 502 cascade
    ['declined', 'u-bob', 402],
    ['async_fail', undefined, 201],
    ['out_of_stock', undefined, 409],
  ];
  const traceIds: string[] = [];
  for (const [scenario, userId, expected] of scenarios) {
    const res = await local<{ status: number; durationMs: number; data: any }>('/api/lab/run', { method: 'POST', body: JSON.stringify({ scenario, userId }) });
    const got = res.data?.status;
    const tid = res.data?.data?.trace_id;
    if (tid) traceIds.push(tid);
    if (got === expected) ok(`scenario ${scenario}${userId ? ` as ${userId}` : ''} -> ${got} in ${res.data.durationMs}ms${tid ? ` trace ${tid}` : ''}`);
    else bad(`scenario ${scenario}: expected ${expected}, got ${got} ${JSON.stringify(res.data?.data).slice(0, 160)}`);
  }
  const se = await fetch(`${LOCAL}/api/lab/server-error`);
  (se.status === 500 ? ok : bad)(`next.js server-error route -> ${se.status}`);

  // 3. Better Stack: source, SQL API
  const src = await telemetry(`/api/v2/sources/${state.source!.id}`);
  const sa = src.data?.attributes ?? src.attributes;
  (sa.ingesting_paused ? bad : ok)(`telemetry source ${sa.name} (${sa.platform}, ${sa.data_region}, ingesting ${sa.ingesting_paused ? 'PAUSED' : 'on'})`);

  await ensureConnection();
  const logsT = tableFor('logs');
  const spansT = tableFor('spans');
  const metricsT = tableFor('metrics');
  if (!logsT || !spansT || !metricsT) {
    bad(`could not map source tables; known: ${Object.keys(state.connection!.tables ?? {}).join(', ')}`);
  } else {
    log('waiting 45 s for batches to be exported and indexed…');
    await new Promise((r) => setTimeout(r, 45_000));
    for (const [kind, t] of [
      ['logs', logsT],
      ['spans', spansT],
    ] as const) {
      const rows = await sql(`SELECT count() AS n FROM ${t} WHERE dt > now() - INTERVAL 20 MINUTE`);
      const n = Number(rows[0]?.n ?? 0);
      (n > 0 ? ok : bad)(`${kind}: ${n} rows in the last 20 min (${t})`);
    }
    const metricNames = await sql(`SELECT DISTINCT name FROM ${metricsT} WHERE dt > now() - INTERVAL 20 MINUTE ORDER BY name LIMIT 300`);
    (metricNames.length > 0 ? ok : bad)(`metrics: ${metricNames.length} distinct metric names in the last 20 min`);
    if (metricNames.length) log('metric names:', metricNames.map((r) => r.name).join(', '));
    const services = await sql(
      `SELECT JSONExtractString(raw, 'resource', 'service.name') AS service, count() AS spans FROM ${spansT} WHERE dt > now() - INTERVAL 20 MINUTE GROUP BY service ORDER BY spans DESC`,
    ).catch(() => []);
    if (services.length) log('spans by service (resource.service.name):', services);
    else {
      const sample = await sql(`SELECT raw FROM ${spansT} ORDER BY dt DESC LIMIT 1`).catch(() => []);
      if (sample[0]) log('sample span raw:', String(sample[0].raw).slice(0, 600));
    }
    for (const tid of traceIds.slice(0, 3)) {
      const rows = await sql(`SELECT count() AS n FROM ${spansT} WHERE dt > now() - INTERVAL 20 MINUTE AND raw LIKE '%${tid}%'`);
      const logRows = await sql(`SELECT count() AS n FROM ${logsT} WHERE dt > now() - INTERVAL 20 MINUTE AND raw LIKE '%${tid}%'`);
      (Number(rows[0]?.n) > 0 ? ok : bad)(`trace ${tid}: ${rows[0]?.n} spans, ${logRows[0]?.n} log lines`);
    }
  }

  // 4. Uptime
  if (state.heartbeat) {
    const hb = await uptime(`/api/v2/heartbeats/${state.heartbeat.id}`);
    const st = hb.data.attributes.status;
    (st === 'up' ? ok : bad)(`heartbeat "${hb.data.attributes.name}" status=${st}`);
  }
  for (const [k, m] of Object.entries(state.monitors ?? {})) {
    const mon = await uptime(`/api/v2/monitors/${m.id}`);
    const st = mon.data.attributes.status;
    (st === 'up' || st === 'pending' ? ok : bad)(`monitor ${k} status=${st} (${mon.data.attributes.url})`);
  }
  if (!state.monitors) log('no monitors in state: run pnpm bs:sync once the tunnel is up');

  console.log('\n' + report.join('\n') + '\n');
  if (report.some((l) => l.startsWith('❌'))) process.exitCode = 1;
}

main().catch((err) => {
  console.error('bs-verify failed:', err.message ?? err);
  process.exit(1);
});
