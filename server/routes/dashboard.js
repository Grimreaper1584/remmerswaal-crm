const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getCurrentMRR, getOneTimeRevenueForMonth, getYearOverview } = require('../utils/finance');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();

  const activeClients = db.prepare(`SELECT COUNT(*) AS c FROM clients WHERE status = 'Actief'`).get().c;
  const activeSubscriptions = db.prepare(`SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'Actief'`).get().c;

  const mrr = getCurrentMRR();
  const oneTimeThisMonth = getOneTimeRevenueForMonth(year, monthIndex);
  const revenueThisMonth = mrr + oneTimeThisMonth;

  const yearOverview = getYearOverview(year);
  const revenueThisYear = yearOverview
    .filter((m) => m.month - 1 <= monthIndex)
    .reduce((sum, m) => sum + m.total, 0);

  const recentActivity = db.prepare(
    'SELECT id, message, created_at FROM activity_log ORDER BY id DESC LIMIT 12'
  ).all();

  const upcomingAppointments = db.prepare(`
    SELECT a.id, a.date, a.type, c.company_name AS client_name
    FROM appointments a LEFT JOIN clients c ON c.id = a.client_id
    WHERE a.date >= date('now')
    ORDER BY a.date ASC LIMIT 5
  `).all();

  res.json({
    mrr,
    activeClients,
    activeSubscriptions,
    revenueThisMonth,
    revenueThisYear,
    recentActivity,
    upcomingAppointments,
  });
});

module.exports = router;
