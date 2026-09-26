-- Demo shop schema. Runs once on first container start.
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  emoji       TEXT NOT NULL DEFAULT '📦'
);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY,
  user_id         TEXT NOT NULL,
  user_name       TEXT NOT NULL DEFAULT 'guest',
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | fulfilled | failed
  total_cents     INTEGER NOT NULL,
  payment_id      TEXT,
  failure_reason  TEXT,
  trace_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id          SERIAL PRIMARY KEY,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  orders_seen INTEGER NOT NULL,
  revenue_cents INTEGER NOT NULL
);

INSERT INTO products (sku, name, description, price_cents, stock, emoji) VALUES
  ('COF-001', 'Ethiopian Yirgacheffe', 'Floral, citrus, light roast. 250g.',        1450, 500, '☕'),
  ('COF-002', 'Colombian Supremo',     'Caramel, nutty, medium roast. 250g.',       1250, 500, '☕'),
  ('COF-003', 'Sumatra Mandheling',    'Earthy, dark chocolate, dark roast. 250g.', 1350, 500, '☕'),
  ('GEAR-01', 'Pour-over Dripper',     'Ceramic V-shaped dripper, size 02.',        2400, 120, '🫖'),
  ('GEAR-02', 'Gooseneck Kettle',      '1L stainless, variable temperature.',       7900,  40, '🔥'),
  ('GEAR-03', 'Hand Grinder',          'Conical steel burr, 40 clicks.',            5600,  60, '⚙️'),
  ('SUB-001', 'Monthly Subscription',  'Two bags a month, free shipping.',          2800, 9999, '📬'),
  ('LTD-001', 'Limited Geisha Lot',    'Panama Geisha, 100g. Very limited.',        9900,   3, '💎');

-- Monitoring role for the Better Stack collector's PostgreSQL dashboards
CREATE ROLE betterstack WITH LOGIN PASSWORD 'betterstack';
GRANT pg_monitor TO betterstack;
GRANT CONNECT ON DATABASE bsdemo TO betterstack;
GRANT USAGE ON SCHEMA public TO betterstack;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
