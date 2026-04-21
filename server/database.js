const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_DIR = path.join(__dirname, 'db');
const dbDir = process.env.DB_STORAGE_DIR || DEFAULT_DB_DIR;
const dbPath = process.env.DB_PATH || path.join(dbDir, 'app.db');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');
const backupDir = process.env.DB_BACKUP_DIR || path.join(dbDir, 'backups');
const maxBackupFiles = Number(process.env.DB_BACKUP_LIMIT || 14);
const backupThrottleMs = Number(process.env.DB_BACKUP_THROTTLE_MS || 5 * 60 * 1000);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

let lastBackupAt = 0;
let pendingBackupTimer = null;

function formatBackupStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function pruneBackups() {
  const backupFiles = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.db'))
    .map((entry) => {
      const fullPath = path.join(backupDir, entry.name);
      const stats = fs.statSync(fullPath);

      return {
        fullPath,
        createdAt: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  backupFiles.slice(maxBackupFiles).forEach((file) => {
    fs.unlinkSync(file.fullPath);
  });
}

function createDbBackup(reason = 'manual') {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const stats = fs.statSync(dbPath);
  if (!stats.size) {
    return null;
  }

  const backupName = `app-${formatBackupStamp()}-${reason}.db`;
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(dbPath, backupPath);
  pruneBackups();

  return backupPath;
}

function runBackupNow(reason = 'write') {
  try {
    const backupPath = createDbBackup(reason);

    if (backupPath) {
      lastBackupAt = Date.now();
      console.log(`Database backup created: ${backupPath}`);
    }
  } catch (err) {
    console.error('Database backup error:', err.message);
  }
}

function scheduleDbBackup(reason = 'write') {
  if (!fs.existsSync(dbPath)) {
    return;
  }

  const elapsed = Date.now() - lastBackupAt;
  if (elapsed >= backupThrottleMs) {
    runBackupNow(reason);
    return;
  }

  if (pendingBackupTimer) {
    return;
  }

  const waitMs = Math.max(1000, backupThrottleMs - elapsed);
  pendingBackupTimer = setTimeout(() => {
    pendingBackupTimer = null;
    runBackupNow(reason);
  }, waitMs);
}

function logStorageWarning() {
  if (!process.env.RENDER) {
    return;
  }

  const normalizedDbPath = path.resolve(dbPath).replace(/\\/g, '/');
  const normalizedBackupDir = path.resolve(backupDir).replace(/\\/g, '/');
  const looksPersistent =
    normalizedDbPath.startsWith('/var/data/') ||
    normalizedBackupDir.startsWith('/var/data/');

  if (!looksPersistent) {
    console.warn(
      'Render detected without a persistent disk path for SQLite. ' +
      'Render local storage is ephemeral by default, so attach a persistent disk and set DB_STORAGE_DIR / DB_BACKUP_DIR. ' +
      'Docs: https://render.com/docs/disks'
    );
  }
}

createDbBackup('startup');
lastBackupAt = Date.now();
logStorageWarning();

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

    console.log(`Database initialized at ${dbPath}`);
    console.log(`Database backups directory: ${backupDir}`);
  });
}

module.exports = { db, initDb, createDbBackup, scheduleDbBackup, dbPath, backupDir };
