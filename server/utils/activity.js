const db = require('../db');

const logActivity = db.prepare('INSERT INTO activity_log (message) VALUES (?)');

function addActivity(message) {
  logActivity.run(message);
}

module.exports = { addActivity };
