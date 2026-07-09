// Internal, API-key-protected routes for machine-to-machine access (the
// GVM orchestrator script, and any future automation). Kept separate from
// the JWT-protected /api/clients etc. used by the human dashboard so the
// two auth mechanisms never have to share a route/method pair.
const express = require('express');
const db = require('../db');
const { requireApiKey } = require('../middleware/apiKey');
const { addActivity } = require('../utils/activity');
const { isTargetCoveredByScope } = require('../utils/scope');
const { CLIENT_STATUSES, isNonEmptyString, isValidEmail } = require('../utils/validate');

const router = express.Router();
router.use(requireApiKey);

const SCAN_STATUSES = ['pending', 'running', 'done', 'failed'];

function getClientOr404(req, res) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) {
    res.status(404).json({ error: 'Klant niet gevonden.' });
    return null;
  }
  return client;
}

// --- Clients: create/upsert -------------------------------------------------
// Matches on explicit id first, then falls back to an exact company_name
// match, else inserts a new client. Kept intentionally minimal — this
// endpoint exists so orchestration scripts can ensure a client row exists
// without duplicating the full dashboard client form.
router.post('/clients', (req, res) => {
  const body = req.body || {};

  if (!isNonEmptyString(body.company_name)) {
    return res.status(400).json({ error: 'company_name is verplicht.' });
  }
  if (body.status !== undefined && !CLIENT_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'Ongeldige status.' });
  }
  if (body.email !== undefined && !isValidEmail(body.email)) {
    return res.status(400).json({ error: 'Ongeldig e-mailadres.' });
  }

  const data = {
    company_name: body.company_name.trim(),
    contact_person: body.contact_person || null,
    email: body.email || null,
    phone: body.phone || null,
    city: body.city || null,
    status: body.status || 'Prospect',
    service_type: body.service_type || null,
    monthly_value: Number.isFinite(Number(body.monthly_value)) ? Number(body.monthly_value) : 0,
    notes: body.notes || null,
  };

  let existing = null;
  if (body.id) {
    existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(body.id);
  }
  if (!existing) {
    existing = db.prepare('SELECT * FROM clients WHERE company_name = ?').get(data.company_name);
  }

  let client;
  if (existing) {
    const merged = { ...existing, ...data };
    db.prepare(`
      UPDATE clients SET
        company_name = @company_name,
        contact_person = @contact_person,
        email = @email,
        phone = @phone,
        city = @city,
        status = @status,
        service_type = @service_type,
        monthly_value = @monthly_value,
        notes = @notes,
        updated_at = datetime('now')
      WHERE id = @id
    `).run(merged);
    addActivity(`Klant bijgewerkt via interne API: ${merged.company_name}`);
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(existing.id);
  } else {
    const info = db.prepare(`
      INSERT INTO clients (company_name, contact_person, email, phone, city, status, service_type, monthly_value, notes)
      VALUES (@company_name, @contact_person, @email, @phone, @city, @status, @service_type, @monthly_value, @notes)
    `).run(data);
    addActivity(`Nieuwe klant aangemaakt via interne API: ${data.company_name}`);
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  }

  res.status(existing ? 200 : 201).json(client);
});

// --- Consent -----------------------------------------------------------------
router.post('/clients/:id/consent', (req, res) => {
  const client = getClientOr404(req, res);
  if (!client) return;

  const body = req.body || {};
  if (!isNonEmptyString(body.scope)) {
    return res.status(400).json({ error: 'scope is verplicht.' });
  }
  if (!isNonEmptyString(body.authorized_by)) {
    return res.status(400).json({ error: 'authorized_by is verplicht.' });
  }

  let authorizedAt = new Date().toISOString();
  if (body.authorized_at !== undefined) {
    if (typeof body.authorized_at !== 'string' || Number.isNaN(Date.parse(body.authorized_at))) {
      return res.status(400).json({ error: 'Ongeldige authorized_at datum.' });
    }
    authorizedAt = body.authorized_at;
  }

  const info = db.prepare(`
    INSERT INTO client_consents (client_id, scope, authorized_by, authorized_at, document_reference)
    VALUES (?, ?, ?, ?, ?)
  `).run(client.id, body.scope.trim(), body.authorized_by.trim(), authorizedAt, body.document_reference || null);

  addActivity(`Toestemming vastgelegd voor ${client.company_name} (door ${body.authorized_by.trim()})`);
  const consent = db.prepare('SELECT * FROM client_consents WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(consent);
});

router.get('/clients/:id/consent', (req, res) => {
  const client = getClientOr404(req, res);
  if (!client) return;
  const consents = db.prepare('SELECT * FROM client_consents WHERE client_id = ? ORDER BY authorized_at DESC').all(client.id);
  res.json(consents);
});

// Revoking is the only mutation allowed on an existing consent record —
// consent history itself is never edited or deleted, only superseded.
router.patch('/clients/:id/consent/:consentId/revoke', (req, res) => {
  const client = getClientOr404(req, res);
  if (!client) return;

  const consent = db.prepare('SELECT * FROM client_consents WHERE id = ? AND client_id = ?').get(req.params.consentId, client.id);
  if (!consent) return res.status(404).json({ error: 'Toestemmingsrecord niet gevonden.' });
  if (consent.revoked_at) return res.status(409).json({ error: 'Toestemming was al ingetrokken.' });

  db.prepare('UPDATE client_consents SET revoked_at = datetime(\'now\') WHERE id = ?').run(consent.id);
  addActivity(`Toestemming ingetrokken voor ${client.company_name} (record #${consent.id})`);
  const updated = db.prepare('SELECT * FROM client_consents WHERE id = ?').get(consent.id);
  res.json(updated);
});

// --- Scans ---------------------------------------------------------------
// The consent check below is the hard block described in the spec: no
// non-revoked consent record whose scope covers target_value => 403, and
// no scan row is ever written. This is on top of (not instead of) the
// NOT NULL consent_id foreign key in the schema.
router.post('/clients/:id/scans', (req, res) => {
  const client = getClientOr404(req, res);
  if (!client) return;

  const body = req.body || {};
  const targetValue = isNonEmptyString(body.target_value) ? body.target_value.trim() : '';
  if (!targetValue) {
    return res.status(400).json({ error: 'target_value is verplicht.' });
  }
  const scanConfig = isNonEmptyString(body.scan_config) ? body.scan_config.trim() : 'Discovery';

  const activeConsents = db.prepare('SELECT * FROM client_consents WHERE client_id = ? AND revoked_at IS NULL').all(client.id);
  const matchingConsent = activeConsents.find((consent) => isTargetCoveredByScope(targetValue, consent.scope));

  if (!matchingConsent) {
    return res.status(403).json({
      error: 'Geen geldig, niet-ingetrokken toestemmingsrecord gevonden dat dit target dekt. Scan geweigerd.',
    });
  }

  const info = db.prepare(`
    INSERT INTO scans (client_id, consent_id, target_value, scan_config, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(client.id, matchingConsent.id, targetValue, scanConfig);

  addActivity(`Scan aangevraagd voor ${client.company_name}: ${targetValue} (${scanConfig})`);
  const scan = db.prepare('SELECT * FROM scans WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(scan);
});

router.get('/clients/:id/scans', (req, res) => {
  const client = getClientOr404(req, res);
  if (!client) return;
  const scans = db.prepare('SELECT * FROM scans WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  res.json(scans);
});

// Used by the orchestrator to discover work (pending scans to create in
// GVM, running scans to poll for completion) without iterating every client.
router.get('/scans', (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !SCAN_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Ongeldige status filter.' });
  }

  let sql = `
    SELECT s.*, c.company_name AS client_name
    FROM scans s
    JOIN clients c ON c.id = s.client_id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    sql += ' AND s.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY s.created_at ASC';

  res.json(db.prepare(sql).all(...params));
});

router.patch('/scans/:id/status', (req, res) => {
  const scan = db.prepare('SELECT * FROM scans WHERE id = ?').get(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Scan niet gevonden.' });

  const body = req.body || {};
  if (!SCAN_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'Ongeldige status.' });
  }

  const completedAt = ['done', 'failed'].includes(body.status)
    ? new Date().toISOString()
    : scan.completed_at;

  db.prepare(`
    UPDATE scans SET
      status = ?,
      gvm_task_id = COALESCE(?, gvm_task_id),
      gvm_target_id = COALESCE(?, gvm_target_id),
      error_message = COALESCE(?, error_message),
      completed_at = ?
    WHERE id = ?
  `).run(
    body.status,
    body.gvm_task_id || null,
    body.gvm_target_id || null,
    body.error_message || null,
    completedAt,
    scan.id,
  );

  addActivity(`Scanstatus bijgewerkt (#${scan.id}): ${scan.status} → ${body.status}`);
  const updated = db.prepare('SELECT * FROM scans WHERE id = ?').get(scan.id);
  res.json(updated);
});

module.exports = router;
