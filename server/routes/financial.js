const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addActivity } = require('../utils/activity');
const { isValidDate, isValidNumber, isNonEmptyString } = require('../utils/validate');
const {
  getCurrentMRR,
  getOneTimeRevenueForMonth,
  getYearOverview,
  getRevenuePerServiceType,
} = require('../utils/finance');

const router = express.Router();
router.use(requireAuth);

router.get('/overview', (req, res) => {
  const now = new Date();
  const year = req.query.year ? parseInt(req.query.year, 10) : now.getFullYear();
  const monthIndex = now.getMonth();

  const mrr = getCurrentMRR();
  const oneTimeThisMonth = getOneTimeRevenueForMonth(year, monthIndex);

  const perClient = db.prepare(`
    SELECT id, company_name, service_type, monthly_value
    FROM clients WHERE status = 'Actief' AND monthly_value > 0
    ORDER BY monthly_value DESC
  `).all();

  const revenuePerServiceType = getRevenuePerServiceType();
  const yearOverview = getYearOverview(year);

  const payments = db.prepare(`
    SELECT p.*, c.company_name AS client_name
    FROM payments p LEFT JOIN clients c ON c.id = p.client_id
    ORDER BY p.date DESC LIMIT 50
  `).all();

  res.json({
    year,
    mrr,
    oneTimeThisMonth,
    perClient,
    revenuePerServiceType,
    yearOverview,
    payments,
  });
});

router.post('/payments', (req, res) => {
  const { client_id, amount, description, date } = req.body || {};
  const errors = [];

  const amountNum = Number(amount);
  if (!isValidNumber(amountNum) || amountNum <= 0) errors.push('Bedrag moet een positief getal zijn.');
  if (!isValidDate(date)) errors.push('Ongeldige datum.');
  if (client_id && !db.prepare('SELECT id FROM clients WHERE id = ?').get(client_id)) {
    errors.push('Ongeldige klant.');
  }
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const info = db.prepare(`
    INSERT INTO payments (client_id, amount, description, date)
    VALUES (?, ?, ?, ?)
  `).run(client_id || null, amountNum, description || null, date);

  addActivity(`Eenmalige betaling geregistreerd: €${amountNum.toFixed(2)}`);
  const payment = db.prepare(`
    SELECT p.*, c.company_name AS client_name
    FROM payments p LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(payment);
});

router.delete('/payments/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Betaling niet gevonden.' });

  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  addActivity(`Eenmalige betaling verwijderd: €${existing.amount.toFixed(2)}`);
  res.json({ success: true });
});

module.exports = router;
