// server.js — REST API for admin dashboard
require('dotenv').config();
const express = require('express');
const path    = require('path');
const { state } = require('./state');

const app  = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'rais2024';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  const auth = req.headers['x-dashboard-token'] || req.query.token;
  if (auth === DASHBOARD_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    online:       true,
    sentToday:    state.sentToday,
    filesToday:   state.filesToday,
    errorsToday:  state.errorsToday,
    activeBuffers: [],
    startedAt:    state.startedAt,
    uptime:       Math.round(process.uptime())
  });
});

app.get('/api/log', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ log: state.activityLog.slice(0, limit) });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
