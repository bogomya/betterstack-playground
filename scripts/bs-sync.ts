/**
 * Creates or updates the Uptime monitors and the public status page so they point at the current
 * public URL (Cloudflare quick tunnels get a new hostname every restart).
 *   pnpm bs:sync                 # discovers the URL from the tunnel container logs
 *   pnpm bs:sync https://x.y.z   # explicit URL
 */
import { PREFIX, listAll, loadDotEnv, log, readState, tunnelUrlFromDocker, uptime, writeState } from './lib/bs.js';

loadDotEnv();
const state = readState();

async function main(): Promise<void> {
  if (!state.monitorGroup || !state.heartbeat) throw new Error('Run pnpm bs:setup first');
  const base = (process.argv[2] ?? process.env.PUBLIC_URL ?? tunnelUrlFromDocker())?.replace(/\/$/, '');
  if (!base) throw new Error('No public URL: is the tunnel container running? (docker compose --env-file .env.bs logs tunnel)');
  log(`public URL: ${base}`);
  state.publicUrl = base;
  const teamName = state.teamName!;

  const monitors: { key: string; name: string; type: 'status' | 'keyword'; url: string; keyword?: string }[] = [
    { key: 'web', name: `${PREFIX} web (storefront)`, type: 'keyword', url: `${base}/`, keyword: 'Better Stack demo shop' },
    { key: 'orders', name: `${PREFIX} orders-api`, type: 'status', url: `${base}/svc/orders/health` },
    { key: 'inventory', name: `${PREFIX} inventory-api`, type: 'status', url: `${base}/svc/inventory/health` },
    { key: 'payments', name: `${PREFIX} payments`, type: 'status', url: `${base}/svc/payments/health` },
  ];
  const existing = await listAll('https://uptime.betterstack.com', '/api/v2/monitors?per_page=250');
  state.monitors = state.monitors ?? {};
  for (const m of monitors) {
    let mon = existing.find((e) => e.attributes.pronounceable_name === m.name);
    const body = {
      monitor_type: m.type,
      url: m.url,
      pronounceable_name: m.name,
      required_keyword: m.keyword,
      check_frequency: 180,
      request_timeout: 30,
      confirmation_period: 0,
      recovery_period: 60,
      regions: ['us', 'eu', 'as', 'au'],
      follow_redirects: true,
      email: true,
      push: true,
      ...(state.policy ? { policy_id: state.policy.id } : {}),
      monitor_group_id: state.monitorGroup!.id,
      team_name: teamName,
      paused: false,
    };
    if (!mon) {
      mon = (await uptime('/api/v2/monitors', { method: 'POST', body: { ...body, metadata: { demo: 'bsdemo', service: m.key } } })).data;
      log(`created monitor "${m.name}" -> ${m.url}`);
    } else if (mon.attributes.url !== m.url || mon.attributes.paused) {
      mon = (await uptime(`/api/v2/monitors/${mon.id}`, { method: 'PATCH', body: { url: m.url, paused: false } })).data;
      log(`updated monitor "${m.name}" -> ${m.url}`);
    } else log(`monitor "${m.name}" up to date`);
    state.monitors[m.key] = { id: String(mon.id), url: m.url };
  }
  writeState(state);

  // Status page
  let page: any = null;
  if (state.statusPage?.id) page = await uptime(`/api/v2/status-pages/${state.statusPage.id}`, { allow: [404] });
  if (!page) {
    const pages = await listAll('https://uptime.betterstack.com', '/api/v2/status-pages?per_page=250');
    page = pages.find((p) => p.attributes.company_name === `Brew & Bean (${PREFIX})`) ?? null;
  }
  if (!page) {
    const subdomain = `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await uptime('/api/v2/status-pages', {
      method: 'POST',
      body: {
        company_name: `Brew & Bean (${PREFIX})`,
        company_url: base,
        subdomain,
        timezone: 'UTC',
        published: true,
        automatic_reports: true,
        design: 'v2',
        theme: 'system',
        team_name: teamName,
      },
    });
    page = created.data ?? created;
    log(`created status page https://${subdomain}.betteruptime.com`);
  } else {
    if ((page.data ?? page).attributes.company_url !== base) {
      await uptime(`/api/v2/status-pages/${(page.data ?? page).id}`, { method: 'PATCH', body: { company_url: base } });
    }
    log(`status page exists: https://${(page.data ?? page).attributes.subdomain}.betteruptime.com`);
  }
  const pageObj = page.data ?? page;
  state.statusPage = { id: String(pageObj.id), subdomain: pageObj.attributes.subdomain, sections: state.statusPage?.sections ?? {}, resources: state.statusPage?.resources ?? {} };

  const sectionsWanted = ['Storefront', 'Backend services', 'Background jobs'];
  const existingSections = (await uptime(`/api/v2/status-pages/${pageObj.id}/sections`)).data ?? [];
  for (const [i, name] of sectionsWanted.entries()) {
    let sec = existingSections.find((s: any) => s.attributes.name === name);
    if (!sec) {
      const created = await uptime(`/api/v2/status-pages/${pageObj.id}/sections`, { method: 'POST', body: { name, position: i } });
      sec = created.data ?? created;
      log(`created status page section "${name}"`);
    }
    state.statusPage.sections![name] = String(sec.id);
  }

  const resourcesWanted: { key: string; section: string; type: 'Monitor' | 'Heartbeat'; id: string; name: string; widget: string; explanation: string }[] = [
    { key: 'web', section: 'Storefront', type: 'Monitor', id: state.monitors.web.id, name: 'Storefront (web)', widget: 'history', explanation: 'Next.js storefront through the tunnel' },
    { key: 'orders', section: 'Backend services', type: 'Monitor', id: state.monitors.orders.id, name: 'Orders API', widget: 'response_times', explanation: 'Checkout orchestration' },
    { key: 'inventory', section: 'Backend services', type: 'Monitor', id: state.monitors.inventory.id, name: 'Inventory API', widget: 'response_times', explanation: 'Catalogue & stock (Postgres)' },
    { key: 'payments', section: 'Backend services', type: 'Monitor', id: state.monitors.payments.id, name: 'Payments', widget: 'response_times', explanation: 'Python payment gateway adapter' },
    { key: 'cron', section: 'Background jobs', type: 'Heartbeat', id: state.heartbeat!.id, name: 'Hourly report job', widget: 'history', explanation: 'Cron heartbeat' },
  ];
  const existingResources = (await uptime(`/api/v2/status-pages/${pageObj.id}/resources`)).data ?? [];
  for (const [i, r] of resourcesWanted.entries()) {
    let res = existingResources.find((e: any) => String(e.attributes.resource_id) === String(r.id) && e.attributes.resource_type === r.type);
    if (!res) {
      const created = await uptime(`/api/v2/status-pages/${pageObj.id}/resources`, {
        method: 'POST',
        body: {
          status_page_section_id: Number(state.statusPage.sections![r.section]),
          resource_id: Number(r.id),
          resource_type: r.type,
          public_name: r.name,
          explanation: r.explanation,
          widget_type: r.widget,
          position: i,
        },
      });
      res = created.data ?? created;
      log(`added "${r.name}" to the status page`);
    }
    state.statusPage.resources![r.key] = String(res.id);
  }

  writeState(state);
  console.log(`
Public URL:    ${base}
Storefront:    ${base}/          Lab: ${base}/lab
Status page:   https://${state.statusPage.subdomain}.betteruptime.com
Monitors:      https://uptime.betterstack.com/team/0/monitors
`);
}

main().catch((err) => {
  console.error('bs-sync failed:', err.message ?? err);
  process.exit(1);
});
