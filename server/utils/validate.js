const CLIENT_STATUSES = ['Actief', 'Inactief', 'Prospect'];
const SERVICE_TYPES = ['Externe Scan', 'Security Audit', 'Retainer', 'KnowBe4'];
const SUBSCRIPTION_STATUSES = ['Actief', 'Gepauzeerd', 'Opgezegd'];
const APPOINTMENT_TYPES = ['Intake', 'Scan', 'Nabespreking', 'Factuur'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidDate(v) {
  return typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v));
}

function isValidEmail(v) {
  return !v || (typeof v === 'string' && EMAIL_RE.test(v));
}

function isValidNumber(v) {
  return typeof v === 'number' && !isNaN(v) && isFinite(v);
}

module.exports = {
  CLIENT_STATUSES,
  SERVICE_TYPES,
  SUBSCRIPTION_STATUSES,
  APPOINTMENT_TYPES,
  isNonEmptyString,
  isValidDate,
  isValidEmail,
  isValidNumber,
};
