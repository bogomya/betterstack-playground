# Scenario and chaos-flag reference

## One-shot scenarios (`POST /orders` body `chaos`, or the Lab buttons)

| `chaos` value | Fails in | Result | What it demonstrates |
|---|---|---|---|
| *(empty)* | - | 201, order fulfilled by the worker | full distributed trace across 5 services |
| `throw` | orders-api | 500 | unhandled exception with request + user + trace context |
| `background_throw` | orders-api | 201, then an unhandled rejection | global error handler, no request context |
| `inventory_throw` | inventory-api | 502 | cascade: root cause + upstream error in two apps |
| `payments_crash` | payments (Python) | 502 | third-level cascade, compensation (`/release`) |
| `payments_timeout` | payments | 504 | client timeout, child span outlives parent |
| `db_bad_query` | inventory-api | 500 | Postgres `42P01` in the pg span |
| `db_slow` | inventory-api | 201 (slow) | 3 s DB span, latency outlier |
| `db_write_fail` | orders-api | 500 | CHECK constraint `23514` after payment captured |
| `async_fail` | worker | 201, order `failed` later | retries (3 attempts), async trace continuation |
| `worker_slow` | worker | 201 | long consumer span |
| `worker_cpu` | worker | 201 | CPU spike in container metrics |

User personalities override behaviour: **bob** → card declined (402), **carol** → 1.5 s inventory query, **dave** → `async_fail` on every order.

## Persistent chaos flags (Redis hash `chaos:<service>`; Lab → "Chaos knobs")

| Service | Key | Values | Effect |
|---|---|---|---|
| orders / inventory / payments | `health_fail` | `1` | `/health` returns 503 → Uptime incident |
| orders / inventory | `error_rate` | 0-100 | random 500s for that % of requests |
| orders / inventory | `latency_ms` | ms | added latency on every request |
| inventory | `db_mode` | `slow`, `bad_query` | every reservation hits the DB scenario |
| payments | `mode` | `slow`, `crash`, `decline_all` | |
| worker | `mode` | `slow`, `fail`, `cpu` | |
| cron | `heartbeat` | `skip`, `fail`, `crash` | missed beat / explicit `/fail` / job exception |

Reset everything: Lab → "Reset all chaos" or `curl -X DELETE localhost:4001/admin/chaos`.

## Load generator (Redis hash `loadgen:config`)

`enabled` (`1`/`0`), `rps` (0.1-20), `profile` (`healthy` | `mixed` | `broken`). Stats in `loadgen:stats`.
