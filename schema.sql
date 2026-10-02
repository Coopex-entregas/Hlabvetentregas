PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cooperado')),
  weekly_base_amount REAL NOT NULL DEFAULT 663.33,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL DEFAULT 'fora_natal' CHECK (category IN ('natal', 'zona_norte', 'fora_natal')),
  weekday_value REAL NOT NULL DEFAULT 0,
  weekend_value REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_date TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  notes TEXT NOT NULL DEFAULT '',
  billing_mode TEXT NOT NULL DEFAULT 'auto' CHECK (billing_mode IN ('auto', 'included', 'extra')),
  value_override REAL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_closures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  delivery_count INTEGER NOT NULL,
  included_count INTEGER NOT NULL,
  extra_count INTEGER NOT NULL,
  base_amount REAL NOT NULL,
  extra_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, week_start)
);

CREATE TABLE IF NOT EXISTS monthly_closures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  delivery_count INTEGER NOT NULL,
  extra_count INTEGER NOT NULL,
  base_amount REAL NOT NULL,
  extra_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_user_date ON deliveries(user_id, delivery_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON deliveries(delivery_date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_user_end ON weekly_closures(user_id, week_end);
CREATE INDEX IF NOT EXISTS idx_monthly_user_month ON monthly_closures(user_id, month);

INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('weekday_included', '6', datetime('now')),
  ('weekend_natal_included', '2', datetime('now'));

INSERT OR IGNORE INTO locations(id, name, category, weekday_value, weekend_value, active, sort_order, created_at, updated_at) VALUES
  ('loc-natal', 'Natal', 'natal', 20, 20, 1, 10, datetime('now'), datetime('now')),
  ('loc-zona-norte', 'Zona Norte de Natal', 'zona_norte', 20, 20, 1, 20, datetime('now'), datetime('now')),
  ('loc-parnamirim', 'Parnamirim', 'fora_natal', 20, 20, 1, 30, datetime('now'), datetime('now')),
  ('loc-macaiba', 'Macaíba', 'fora_natal', 30, 30, 1, 40, datetime('now'), datetime('now')),
  ('loc-sao-jose', 'São José de Mipibu', 'fora_natal', 50, 50, 1, 50, datetime('now'), datetime('now')),
  ('loc-cajupiranga', 'Cajupiranga', 'fora_natal', 30, 30, 1, 60, datetime('now'), datetime('now'));
