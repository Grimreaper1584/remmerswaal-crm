const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString } = require('../utils/validate');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord.' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord.' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });
  res.json(user);
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
    return res.status(400).json({ error: 'Huidig en nieuw wachtwoord zijn verplicht.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Nieuw wachtwoord moet minimaal 8 tekens bevatten.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Huidig wachtwoord is onjuist.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

  res.json({ success: true });
});

module.exports = router;
