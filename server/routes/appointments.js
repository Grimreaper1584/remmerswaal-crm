const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addActivity } = require('../utils/activity');
const { APPOINTMENT_TYPES, isValidDate, isNonEmptyString } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

const SELECT_WITH_CLIENT = `
  SELECT a.*, c.company_name AS client_name
  FROM appointments a
  LEFT JOIN clients c ON c.id = a.client_id
`;

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (body.client_id !== undefined) {
    const clientId = body.client_id ? Number(body.client_id) : null;
    if (clientId && !db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) {
      errors.push('Ongeldige klant.');
    }
    data.client_id = clientId;
  }
  if (!partial || body.date !== undefined) {
    if (!isValidDate(body.date)) errors.push('Ongeldige datum.');
    data.date = body.date;
  }
  if (!partial || body.type !== undefined) {
    if (!APPOINTMENT_TYPES.includes(body.type)) errors.push('Ongeldig type afspraak.');
    data.type = body.type;
  }
  if (body.notes !== undefined) {
    data.notes = body.notes || null;
  }

  return { errors, data };
}

router.get('/', (req, res) => {
  const appts = db.prepare(`${SELECT_WITH_CLIENT} ORDER BY a.date ASC`).all();
  res.json(appts);
});

router.post('/', (req, res) => {
  const { errors, data } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  if (!isNonEmptyString(data.type) && !data.type) return res.status(400).json({ error: 'Type is verplicht.' });

  const info = db.prepare(`
    INSERT INTO appointments (client_id, date, type, notes)
    VALUES (@client_id, @date, @type, @notes)
  `).run({
    client_id: data.client_id || null,
    date: data.date,
    type: data.type,
    notes: data.notes || null,
  });

  addActivity(`Nieuwe afspraak gepland: ${data.type} op ${data.date}`);
  const appt = db.prepare(`${SELECT_WITH_CLIENT} WHERE a.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(appt);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Afspraak niet gevonden.' });

  const { errors, data } = validatePayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const merged = { ...existing, ...data };
  db.prepare(`
    UPDATE appointments SET
      client_id = @client_id,
      date = @date,
      type = @type,
      notes = @notes,
      updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);

  addActivity(`Afspraak bijgewerkt: ${merged.type} op ${merged.date}`);
  const appt = db.prepare(`${SELECT_WITH_CLIENT} WHERE a.id = ?`).get(req.params.id);
  res.json(appt);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Afspraak niet gevonden.' });

  db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  addActivity(`Afspraak verwijderd: ${existing.type} op ${existing.date}`);
  res.json({ success: true });
});

module.exports = router;
