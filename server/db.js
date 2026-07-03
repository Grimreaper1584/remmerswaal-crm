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
`);

// --- Seed default users (robin & dani) ---
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
  );
  const defaultHash = bcrypt.hashSync('Remmerswaal2026!', 10);
  insertUser.run('robin', defaultHash, 'Robin', 'admin');
  insertUser.run('dani', defaultHash, 'Dani', 'admin');
}

// --- Seed sample data on first run so the app isn't empty ---
const clientCount = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
if (clientCount === 0) {
  const insertClient = db.prepare(`
    INSERT INTO clients (company_name, contact_person, email, phone, city, status, service_type, monthly_value, notes, date_added)
    VALUES (@company_name, @contact_person, @email, @phone, @city, @status, @service_type, @monthly_value, @notes, @date_added)
  `);
  const insertSub = db.prepare(`
    INSERT INTO subscriptions (client_id, service, price_per_month, start_date, next_invoice_date, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAppt = db.prepare(`
    INSERT INTO appointments (client_id, date, type, notes)
    VALUES (?, ?, ?, ?)
  `);
  const logActivity = db.prepare('INSERT INTO activity_log (message) VALUES (?)');

  const sample = [
    { company_name: 'Van der Berg Logistics B.V.', contact_person: 'Mark van der Berg', email: 'mark@vdberglogistics.nl', phone: '06-12345678', city: 'Rotterdam', status: 'Actief', service_type: 'Retainer', monthly_value: 495, notes: 'Maandelijkse retainer, wil ook KnowBe4 bespreken.' },
    { company_name: 'Bakkerij De Gouden Korst', contact_person: 'Lisa Jansen', email: 'lisa@goudenkorst.nl', phone: '06-23456789', city: 'Utrecht', status: 'Actief', service_type: 'KnowBe4', monthly_value: 149, notes: 'Security awareness training voor 12 medewerkers.' },
    { company_name: 'Meijer Advocaten', contact_person: 'Peter Meijer', email: 'p.meijer@meijeradvocaten.nl', phone: '06-34567890', city: 'Amsterdam', status: 'Actief', service_type: 'Security Audit', monthly_value: 0, notes: 'Jaarlijkse audit uitgevoerd in maart.' },
    { company_name: 'TechFlow Solutions', contact_person: 'Sanne de Wit', email: 'sanne@techflow.nl', phone: '06-45678901', city: 'Eindhoven', status: 'Actief', service_type: 'Retainer', monthly_value: 695, notes: 'Grote klant, maandelijkse pentest scope.' },
    { company_name: 'Groenzicht Hoveniers', contact_person: 'Tom Groen', email: 'tom@groenzicht.nl', phone: '06-56789012', city: 'Den Haag', status: 'Prospect', service_type: 'Externe Scan', monthly_value: 0, notes: 'Offerte verstuurd, wacht op reactie.' },
    { company_name: 'Huisarts Praktijk Noord', contact_person: 'Dr. Femke Willems', email: 'info@huisartspraktijknoord.nl', phone: '06-67890123', city: 'Groningen', status: 'Actief', service_type: 'Externe Scan', monthly_value: 79, notes: 'Maandelijkse externe kwetsbaarheidsscan (AVG verplicht).' },
    { company_name: 'Bouwbedrijf Hermans', contact_person: 'Rik Hermans', email: 'rik@hermansbouw.nl', phone: '06-78901234', city: 'Tilburg', status: 'Inactief', service_type: 'Security Audit', monthly_value: 0, notes: 'Contract afgelopen, geen verlenging.' },
    { company_name: 'FinanceHub Accountants', contact_person: 'Iris Bakker', email: 'iris@financehub.nl', phone: '06-89012345', city: 'Rotterdam', status: 'Actief', service_type: 'Retainer', monthly_value: 350, notes: 'Financiele sector, strenge compliance eisen.' }
  ];

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  sample.forEach((c, idx) => {
    const dateAdded = new Date(today.getFullYear(), today.getMonth() - (idx % 6), 5 + idx);
    const info = insertClient.run({ ...c, date_added: iso(dateAdded) });
    const clientId = info.lastInsertRowid;
    logActivity.run(`Nieuwe klant toegevoegd: ${c.company_name}`);

    if (c.service_type === 'Retainer' && c.status === 'Actief') {
      const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
      const nextInvoice = new Date(today.getFullYear(), today.getMonth() + (idx % 2 === 0 ? 1 : 0), 1);
      insertSub.run(clientId, c.company_name + ' - Retainer', c.monthly_value, iso(start), iso(nextInvoice), 'Actief');
    }

    if (idx % 2 === 0) {
      const apptDate = new Date(today.getFullYear(), today.getMonth(), (idx + 3) % 28 + 1);
      const types = ['Intake', 'Scan', 'Nabespreking', 'Factuur'];
      insertAppt.run(clientId, iso(apptDate), types[idx % types.length], `Afspraak met ${c.contact_person}`);
    }
  });

  logActivity.run('Systeem geinitialiseerd met voorbeelddata');
}

module.exports = db;
