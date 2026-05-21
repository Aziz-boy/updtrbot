// state.js — shared in-memory + persisted state
const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'data', 'state.json');

function ensureDataDir() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  ensureDataDir();
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) {}
  }
  return {
    buffers:      {},
    activityLog:  [],
    sentToday:    0,
    filesToday:   0,
    errorsToday:  0,
    lastNudge:    {},
    startedAt:    new Date().toISOString()
  };
}

const state = loadState();

state.save = function() {
  ensureDataDir();
  const toSave = { ...state };
  delete toSave.save;
  fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
};

// Reset daily counters at midnight
function scheduleDailyReset() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  setTimeout(() => {
    state.sentToday   = 0;
    state.filesToday  = 0;
    state.errorsToday = 0;
    state.save();
    scheduleDailyReset();
  }, next - now);
}
scheduleDailyReset();

module.exports = { state };
