const db = require('../db');

const MONTH_NAMES_NL = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];

function monthBounds(year, monthIndex) {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Current total monthly recurring revenue: sum of monthly_value for active clients.
function getCurrentMRR() {
  const row = db.prepare(
    `SELECT COALESCE(SUM(monthly_value), 0) AS mrr FROM clients WHERE status = 'Actief'`
  ).get();
  return row.mrr;
}

// Recurring revenue attributable to a given month: active clients that already existed
// (date_added on or before the end of that month) at their current monthly_value.
function getRecurringRevenueForMonth(year, monthIndex) {
  const { end } = monthBounds(year, monthIndex);
  const row = db.prepare(
    `SELECT COALESCE(SUM(monthly_value), 0) AS total FROM clients
     WHERE status = 'Actief' AND date_added <= ?`
  ).get(end);
  return row.total;
}

function getOneTimeRevenueForMonth(year, monthIndex) {
  const { start, end } = monthBounds(year, monthIndex);
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date >= ? AND date <= ?`
  ).get(start, end);
  return row.total;
}

function getYearOverview(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const recurring = getRecurringRevenueForMonth(year, m);
    const oneTime = getOneTimeRevenueForMonth(year, m);
    months.push({
      month: m + 1,
      monthName: MONTH_NAMES_NL[m],
      recurring,
      oneTime,
      total: recurring + oneTime,
    });
  }
  return months;
}

function getRevenuePerServiceType() {
  const rows = db.prepare(
    `SELECT service_type, COALESCE(SUM(monthly_value), 0) AS total, COUNT(*) AS count
     FROM clients WHERE status = 'Actief' AND service_type IS NOT NULL
     GROUP BY service_type`
  ).all();
  return rows;
}

module.exports = {
  MONTH_NAMES_NL,
  monthBounds,
  getCurrentMRR,
  getRecurringRevenueForMonth,
  getOneTimeRevenueForMonth,
  getYearOverview,
  getRevenuePerServiceType,
};
