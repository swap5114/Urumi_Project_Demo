import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  key_prefix  TEXT NOT NULL,           -- first chars, shown in UI so a key can be recognised
  key_hash    TEXT NOT NULL UNIQUE,    -- SHA-256 of the full key, never the key itself
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,                    -- NULL = active
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS servers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  url             TEXT NOT NULL,
  auth_type       TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none','bearer','header')),
  auth_header     TEXT,                -- header name when auth_type = 'header'
  credential_enc  TEXT,                -- AES-GCM ciphertext, NEVER plaintext
  enabled         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'unknown',   -- connected | unreachable | unknown
  status_reason   TEXT,
  status_checked_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- user_id / server_slug are plain values, not foreign keys, so history survives deletes.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id      INTEGER,
  user_email   TEXT,
  server_slug  TEXT,
  tool         TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('success','error')),
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
`;

export function openDb(path = process.env.DB_PATH ?? "./gateway.db"): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON"); // SQLite ignores FKs unless you turn this on, per connection
  db.exec(SCHEMA);
  return db;
}
