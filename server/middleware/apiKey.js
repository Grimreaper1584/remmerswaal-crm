const crypto = require('crypto');

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Guards the internal (machine-to-machine) API. Fails closed: if the
// operator forgets to set INTERNAL_API_KEY, every internal route returns
// 500 rather than silently accepting unauthenticated requests.
function requireApiKey(req, res, next) {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey) {
    console.error('INTERNAL_API_KEY is niet ingesteld — interne API is uitgeschakeld.');
    return res.status(500).json({ error: 'Interne API is niet geconfigureerd.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || !safeCompare(token, configuredKey)) {
    return res.status(401).json({ error: 'Ongeldige of ontbrekende API-key.' });
  }

  next();
}

module.exports = { requireApiKey };
