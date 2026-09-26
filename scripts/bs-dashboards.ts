/**
 * Creates a "bsdemo overview" dashboard (SQL charts over the OpenTelemetry source) and three alerts:
 * a 5xx-rate threshold, a p95-latency threshold and an anomaly-detection alert on request volume.
 */
import { PREFIX, listAll, loadDotEnv, log, readState, telemetry, writeState } from './lib/bs.js';

loadDotEnv();
const state = readState();

const HTTP = `name = 'http.server.request.duration' AND dt BETWEEN {{start_time}} AND {{end_time}}`;

const CHARTS: { key: string; name: string; chart_type: string; x: number; y: number; w?: number; h?: number; queries: { name: string; sql_query: string }[]; settings?: Record<string, unknown> }[] = [
  {
    key: 'requests',
    name: 'HTTP requests per interval, by service',
    chart_type: 'line_chart',
    x: 0,
    y: 0,
    queries: [
      {
        name: 'requests',
        sql_query: `SELECT {{time}} AS time, sumMerge(bucket_count) AS value, label('service.name') AS series
FROM {{source}}
WHERE ${HTTP}
GROUP BY time, series
ORDER BY time`,
      },
    ],
  },
  {
    key: 'error_rate',
    name: 'HTTP 5xx rate (%) by service',
    chart_type: 'line_chart',
    x: 6,
    y: 0,
    settings: { unit: '%' },
    queries: [
      {
        name: '5xx rate',
        sql_query: `SELECT time, series, round(sum(if(status >= '500', reqs, 0)) / sum(reqs) * 100, 2) AS value
FROM (
  SELECT {{time}} AS time, label('service.name') AS series, label('http.response.status_code') AS status, sumMerge(bucket_count) AS reqs
  FROM {{source}}
  WHERE ${HTTP}
  GROUP BY time, series, status
)
GROUP BY time, series
ORDER BY time`,
      },
    ],
  },
  {
    key: 'p95',
    name: 'HTTP p95 latency (s) by service',
    chart_type: 'line_chart',
    x: 0,
    y: 4,
    queries: [
      {
        name: 'p95',
        sql_query: `SELECT {{time}} AS time, label('service.name') AS series, histogramQuantile(0.95) AS value
FROM {{source}}
WHERE ${HTTP}
GROUP BY time, series
ORDER BY time`,
      },
    ],
  },
  {
    key: 'orders',
    name: 'Orders created vs failed (by reason)',
    chart_type: 'line_chart',
    x: 6,
    y: 4,
    queries: [
      {
        name: 'created',
        sql_query: `SELECT {{time}} AS time, avgMerge(rate_avg) * {{interval_seconds}} AS value, 'created' AS series
FROM {{source}}
WHERE name = 'orders.created' AND dt BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
ORDER BY time`,
      },
      {
        name: 'failed',
        sql_query: `SELECT {{time}} AS time, avgMerge(rate_avg) * {{interval_seconds}} AS value, concat('failed: ', label('reason')) AS series
FROM {{source}}
WHERE name = 'orders.failed' AND dt BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, series
ORDER BY time`,
      },
    ],
  },
  {
    key: 'logs_by_level',
    name: 'Log lines by level',
    chart_type: 'bar_chart',
    x: 0,
    y: 8,
    queries: [
      {
        name: 'logs',
        sql_query: `SELECT {{time}} AS time, sum(logs_count) AS value, COALESCE(label('level'), 'no level') AS series
FROM {{source}}
WHERE dt BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, series
ORDER BY time`,
      },
    ],
  },
  {
    key: 'jobs',
    name: 'Worker jobs by outcome',
    chart_type: 'line_chart',
    x: 6,
    y: 8,
    queries: [
      {
        name: 'jobs',
        sql_query: `SELECT {{time}} AS time, avgMerge(rate_avg) * {{interval_seconds}} AS value, concat(label('job'), ' / ', label('outcome')) AS series
FROM {{source}}
WHERE name = 'jobs.processed' AND dt BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, series
ORDER BY time`,
      },
    ],
  },
  {
    key: 'checkout_p95',
    name: 'Checkout p95 (ms)',
    chart_type: 'number_chart',
    x: 0,
    y: 12,
    w: 3,
    h: 3,
    queries: [
      {
        name: 'checkout p95',
        sql_query: `SELECT histogramQuantile(0.95) AS value
FROM {{source}}
WHERE name = 'checkout.duration' AND dt BETWEEN {{start_time}} AND {{end_time}}`,
      },
    ],
  },
  {
    key: 'stock',
    name: 'Stock left (limited item)',
    chart_type: 'number_chart',
    x: 3,
    y: 12,
    w: 3,
    h: 3,
    queries: [
      {
        name: 'stock',
        sql_query: `SELECT round(avgMerge(value_avg)) AS value
FROM {{source}}
WHERE name = 'inventory.stock' AND label('sku') = 'LTD-001' AND dt BETWEEN {{end_time}} - INTERVAL 5 MINUTE AND {{end_time}}`,
      },
    ],
  },
];

async function main(): Promise<void> {
  if (!state.source) throw new Error('run bs:setup first');
  const name = `${PREFIX} overview`;
  let dashboard = (await listAll('https://telemetry.betterstack.com', `/api/v2/dashboards?query=${encodeURIComponent(name)}&per_page=50`)).find((d) => d.attributes.name === name);
  if (!dashboard) {
    const body: Record<string, unknown> = {
      name,
      team_name: state.teamName,
      refresh_interval: 60,
      date_range_from: 'now-3h',
      date_range_to: 'now',
      variables: [{ name: 'source', variable_type: 'source', values: [state.source.id], default_values: [state.source.id] }],
    };
    let created: any;
    try {
      created = await telemetry('/api/v2/dashboards', { method: 'POST', body });
    } catch (e) {
      log(`dashboard create with source variable failed (${(e as Error).message.slice(0, 120)}); retrying without variables`);
      delete body.variables;
      created = await telemetry('/api/v2/dashboards', { method: 'POST', body });
    }
    dashboard = created.data ?? created;
    log(`created dashboard "${name}" (id ${dashboard.id})`);
  } else log(`dashboard "${name}" exists (id ${dashboard.id})`);
  state.dashboard = { id: String(dashboard.id), charts: state.dashboard?.charts ?? {} };

  const existingCharts = (await telemetry(`/api/v2/dashboards/${dashboard.id}/charts`)).data ?? [];
  for (const c of CHARTS) {
    let chart = existingCharts.find((e: any) => e.attributes.name === c.name);
    if (chart && process.argv.includes('--update')) {
      await telemetry(`/api/v2/dashboards/${dashboard.id}/charts/${chart.id}`, {
        method: 'PATCH',
        body: { queries: c.queries.map((q) => ({ query_type: 'sql_expression', name: q.name, sql_query: q.sql_query, source_variable: 'source' })), settings: c.settings ?? {} },
      });
      log(`updated chart "${c.name}"`);
    }
    if (!chart) {
      const created = await telemetry(`/api/v2/dashboards/${dashboard.id}/charts`, {
        method: 'POST',
        body: {
          chart_type: c.chart_type,
          name: c.name,
          x: c.x,
          y: c.y,
          w: c.w ?? 6,
          h: c.h ?? 4,
          settings: c.settings ?? {},
          queries: c.queries.map((q) => ({ query_type: 'sql_expression', name: q.name, sql_query: q.sql_query, source_variable: 'source' })),
        },
      });
      chart = created.data ?? created;
      log(`created chart "${c.name}"`);
    }
    state.dashboard.charts![c.key] = String(chart.id);
  }
  writeState(state);

  const alerts: { key: string; chart: string; body: Record<string, unknown> }[] = [
    {
      key: 'error_rate',
      chart: 'error_rate',
      body: {
        name: `${PREFIX}: 5xx rate above 25%`,
        alert_type: 'threshold',
        operator: 'higher_than',
        value: 25,
        check_period: 300,
        query_period: 300,
        confirmation_period: 0,
        recovery_period: 120,
        incident_per_series: true,
        incident_cause: '5xx rate for {{series_name}} is {{current_value}}% (bsdemo)',
        on_missing_data: 'dont_fire',
        escalation_target: 'current_team',
        email: true,
        push: true,
        metadata: { runbook: 'Open the Lab, reset chaos / stop the broken traffic profile' },
      },
    },
    {
      key: 'p95',
      chart: 'p95',
      body: {
        name: `${PREFIX}: p95 latency above 2s`,
        alert_type: 'threshold',
        operator: 'higher_than',
        value: 2,
        check_period: 300,
        query_period: 300,
        confirmation_period: 60,
        recovery_period: 120,
        incident_per_series: true,
        incident_cause: 'p95 latency for {{series_name}} is {{current_value}} s (bsdemo)',
        on_missing_data: 'dont_fire',
        escalation_target: 'current_team',
        email: true,
        push: true,
      },
    },
    {
      key: 'requests_anomaly',
      chart: 'requests',
      body: {
        name: `${PREFIX}: request volume anomaly`,
        alert_type: 'anomaly_rrcf',
        anomaly_sensitivity: 5,
        anomaly_trigger: 'higher',
        anomaly_training_range_days: 1,
        incident_per_series: true,
        incident_cause: 'Unusual request volume for {{series_name}}: {{current_value}} (bsdemo)',
        escalation_target: 'current_team',
        email: true,
        push: false,
      },
    },
  ];
  state.alerts = state.alerts ?? {};
  for (const a of alerts) {
    if (state.alerts[a.key]) {
      log(`alert "${a.body.name}" exists`);
      continue;
    }
    const chartId = state.dashboard.charts![a.chart];
    try {
      const existing = (await telemetry(`/api/v2/dashboards/${dashboard.id}/charts/${chartId}/alerts`)).data ?? [];
      let alert = existing.find((e: any) => e.attributes.name === a.body.name);
      if (!alert) {
        const created = await telemetry(`/api/v2/dashboards/${dashboard.id}/charts/${chartId}/alerts`, { method: 'POST', body: a.body });
        alert = created.data ?? created;
        log(`created alert "${a.body.name}"`);
      }
      state.alerts[a.key] = String(alert.id);
    } catch (e) {
      log(`alert "${a.body.name}" failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  writeState(state);
  console.log(`\nDashboard: https://telemetry.betterstack.com/team/0/dashboards/${dashboard.id}\n`);
}

main().catch((err) => {
  console.error('bs-dashboards failed:', err.message ?? err);
  process.exit(1);
});
