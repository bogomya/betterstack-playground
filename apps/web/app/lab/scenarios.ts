/**
 * Scenario catalogue for the Chaos Lab. Backend scenarios are executed through /api/lab/run so the
 * trace starts in the web app; frontend scenarios run in the browser.
 */
export interface Scenario {
  id: string;
  title: string;
  emoji: string;
  description: string;
  /** What to look for in Better Stack after running it */
  expect: string[];
  /** Run as this demo user instead of the current one */
  userId?: string;
  /** Which Better Stack product this mainly exercises */
  products: ('Telemetry' | 'Errors' | 'RUM' | 'Uptime')[];
}

export const BACKEND_SCENARIOS: Scenario[] = [
  {
    id: 'success',
    title: 'Happy-path checkout',
    emoji: '✅',
    description: 'web → orders-api → inventory-api (Postgres) → payments (Python) → Postgres → BullMQ → worker.',
    expect: [
      'One trace with 5 services; spans for pg, fetch, the Python FastAPI route and the async job.',
      'Logs from every service share the same trace_id (Live tail: search it).',
      'Order flips from paid to fulfilled on the Orders page within a few seconds.',
    ],
    products: ['Telemetry'],
  },
  {
    id: 'throw',
    title: 'Unhandled exception in orders-api',
    emoji: '💥',
    description: 'A plain bug in checkout code. HTTP 500.',
    expect: ['New error in the bsdemo-orders-api application with user, request and trace context.', 'Error span in the trace; log line with level=error and the same trace_id.'],
    products: ['Errors', 'Telemetry'],
  },
  {
    id: 'inventory_throw',
    title: 'Cascade: inventory-api throws',
    emoji: '🔗',
    description: 'Second service fails; orders-api turns it into a 502.',
    expect: [
      'Two errors: the root cause in bsdemo-inventory-api and the UpstreamError (tag kind=cascade) in bsdemo-orders-api.',
      'Same trace_id on both; the trace waterfall shows which service actually broke.',
    ],
    products: ['Errors', 'Telemetry'],
  },
  {
    id: 'payments_crash',
    title: 'Cascade, 3rd level: Python payments crashes',
    emoji: '🐍',
    description: 'RuntimeError inside FastAPI after stock was reserved; orders-api releases the stock and returns 502.',
    expect: ['Python exception in bsdemo-payments linked to the trace (before_send hook).', 'Compensation call POST /release visible in the trace.'],
    products: ['Errors', 'Telemetry'],
  },
  {
    id: 'payments_timeout',
    title: 'Timeout: payments takes 8 s',
    emoji: '⏳',
    description: 'orders-api gives up after 5 s (504). The Python span still completes later.',
    expect: ['UpstreamTimeoutError in orders-api.', 'A trace where the child span outlives its parent; latency outlier in dashboards.'],
    products: ['Telemetry', 'Errors'],
  },
  {
    id: 'db_bad_query',
    title: 'Database error: undefined table',
    emoji: '🗄️',
    description: 'inventory-api queries a table that does not exist (Postgres 42P01).',
    expect: ['Error tagged kind=database pg_code=42P01 with the SQL in the pg span.', 'Postgres logs the failed statement too (collector profile).'],
    products: ['Errors', 'Telemetry'],
  },
  {
    id: 'db_slow',
    title: 'Slow query (pg_sleep 3 s)',
    emoji: '🐌',
    description: 'Succeeds, but the DB span takes 3 s.',
    expect: ['p95 latency jump for POST /orders and POST /reserve.', 'A 3 s pg span in the waterfall; good candidate for a latency alert.'],
    products: ['Telemetry'],
  },
  {
    id: 'db_write_fail',
    title: 'Constraint violation after payment',
    emoji: '💸',
    description: 'Payment is captured, then the INSERT violates a CHECK constraint (23514). Money taken, no order.',
    expect: ['Error in bsdemo-orders-api after the payments span succeeded: the trace tells the business impact.'],
    products: ['Errors', 'Telemetry'],
  },
  {
    id: 'async_fail',
    title: 'Async failure in the worker (3 retries)',
    emoji: '🧵',
    description: 'Checkout returns 201, then the fulfilment job throws on every attempt.',
    expect: [
      'Three exceptions in bsdemo-worker (attempt 1..3, final=true on the last) grouped as one error.',
      'Consumer spans attached to the checkout trace via the propagated traceparent.',
      'Order ends as failed on the Orders page.',
    ],
    products: ['Errors', 'Telemetry'],
  },
  {
    id: 'background_throw',
    title: 'Unhandled promise rejection after the response',
    emoji: '👻',
    description: 'A fire-and-forget task rejects 50 ms after the 201 was sent.',
    expect: ['Error captured by the global handler: no request context, no trace link. Compare with the "throw" scenario.'],
    products: ['Errors'],
  },
  {
    id: 'declined',
    title: 'Handled business error: card declined (Bob)',
    emoji: '💳',
    description: 'Payments answers 402; orders-api releases stock and returns 402. No exception anywhere.',
    expect: ['No new error in Errors.', 'warn-level logs in payments and orders-api; metric orders.failed{reason=payment_declined}.'],
    userId: 'u-bob',
    products: ['Telemetry'],
  },
  {
    id: 'slow_user',
    title: 'Latency for one segment only (Carol)',
    emoji: '🐢',
    description: 'Carol always hits a 1.5 s inventory query. Everyone else is fast.',
    expect: ['Filter spans by enduser.id=u-carol to find the regression; averages hide it.'],
    userId: 'u-carol',
    products: ['Telemetry'],
  },
  {
    id: 'success',
    title: 'Async failure for one user (Dave)',
    emoji: '🎯',
    description: 'Dave pays fine but the worker always rejects his orders.',
    expect: ['Errors → Users tab shows Dave as the only affected user.'],
    userId: 'u-dave',
    products: ['Errors'],
  },
  {
    id: 'out_of_stock',
    title: 'Out of stock (409)',
    emoji: '📦',
    description: 'Orders 50 units of the limited item (stock 3).',
    expect: ['409 with a warn log, no exception. Metric inventory.reservations{outcome=out_of_stock}.'],
    products: ['Telemetry'],
  },
  {
    id: 'validation',
    title: 'Validation error (400)',
    emoji: '🚫',
    description: 'Empty cart submitted.',
    expect: ['400, warn log only.'],
    products: ['Telemetry'],
  },
  {
    id: 'not_found',
    title: 'Unknown order (404)',
    emoji: '🔍',
    description: 'GET /orders/<nil uuid>.',
    expect: ['404 with a warn log.'],
    products: ['Telemetry'],
  },
  {
    id: 'worker_slow',
    title: 'Slow background job (5 s)',
    emoji: '🕰️',
    description: 'Fulfilment sleeps 5 s.',
    expect: ['Long consumer span; jobs.duration histogram p95 goes up.'],
    products: ['Telemetry'],
  },
  {
    id: 'worker_cpu',
    title: 'CPU-heavy job (8 s at 100%)',
    emoji: '🔥',
    description: 'The worker burns a CPU core.',
    expect: ['Container CPU spike in the collector dashboards (Docker / host metrics).'],
    products: ['Telemetry'],
  },
  {
    id: 'burst',
    title: 'Burst: 15 parallel checkouts',
    emoji: '🚀',
    description: 'Quick traffic spike.',
    expect: ['Request-rate spike on the OpenTelemetry dashboard; 15 traces in a second.'],
    products: ['Telemetry'],
  },
];

export const FRONTEND_SCENARIOS: Scenario[] = [
  {
    id: 'fe_throw',
    title: 'Uncaught exception in a click handler',
    emoji: '💥',
    description: 'throw new Error(...) inside onClick.',
    expect: ['New frontend error in bsdemo-web with browser/OS context, the identified user and a link to the session replay.'],
    products: ['Errors', 'RUM'],
  },
  {
    id: 'fe_reject',
    title: 'Unhandled promise rejection',
    emoji: '🫥',
    description: 'Promise.reject without a catch.',
    expect: ['Captured as an error (unhandledrejection); check how it is grouped vs. the click-handler error.'],
    products: ['Errors', 'RUM'],
  },
  {
    id: 'fe_fetch_404',
    title: 'Failed API call (404) + console.error',
    emoji: '📡',
    description: 'fetch("/api/does-not-exist") then console.error with the response.',
    expect: ['console.error appears in the session timeline (Collect console.logs toggle).', 'Nothing in Errors unless you throw.'],
    products: ['RUM'],
  },
  {
    id: 'fe_network_fail',
    title: 'Network failure to an unreachable host',
    emoji: '🔌',
    description: 'fetch to https://api.invalid-host.example rejects with TypeError.',
    expect: ['Unhandled rejection "Failed to fetch" style error; useful to test ignoreErrors via betterstack("config").'],
    products: ['Errors', 'RUM'],
  },
  {
    id: 'fe_render_crash',
    title: 'React render crash (error boundary)',
    emoji: '🧱',
    description: 'Navigates to /boom, which throws during render; app/error.tsx catches it.',
    expect: [
      'Error in bsdemo-web reported by error.tsx (console.error + window.Sentry).',
      'Custom event react-error-boundary in the session.',
    ],
    products: ['Errors', 'RUM'],
  },
  {
    id: 'fe_slow_page',
    title: 'Slow page (3 s TTFB)',
    emoji: '🐌',
    description: 'Full navigation to /slow.',
    expect: ['TTFB/LCP outlier for /slow in RUM → Web vitals; pageload trace continues the server trace (meta traceparent).'],
    products: ['RUM', 'Telemetry'],
  },
  {
    id: 'fe_long_task',
    title: 'Main-thread freeze (2.5 s)',
    emoji: '🧊',
    description: 'Synchronous CPU loop in the browser.',
    expect: ['Interaction latency; page becomes unresponsive in the replay.'],
    products: ['RUM'],
  },
  {
    id: 'fe_memory',
    title: 'JS heap bloat (~150 MB for 60 s)',
    emoji: '🎈',
    description: 'Allocates big arrays and keeps them referenced.',
    expect: ['memory events (Chrome only) climb in the session; JS heap chart in Web vitals.'],
    products: ['RUM'],
  },
  {
    id: 'fe_track',
    title: 'Custom product event',
    emoji: '🏷️',
    description: "betterstack('track', 'lab-custom-event', {...}).",
    expect: ['Event in Sessions → timeline and in Explore events; usable as a funnel step.'],
    products: ['RUM'],
  },
  {
    id: 'fe_server_error',
    title: 'Next.js route handler crash (server side)',
    emoji: '🖥️',
    description: 'GET /api/lab/server-error throws inside Next.js.',
    expect: ['Error in bsdemo-web tagged kind=next_request_error (instrumentation.ts onRequestError).'],
    products: ['Errors'],
  },
];
