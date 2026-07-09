const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addActivity } = require('../utils/activity');
const { isNonEmptyString } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC').all();
  res.json(users);
});

router.post('/', (req, res) => {
  const { username, password, name } = req.body || {};

  if (!isNonEmptyString(username) || !isNonEmptyString(password) || !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Gebruikersnaam, wachtwoord en naam zijn verplicht.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens bevatten.' });
  }

  const uname = username.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (existing) return res.status(400).json({ error: 'Gebruikersnaam bestaat al.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(uname, hash, name.trim(), 'admin');

  addActivity(`Nieuwe gebruiker toegevoegd: ${name.trim()}`);
  const user = db.prepare('SELECT id, username, name, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(user);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  const { name, password } = req.body || {};
  const updates = {};

  if (name !== undefined) {
    if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Naam mag niet leeg zijn.' });
    updates.name = name.trim();
  }
  if (password !== undefined) {
    if (password.length < 8) return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens bevatten.' });
    updates.password_hash = bcrypt.hashSync(password, 10);
  }

  const merged = { ...existing, ...updates };
  db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(
    merged.name, merged.password_hash, req.params.id
  );

  addActivity(`Gebruiker bijgewerkt: ${merged.name}`);
  const user = db.prepare('SELECT id, username, name, role, created_at FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount <= 1) return res.status(400).json({ error: 'Kan de laatste gebruiker niet verwijderen.' });
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Je kunt je eigen account niet verwijderen.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  addActivity(`Gebruiker verwijderd: ${existing.name}`);
  res.json({ success: true });
});

module.exports = router;
