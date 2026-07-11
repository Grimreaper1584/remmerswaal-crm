// Express app wiring, split out from index.js (which owns process-level
// bootstrapping like dotenv/JWT_SECRET) so tests can require the app
// directly without opening a real port.
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const subscriptionRoutes = require('./routes/subscriptions');
const appointmentRoutes = require('./routes/appointments');
const dashboardRoutes = require('./routes/dashboard');
const financialRoutes = require('./routes/financial');
const userRoutes = require('./routes/users');

const app = express();

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

module.exports = app;
