CREATE TABLE IF NOT EXISTS menu (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL,
 data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 week_start TEXT NOT NULL,
 created_at TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 data TEXT NOT NULL,
 email_status TEXT NOT NULL CHECK(email_status IN ('pending','sent','disabled'))
);
CREATE INDEX IF NOT EXISTS orders_week ON orders(week_start,created_at);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS limits_expiry ON rate_limits(expires);
