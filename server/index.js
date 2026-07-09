require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

if (!process.env.JWT_SECRET) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, '.jwt_secret');
  if (fs.existsSync(secretFile)) {
    process.env.JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    process.env.JWT_SECRET = generated;
  }
}

if (!process.env.INTERNAL_API_KEY) {
  console.warn('INTERNAL_API_KEY is niet ingesteld — de interne API (/api/internal/*) staat op slot totdat dit gezet wordt.');
}

const app = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Remmerswaal Security CRM draait op poort ${PORT}`);
});
