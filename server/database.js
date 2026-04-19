const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'app.db');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');

const db = new sqlite3.Database(dbPath);

function initDb() {
  const schema = fs.readFileSync(schemaPath, 'utf8');

  db.exec(schema, (err) => {
    if (err) {
      console.error('DB init error:', err.message);
      return;
    }

    db.run(`ALTER TABLE users ADD COLUMN username TEXT`, [], () => {});
    db.run(`
      CREATE TABLE IF NOT EXISTS bot_pending_reasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        shift_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, [], () => {});
    db.run(`
      CREATE TABLE IF NOT EXISTS shift_notification_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_key TEXT UNIQUE NOT NULL,
        notification_type TEXT NOT NULL,
        shift_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        related_shift_id INTEGER,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, [], () => {});

    console.log('Database initialized');
  });
}

module.exports = { db, initDb };
