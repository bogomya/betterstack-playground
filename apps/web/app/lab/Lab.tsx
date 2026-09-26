'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLogger } from '@logtail/next/hooks';
import type { DemoUser } from '@bsdemo/shared/users';
import { tagLoaded, track } from '@/lib/rum';
import { BACKEND_SCENARIOS, FRONTEND_SCENARIOS, type Scenario } from './scenarios';

interface Status {
  services?: { name: string; status: number; body: unknown }[];
  queue?: Record<string, number>;
  cron?: Record<string, string>;
  loadgen?: Record<string, string>;
  chaos?: Record<string, Record<string, string>>;
  release?: string;
  error?: string;
}

interface RunResult {
  scenario: Scenario;
  status: number;
  durationMs: number;
  data: Record<string, unknown> & { trace_id?: string; error?: string; message?: string; service?: string; orderId?: string };
  at: string;
  user?: { id: string; name: string };
}

const BS = {
  tail: 'https://telemetry.betterstack.com/team/0/tail',
  services: 'https://telemetry.betterstack.com/team/0/services',
  dashboards: 'https://telemetry.betterstack.com/team/0/dashboards',
  explore: 'https://telemetry.betterstack.com/team/0/explore-logs',
  errors: 'https://errors.betterstack.com/team/0/errors',
  sessions: 'https://rum.betterstack.com/team/0/sessions',
  users: 'https://rum.betterstack.com/team/0/users',
  rumDash: 'https://rum.betterstack.com/team/0/dashboards',
  monitors: 'https://uptime.betterstack.com/team/0/monitors',
  incidents: 'https://uptime.betterstack.com/team/0/incidents',
  heartbeats: 'https://uptime.betterstack.com/team/0/heartbeats',
  statusPages: 'https://uptime.betterstack.com/team/0/status-pages',
};

function Links({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map(([label, href]) => (
        <a key={href + label} href={href} target="_blank" rel="noreferrer" className="tag hover:border-[#f5a524]">
          {label} ↗
        </a>
      ))}
    </div>
  );
}

function Section({ title, subtitle, links, children }: { title: string; subtitle?: string; links?: [string, string][]; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="muted text-sm">{subtitle}</p> : null}
        </div>
        {links ? <Links items={links} /> : null}
      </div>
      {children}
    </section>
  );
}

export default function Lab({ user }: { user: DemoUser }) {
  const router = useRouter();
  const log = useLogger({ source: 'lab' });
  const [status, setStatus] = useState<Status>({});
  const [results, setResults] = useState<RunResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rps, setRps] = useState(2);
  const [profile, setProfile] = useState('mixed');
  const [tagOk, setTagOk] = useState(false);
  const [rage, setRage] = useState(0);
  const memoryRef = useRef<number[][]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/lab/status', { cache: 'no-store' });
      const body = (await res.json()) as Status;
      setStatus(body);
      if (body.loadgen?.rps) setRps(Number(body.loadgen.rps));
      if (body.loadgen?.profile) setProfile(body.loadgen.profile);
    } catch (e) {
      setStatus({ error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    const tagTimer = setTimeout(() => setTagOk(tagLoaded()), 1500);
    return () => {
      clearInterval(t);
      clearTimeout(tagTimer);
    };
  }, [refresh]);

  async function runBackend(s: Scenario) {
    setBusy(s.id + (s.userId ?? ''));
    log.info('lab scenario clicked', { scenario: s.id, userId: s.userId ?? user.id });
    track('lab-scenario', { scenario: s.id, userId: s.userId ?? user.id });
    try {
      const res = await fetch('/api/lab/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: s.id, userId: s.userId }),
      });
      const body = await res.json();
      setResults((r) => [{ scenario: s, status: body.status, durationMs: body.durationMs, data: body.data ?? {}, at: new Date().toLocaleTimeString(), user: body.user }, ...r].slice(0, 12));
    } catch (e) {
      setResults((r) => [{ scenario: s, status: 0, durationMs: 0, data: { error: (e as Error).message }, at: new Date().toLocaleTimeString() }, ...r]);
    } finally {
      setBusy(null);
    }
  }

  async function runFrontend(s: Scenario) {
    log.info('lab frontend scenario', { scenario: s.id });
    track('lab-scenario', { scenario: s.id, userId: user.id });
    switch (s.id) {
      case 'fe_throw': {
        const cart: { items?: { price: number }[] } = {};
        // Deliberate bug: cart.items is undefined
        const total = cart.items!.reduce((sum, i) => sum + i.price, 0);
        alert(total);
        break;
      }
      case 'fe_reject':
        void Promise.reject(new Error('Chaos: unhandled promise rejection while syncing the cart'));
        break;
      case 'fe_fetch_404': {
        const res = await fetch('/api/does-not-exist');
        console.error('Chaos: API call failed', { status: res.status, url: res.url, user: user.id });
        console.warn('Chaos: falling back to cached catalogue');
        break;
      }
      case 'fe_network_fail':
        void fetch('https://api.invalid-host.example/v1/recommendations').then((r) => r.json());
        break;
      case 'fe_render_crash':
        router.push('/boom');
        break;
      case 'fe_slow_page':
        window.location.href = '/slow';
        break;
      case 'fe_long_task': {
        const end = performance.now() + 2500;
        let x = 0;
        while (performance.now() < end) x += Math.sqrt(x + 1);
        break;
      }
      case 'fe_memory': {
        const chunks: number[][] = [];
        for (let i = 0; i < 15; i++) chunks.push(new Array(1_250_000).fill(i));
        memoryRef.current = chunks;
        setTimeout(() => (memoryRef.current = []), 60_000);
        break;
      }
      case 'fe_track':
        track('lab-custom-event', { user_id: user.id, plan: user.plan, value: Math.round(Math.random() * 100) });
        break;
      case 'fe_server_error': {
        const res = await fetch('/api/lab/server-error');
        setResults((r) => [{ scenario: s, status: res.status, durationMs: 0, data: { message: `route handler answered ${res.status}` }, at: new Date().toLocaleTimeString() }, ...r]);
        break;
      }
    }
  }

  async function setChaos(service: string, key: string, value: string | null) {
    await fetch('/api/lab/chaos', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service, key, value }) });
    log.info('chaos flag set', { service, key, value });
    await refresh();
  }

  async function resetChaos() {
    await fetch('/api/lab/chaos', { method: 'DELETE' });
    await refresh();
  }

  async function setLoadgen(patch: Record<string, unknown>) {
    await fetch('/api/lab/loadgen', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    await refresh();
  }

  async function queueJob(job: 'cpu-burn' | 'memory-hog') {
    await fetch('/api/lab/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job, seconds: 10, mb: 300 }) });
    await refresh();
  }

  const flags = (svc: string) => status.chaos?.[svc] ?? {};
  const healthBadge = (name: string) => {
    const s = status.services?.find((x) => x.name === name);
    const ok = s?.status === 200;
    return <span className={`tag ${ok ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>{s ? `${s.status || 'down'}` : '…'}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">🧪 Chaos Lab</h1>
          <p className="muted text-sm">
            Running as <b>{user.name}</b> ({user.personality}). Change on the <Link href="/account" className="underline">account page</Link>. Each card
            says what to look for in Better Stack afterwards.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`tag ${tagOk ? 'text-[#3fb950]' : 'text-[#d29922]'}`}>JS tag {tagOk ? 'loaded' : 'not loaded'}</span>
          <span className="tag">release {status.release ?? '…'}</span>
          <button className="btn btn-danger" onClick={resetChaos}>
            Reset all chaos
          </button>
        </div>
      </div>

      <Section
        title="Service health & Uptime incidents"
        subtitle="Flip a health endpoint to 503. Uptime checks every 3 min from several regions, so an incident opens within ~3-6 min; you get an e-mail + push. Acknowledge it in the mobile app, then restore."
        links={[
          ['Monitors', BS.monitors],
          ['Incidents', BS.incidents],
          ['Heartbeats', BS.heartbeats],
          ['Status page', BS.statusPages],
        ]}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {['orders', 'inventory', 'payments'].map((svc) => {
            const failing = flags(svc).health_fail === '1';
            const name = svc === 'payments' ? 'payments' : `${svc}-api`;
            return (
              <div key={svc} className="rounded-lg border border-[#1f2a37] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{name}</span>
                  {healthBadge(name)}
                </div>
                <div className="muted mb-2 text-xs">GET /svc/{svc}/health</div>
                <button className={`btn w-full ${failing ? 'btn-ok' : 'btn-danger'}`} onClick={() => setChaos(svc, 'health_fail', failing ? null : '1')}>
                  {failing ? 'Restore health' : 'Take it down (503)'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-lg border border-[#1f2a37] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium">cron → heartbeat</span>
              <span className="muted ml-2 text-xs">
                runs every 60 s · last run {status.cron?.last_run ? new Date(status.cron.last_run).toLocaleTimeString() : '…'} · status {status.cron?.last_status ?? '…'} · ping{' '}
                {status.cron?.last_heartbeat ?? '…'}
              </span>
            </div>
            <div className="flex gap-2">
              {[
                ['ok', 'Healthy'],
                ['skip', 'Stop pinging (missed beat)'],
                ['fail', 'Report failure (/fail)'],
                ['crash', 'Crash the job'],
              ].map(([mode, label]) => (
                <button key={mode} className={`btn ${(flags('cron').heartbeat ?? 'ok') === mode ? 'btn-accent' : ''}`} onClick={() => setChaos('cron', 'heartbeat', mode === 'ok' ? null : mode)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Backend scenarios"
        subtitle="Each button performs one checkout through the real request path. Results appear below with the trace_id to search in Live tail."
        links={[
          ['Live tail', BS.tail],
          ['Services', BS.services],
          ['Errors', BS.errors],
          ['Dashboards', BS.dashboards],
        ]}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BACKEND_SCENARIOS.map((s) => (
            <ScenarioCard key={s.id + (s.userId ?? '')} s={s} busy={busy === s.id + (s.userId ?? '')} onRun={() => runBackend(s)} />
          ))}
        </div>
      </Section>

      {results.length ? (
        <Section title="Recent results" subtitle="Newest first. Copy the trace_id into Live tail (spans source) to open the trace.">
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 text-sm ${r.status >= 200 && r.status < 300 ? 'border-[#26542f]' : r.status >= 400 || r.status === 0 ? 'border-[#7a2c31]' : 'border-[#1f2a37]'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.scenario.emoji}</span>
                  <b>{r.scenario.title}</b>
                  <span className="tag">HTTP {r.status || 'n/a'}</span>
                  <span className="tag">{r.durationMs} ms</span>
                  {r.user ? <span className="tag">{r.user.name}</span> : null}
                  <span className="muted ml-auto text-xs">{r.at}</span>
                </div>
                <div className="muted mt-1 text-xs">
                  {r.data.error ? (
                    <>
                      <b className="text-[#f85149]">{r.data.error}</b> {r.data.message} {r.data.service ? `(in ${r.data.service})` : ''}
                    </>
                  ) : r.data.orderId ? (
                    <>order {String(r.data.orderId)} · {String(r.data.status)}</>
                  ) : (
                    JSON.stringify(r.data).slice(0, 160)
                  )}
                </div>
                {r.data.trace_id ? (
                  <div className="mt-1 text-xs">
                    trace_id <span className="tag select-all">{r.data.trace_id}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title="Frontend & RUM scenarios"
        subtitle="These run in your browser. Open Sessions afterwards and watch the replay of this session."
        links={[
          ['Sessions', BS.sessions],
          ['Users', BS.users],
          ['Web vitals & analytics', BS.rumDash],
          ['Errors', BS.errors],
        ]}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FRONTEND_SCENARIOS.map((s) => (
            <ScenarioCard key={s.id} s={s} busy={false} onRun={() => void runFrontend(s)} />
          ))}
          <div className="rounded-lg border border-[#1f2a37] p-3">
            <div className="mb-1 font-medium">😡 Rage-click target</div>
            <p className="muted mb-2 text-xs">This button never responds. Click it 5+ times quickly; RUM records a rage-click event.</p>
            <button className="btn btn-accent w-full" data-testid="rage-target" onClick={() => setRage((n) => n + 1)}>
              Pay now
            </button>
            <div className="muted mt-1 text-xs">clicked {rage}× (nothing will happen)</div>
          </div>
        </div>
      </Section>

      <Section
        title="Chaos knobs (persistent)"
        subtitle="These stay on until reset and affect all traffic, including the load generator. Use them to trigger alerts and anomaly detection."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {['orders', 'inventory'].map((svc) => (
            <div key={svc} className="rounded-lg border border-[#1f2a37] p-3">
              <div className="mb-2 font-medium">{svc}-api</div>
              <label className="block text-xs">
                Random 500s: <b>{flags(svc).error_rate ?? 0}%</b>
                <input type="range" min={0} max={100} step={5} value={Number(flags(svc).error_rate ?? 0)} className="w-full" onChange={(e) => setChaos(svc, 'error_rate', e.target.value === '0' ? null : e.target.value)} />
              </label>
              <label className="block text-xs">
                Added latency: <b>{flags(svc).latency_ms ?? 0} ms</b>
                <input type="range" min={0} max={4000} step={250} value={Number(flags(svc).latency_ms ?? 0)} className="w-full" onChange={(e) => setChaos(svc, 'latency_ms', e.target.value === '0' ? null : e.target.value)} />
              </label>
              {svc === 'inventory' ? (
                <label className="mt-2 block text-xs">
                  DB mode{' '}
                  <select value={flags(svc).db_mode ?? 'ok'} onChange={(e) => setChaos(svc, 'db_mode', e.target.value === 'ok' ? null : e.target.value)}>
                    <option value="ok">ok</option>
                    <option value="slow">slow (pg_sleep 3s)</option>
                    <option value="bad_query">bad_query (42P01 on every reserve)</option>
                  </select>
                </label>
              ) : null}
            </div>
          ))}
          <div className="rounded-lg border border-[#1f2a37] p-3">
            <div className="mb-2 font-medium">payments (Python)</div>
            <label className="block text-xs">
              Mode{' '}
              <select value={flags('payments').mode ?? 'ok'} onChange={(e) => setChaos('payments', 'mode', e.target.value === 'ok' ? null : e.target.value)}>
                <option value="ok">ok</option>
                <option value="slow">slow (3 s)</option>
                <option value="crash">crash (RuntimeError)</option>
                <option value="decline_all">decline every card (402)</option>
              </select>
            </label>
          </div>
          <div className="rounded-lg border border-[#1f2a37] p-3">
            <div className="mb-2 font-medium">worker</div>
            <label className="block text-xs">
              Mode{' '}
              <select value={flags('worker').mode ?? 'ok'} onChange={(e) => setChaos('worker', 'mode', e.target.value === 'ok' ? null : e.target.value)}>
                <option value="ok">ok</option>
                <option value="slow">slow (5 s per job)</option>
                <option value="fail">fail every job (retries + dead letter)</option>
                <option value="cpu">cpu (8 s burn per job)</option>
              </select>
            </label>
            <div className="mt-2 flex gap-2">
              <button className="btn" onClick={() => queueJob('cpu-burn')}>
                Queue CPU burn (10 s)
              </button>
              <button className="btn" onClick={() => queueJob('memory-hog')}>
                Queue memory hog (300 MB)
              </button>
            </div>
            <div className="muted mt-2 text-xs">
              queue: waiting {status.queue?.waiting ?? '…'} · active {status.queue?.active ?? '…'} · failed {status.queue?.failed ?? '…'} · completed {status.queue?.completed ?? '…'}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Synthetic traffic"
        subtitle="Background load so dashboards, anomaly detection and the service map have data. Profiles: healthy (no errors), mixed (~10% failures), broken (~50% failures)."
        links={[['Dashboards', BS.dashboards]]}
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className={`btn ${status.loadgen?.enabled === '1' ? 'btn-danger' : 'btn-accent'}`} onClick={() => setLoadgen({ enabled: status.loadgen?.enabled !== '1', rps, profile })}>
            {status.loadgen?.enabled === '1' ? 'Stop traffic' : 'Start traffic'}
          </button>
          <label>
            {rps} req/s
            <input type="range" min={0.5} max={10} step={0.5} value={rps} className="ml-2 align-middle" onChange={(e) => setRps(Number(e.target.value))} onMouseUp={() => setLoadgen({ rps })} onTouchEnd={() => setLoadgen({ rps })} />
          </label>
          <select
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              void setLoadgen({ profile: e.target.value });
            }}
          >
            <option value="healthy">healthy</option>
            <option value="mixed">mixed</option>
            <option value="broken">broken</option>
          </select>
          <span className="muted text-xs">
            {status.loadgen?.enabled === '1' ? '● running' : '○ stopped'} · last: {(status as { loadgen?: { stats?: { last?: string } } }).loadgen?.stats?.last ?? '-'}
          </span>
        </div>
      </Section>

      <Section title="Cheat sheet" subtitle="Things worth checking once data is flowing.">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Search a trace_id from the results above in Live tail (select the spans source); pivot to Logs &amp; events from the trace.</li>
          <li>In Errors, open an issue → Tags (service, kind, upstream, pg_code), Users, and the trace link; try Resolve / Ignore next N occurrences.</li>
          <li>Run traffic on the broken profile for ~10 minutes, then create a threshold alert on the error-rate chart and an anomaly alert on request volume.</li>
          <li>Take a service down, wait for the incident, acknowledge it from the mobile app, restore, and read the incident timeline + status page.</li>
          <li>In RUM, filter Sessions by user (Signed in users preset), open the replay, sort by Most errors, and build a funnel: / → /cart → checkout-completed.</li>
        </ul>
      </Section>
    </div>
  );
}

function ScenarioCard({ s, busy, onRun }: { s: Scenario; busy: boolean; onRun: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col rounded-lg border border-[#1f2a37] p-3">
      <div className="mb-1 flex items-center gap-2">
        <span>{s.emoji}</span>
        <span className="font-medium">{s.title}</span>
      </div>
      <p className="muted mb-2 text-xs">{s.description}</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {s.products.map((p) => (
          <span key={p} className="tag">
            {p}
          </span>
        ))}
        {s.userId ? <span className="tag">as {s.userId.replace('u-', '')}</span> : null}
      </div>
      {open ? (
        <ul className="mb-2 list-disc pl-4 text-xs">
          {s.expect.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex gap-2">
        <button className="btn btn-accent" disabled={busy} onClick={onRun} data-scenario={s.id + (s.userId ? `:${s.userId}` : '')}>
          {busy ? 'Running…' : 'Run'}
        </button>
        <button className="btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'What to look for'}
        </button>
      </div>
    </div>
  );
}
