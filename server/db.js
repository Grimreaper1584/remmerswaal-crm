const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'crm.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'Prospect',
  service_type TEXT,
  monthly_value REAL NOT NULL DEFAULT 0,
  notes TEXT,
  date_added TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  price_per_month REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  next_invoice_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Actief',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  amount REAL NOT NULL DEFAULT 0,
  description TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Consent records: the legal basis (art. 138ab Sr) for ever scanning a
-- client's infrastructure. scope holds the authorized IPs/domains as a
-- free-text list (comma/newline separated, CIDR and wildcard supported —
-- see server/utils/scope.js). revoked_at is set (never deleted) to keep an
-- audit trail of withdrawn consent.
CREATE TABLE IF NOT EXISTS client_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL DEFAULT (datetime('now')),
  document_reference TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_consents_client_id ON client_consents(client_id);

-- consent_id is intentionally NOT NULL with no default: this is the
-- data-layer half of the consent gate. There is no code path (and no raw
-- SQL insert) that can create a scan row without pointing at an existing
-- consent record.
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  consent_id INTEGER NOT NULL REFERENCES client_consents(id),
  target_value TEXT NOT NULL,
  scan_config TEXT NOT NULL DEFAULT 'Discovery',
  gvm_task_id TEXT,
  gvm_target_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scans_client_id ON scans(client_id);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
`);

// --- Seed default login accounts (robin & dani) ---
// Only runs when the users table is empty, so existing accounts (and any
// password changes made via Instellingen) are never touched or overwritten.
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
  );
  const defaultHash = bcrypt.hashSync('Remmerswaal2026!', 10);
  insertUser.run('robin', defaultHash, 'Robin', 'admin');
  insertUser.run('dani', defaultHash, 'Dani', 'admin');
}

module.exports = db;
