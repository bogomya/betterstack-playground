# Better Stack Playground

A small but realistic system (Next.js storefront, two Node APIs, a Python API, a BullMQ worker, a cron job,
Postgres, Redis) wired into Better Stack products (Uptime, Telemetry, Errors, RUM), plus a **Chaos Lab** page that
triggers success and failure scenarios on demand. Everything runs in Docker Compose; the stack is exposed to the
internet through a Cloudflare quick tunnel so Better Stack Uptime can monitor it.

```
 browser ──RUM/JS tag──▶ Better Stack RUM + Errors
    │
    ▼
 Cloudflare tunnel ─▶ Caddy :8080 ─┬─▶ web (Next.js)  ── /api/* ──▶ orders-api (Fastify)
                                   ├─▶ /svc/orders/*                 │   ├─▶ inventory-api (Fastify + Postgres)
                                   ├─▶ /svc/inventory/*              │   ├─▶ payments (FastAPI, Python)
                                   └─▶ /svc/payments/*               │   └─▶ Redis/BullMQ ─▶ worker ─▶ Postgres
                                                                     cron ─▶ Postgres + Better Stack heartbeat
 all services ──OTLP (traces, metrics, logs)──▶ Better Stack Telemetry source "bsdemo-otel"
 all services ──Sentry SDK (errors)──────────▶ Better Stack Errors application per service
 Docker host  ──Better Stack collector (optional profile)──▶ Docker logs, host metrics, eBPF traces, DB dashboards
```

## Quick start

```bash
cp .env.example .env           # add BETTER_STACK_API_TOKEN (global API token)
pnpm install
pnpm bs:setup                  # creates source, collector, error apps, severity, heartbeat, monitor group -> .env.bs
docker compose --env-file .env.bs up -d --build
pnpm bs:sync                   # reads the tunnel URL, creates/updates monitors + status page
pnpm bs:verify                 # runs scenarios and checks that data arrived (SQL API, heartbeat, monitors)
pnpm bs:dashboards             # "bsdemo overview" dashboard (8 SQL charts) + 3 alerts
pnpm rum:simulate 6            # 6 headless-Chromium user journeys -> RUM sessions, replays, frontend errors
pnpm bs:sql "SELECT ..."       # ad-hoc ClickHouse SQL over your data (SQL API); no argument lists the tables
pnpm tsx scripts/rum-check.mts # headless check that the JS tag loads and talks to Better Stack
```

Free-plan budget: 3 GB of logs and 3 GB of traces per month. A checkout is ~10 spans + ~8 log lines, so keep the
synthetic traffic to short bursts (the Lab defaults to 2 req/s; a few minutes is plenty) and stop it afterwards.

| What | Where |
|---|---|
| Storefront | http://localhost:8080 (also the tunnel URL from `pnpm tunnel:url`) |
| Chaos Lab | http://localhost:8080/lab |
| Direct service ports | web 3100, orders-api 4001, inventory-api 4002, payments 4003, postgres 5432, redis 6379 |
| Optional: Better Stack collector | `docker compose --env-file .env.bs --profile collector up -d` (eBPF traces, Docker logs, host + Postgres/Redis metrics) |
| Silence / restore paging (monitors, heartbeat, telemetry alerts) | `pnpm bs:pause`, `pnpm bs:resume`, `pnpm bs:status`; scopes `--monitors --heartbeat --alerts`. Run `pnpm bs:pause` before `docker compose down` or when you stop for the day |
| Keep the quick tunnel alive | `pnpm tunnel:watch` (restarts it and re-syncs monitors when it dies) |
| Tear down everything in Better Stack | `pnpm bs:teardown --yes` |

The tunnel hostname changes whenever the `tunnel` container is recreated; re-run `pnpm bs:sync` afterwards.

**Laptop sleep drops the quick tunnel** and every monitor opens an incident (HTTP 530). Keep the machine awake while
monitors are active (`caffeinate -dims`), run `pnpm tunnel:watch`, or pause the monitors.
Monitors use a 180 s confirmation period, so a blip shorter than one extra check does not page; the anomaly alert on request
volume only fires on increases, so stopping the traffic generator is not an anomaly.

## What is instrumented how

| Service | Traces / metrics / logs | Errors | Notes |
|---|---|---|---|
| web (Next.js 15) | `@vercel/otel` in `instrumentation.ts` → OTLP; `@logtail/next` for structured logs (server + browser via `/betterstack/*` proxy) | JS tag in `<head>` (browser, also RUM); `@sentry/node` + `onRequestError` (server) | `<meta name="traceparent">` lets the tag continue the server trace of the page load |
| orders-api, inventory-api (Fastify) | `@opentelemetry/sdk-node` + auto-instrumentations (http, undici, fastify, pg, ioredis, pino) → OTLP | `@sentry/node`: the Fastify integration reports 5xx errors, a `beforeSend` hook links them to the OpenTelemetry trace | user identity travels in `x-user-*` headers |
| payments (FastAPI) | `opentelemetry-instrument` auto-instrumentation from `OTEL_*` env vars | `sentry-sdk[fastapi]` with `before_send` trace link | |
| worker (BullMQ) | manual consumer spans continuing the `traceparent` stored in the job | `@sentry/node`, one capture per attempt | ioredis instrumentation disabled on purpose |
| cron | manual span per run | `@sentry/node` | pings the Better Stack heartbeat URL (`/fail` on failure) |
| postgres, redis | Docker logs + DB dashboards via the collector profile | | `betterstack` role + `pg_stat_statements` pre-created |

Scenario reference: [docs/scenarios.md](docs/scenarios.md).

## Repository layout

```
apps/web                 Next.js storefront + /lab
services/orders-api      checkout orchestration + chaos control plane (/admin/*)
services/inventory-api   catalogue & stock (Postgres)
services/payments        Python FastAPI payment adapter
services/worker          BullMQ fulfilment worker
services/cron            hourly report job + heartbeat
services/loadgen         synthetic traffic (controlled from /lab)
packages/shared          telemetry bootstrap, logger, chaos flags, demo users
infra/                   Postgres schema, Caddy config
scripts/                 Better Stack automation (setup, sync, verify, teardown) using the public APIs
```
