// index.js
require('./bot');
require('./server');

// Keep-alive ping for Render free tier
const https = require('https');
const RENDER_URL = process.env.RENDER_URL || '';
if (RENDER_URL) {
  setInterval(() => {
    https.get(`${RENDER_URL}/api/health`, (res) => {
      console.log('Keep-alive:', res.statusCode);
    }).on('error', (e) => {
      console.error('Keep-alive error:', e.message);
    });
  }, 10 * 60 * 1000);
}