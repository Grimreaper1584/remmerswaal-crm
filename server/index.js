require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const fs = require('fs');
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

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const subscriptionRoutes = require('./routes/subscriptions');
const appointmentRoutes = require('./routes/appointments');
const dashboardRoutes = require('./routes/dashboard');
const financialRoutes = require('./routes/financial');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/financial', financialRoutes);
app.use('/api/users', userRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/*', (req, res) => {
  res.status(404).json({ error: 'Niet gevonden.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Interne serverfout.' });
});

app.listen(PORT, () => {
  console.log(`Remmerswaal Security CRM draait op poort ${PORT}`);
});
