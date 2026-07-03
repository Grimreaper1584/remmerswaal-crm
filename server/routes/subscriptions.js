const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addActivity } = require('../utils/activity');
const { SUBSCRIPTION_STATUSES, isValidDate, isValidNumber, isNonEmptyString } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

const SELECT_WITH_CLIENT = `
  SELECT s.*, c.company_name AS client_name
  FROM subscriptions s
  JOIN clients c ON c.id = s.client_id
`;

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.client_id !== undefined) {
    const clientId = Number(body.client_id);
    if (!clientId || !db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) {
      errors.push('Ongeldige klant.');
    }
    data.client_id = clientId;
  }
  if (!partial || body.service !== undefined) {
    if (!isNonEmptyString(body.service)) errors.push('Dienst is verplicht.');
    data.service = (body.service || '').trim();
  }
  if (!partial || body.price_per_month !== undefined) {
    const val = Number(body.price_per_month);
    if (!isValidNumber(val) || val < 0) errors.push('Prijs per maand moet een positief getal zijn.');
    data.price_per_month = val;
  }
  if (!partial || body.start_date !== undefined) {
    if (!isValidDate(body.start_date)) errors.push('Ongeldige startdatum.');
    data.start_date = body.start_date;
  }
  if (!partial || body.next_invoice_date !== undefined) {
    if (!isValidDate(body.next_invoice_date)) errors.push('Ongeldige volgende factuurdatum.');
    data.next_invoice_date = body.next_invoice_date;
  }
  if (!partial || body.status !== undefined) {
    if (!SUBSCRIPTION_STATUSES.includes(body.status)) errors.push('Ongeldige status.');
    data.status = body.status;
  }

  return { errors, data };
}

router.get('/', (req, res) => {
  const subs = db.prepare(`${SELECT_WITH_CLIENT} ORDER BY s.next_invoice_date ASC`).all();
  res.json(subs);
});

router.post('/', (req, res) => {
  const { errors, data } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const info = db.prepare(`
    INSERT INTO subscriptions (client_id, service, price_per_month, start_date, next_invoice_date, status)
    VALUES (@client_id, @service, @price_per_month, @start_date, @next_invoice_date, @status)
  `).run(data);

  const client = db.prepare('SELECT company_name FROM clients WHERE id = ?').get(data.client_id);
  addActivity(`Nieuwe subscriptie aangemaakt voor ${client.company_name}: ${data.service}`);

  const sub = db.prepare(`${SELECT_WITH_CLIENT} WHERE s.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(sub);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Subscriptie niet gevonden.' });

  const { errors, data } = validatePayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const merged = { ...existing, ...data };
  db.prepare(`
    UPDATE subscriptions SET
      client_id = @client_id,
      service = @service,
      price_per_month = @price_per_month,
      start_date = @start_date,
      next_invoice_date = @next_invoice_date,
      status = @status,
      updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);

  addActivity(`Subscriptie bijgewerkt: ${merged.service}`);
  const sub = db.prepare(`${SELECT_WITH_CLIENT} WHERE s.id = ?`).get(req.params.id);
  res.json(sub);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Subscriptie niet gevonden.' });

  db.prepare('DELETE FROM subscriptions WHERE id = ?').run(req.params.id);
  addActivity(`Subscriptie verwijderd: ${existing.service}`);
  res.json({ success: true });
});

module.exports = router;
