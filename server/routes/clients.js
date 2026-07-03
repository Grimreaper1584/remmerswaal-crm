const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addActivity } = require('../utils/activity');
const {
  CLIENT_STATUSES,
  SERVICE_TYPES,
  isNonEmptyString,
  isValidEmail,
  isValidDate,
  isValidNumber,
} = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

function validateClientPayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.company_name !== undefined) {
    if (!isNonEmptyString(body.company_name)) errors.push('Bedrijfsnaam is verplicht.');
    data.company_name = (body.company_name || '').trim();
  }
  if (!partial || body.status !== undefined) {
    if (!CLIENT_STATUSES.includes(body.status)) errors.push('Ongeldige status.');
    data.status = body.status;
  }
  if (!partial || body.service_type !== undefined) {
    if (body.service_type && !SERVICE_TYPES.includes(body.service_type)) errors.push('Ongeldig type dienst.');
    data.service_type = body.service_type || null;
  }
  if (!partial || body.monthly_value !== undefined) {
    const val = Number(body.monthly_value ?? 0);
    if (!isValidNumber(val) || val < 0) errors.push('Maandwaarde moet een positief getal zijn.');
    data.monthly_value = val;
  }
  if (body.email !== undefined) {
    if (!isValidEmail(body.email)) errors.push('Ongeldig e-mailadres.');
    data.email = body.email || null;
  }
  if (body.date_added !== undefined && body.date_added) {
    if (!isValidDate(body.date_added)) errors.push('Ongeldige datum toegevoegd.');
    data.date_added = body.date_added;
  }

  data.contact_person = body.contact_person !== undefined ? (body.contact_person || null) : undefined;
  data.phone = body.phone !== undefined ? (body.phone || null) : undefined;
  data.city = body.city !== undefined ? (body.city || null) : undefined;
  data.notes = body.notes !== undefined ? (body.notes || null) : undefined;

  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

  return { errors, data };
}

router.get('/', (req, res) => {
  const { search, status, service_type } = req.query;
  let sql = 'SELECT * FROM clients WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND (company_name LIKE ? OR contact_person LIKE ? OR email LIKE ? OR city LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (status && CLIENT_STATUSES.includes(status)) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (service_type && SERVICE_TYPES.includes(service_type)) {
    sql += ' AND service_type = ?';
    params.push(service_type);
  }
  sql += ' ORDER BY company_name ASC';

  const clients = db.prepare(sql).all(...params);
  res.json(clients);
});

router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Klant niet gevonden.' });
  res.json(client);
});

router.post('/', (req, res) => {
  const { errors, data } = validateClientPayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const stmt = db.prepare(`
    INSERT INTO clients (company_name, contact_person, email, phone, city, status, service_type, monthly_value, notes, date_added)
    VALUES (@company_name, @contact_person, @email, @phone, @city, @status, @service_type, @monthly_value, @notes, @date_added)
  `);
  const info = stmt.run({
    company_name: data.company_name,
    contact_person: data.contact_person || null,
    email: data.email || null,
    phone: data.phone || null,
    city: data.city || null,
    status: data.status,
    service_type: data.service_type || null,
    monthly_value: data.monthly_value,
    notes: data.notes || null,
    date_added: data.date_added || new Date().toISOString().slice(0, 10),
  });

  addActivity(`Nieuwe klant toegevoegd: ${data.company_name}`);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Klant niet gevonden.' });

  const { errors, data } = validateClientPayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

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
      date_added = @date_added,
      updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);

  addActivity(`Klant bijgewerkt: ${merged.company_name}`);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json(client);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Klant niet gevonden.' });

  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  addActivity(`Klant verwijderd: ${existing.company_name}`);
  res.json({ success: true });
});

module.exports = router;
