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
const requirePersistentDb = String(process.env.REQUIRE_PERSISTENT_DB || '').toLowerCase() === 'true';

let lastBackupAt = 0;
let pendingBackupTimer = null;

function isPersistentStoragePath(targetPath) {
  const normalizedPath = path.resolve(targetPath).replace(/\\/g, '/');
  return normalizedPath.startsWith('/var/data/');
}

function getStorageDiagnostics() {
  const dbIsPersistent = isPersistentStoragePath(dbPath);
  const backupIsPersistent = isPersistentStoragePath(backupDir);
  return {
    dbIsPersistent,
    backupIsPersistent,
    fullyPersistent: dbIsPersistent && backupIsPersistent,
  };
}

function assertDurableStorageOrThrow() {
  if (!process.env.RENDER) {
    return;
  }

  const diagnostics = getStorageDiagnostics();

  if (diagnostics.fullyPersistent) {
    return;
  }

  const message =
    'Render persistent storage is not configured for SQLite. ' +
    'Set DB_STORAGE_DIR and DB_BACKUP_DIR to a persistent disk path under /var/data. ' +
    'By default, Render services use an ephemeral filesystem, so local SQLite data can be lost on restart or redeploy. ' +
    'Docs: https://render.com/docs/disks';

  if (requirePersistentDb) {
    throw new Error(message);
  }

  console.warn(message);
}

assertDurableStorageOrThrow();

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

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

function logStorageStatus() {
  const diagnostics = getStorageDiagnostics();
  const storageMode = process.env.RENDER
    ? (diagnostics.fullyPersistent ? 'render persistent disk' : 'render ephemeral filesystem')
    : 'local development';

  console.log(`Database initialized at ${dbPath}`);
  console.log(`Database backups directory: ${backupDir}`);
  console.log(`Database storage mode: ${storageMode}`);
  if (process.env.RENDER && !diagnostics.fullyPersistent) {
    console.warn(
      'WARNING: SQLite is running on Render without a persistent disk. ' +
      'This keeps the service online, but database files can still be lost on restart or redeploy.'
    );
  }
}

const db = new sqlite3.Database(dbPath);
db.run('PRAGMA foreign_keys = ON');

const migrations = [
  {
    id: '2026-04-22-add-users-username-column',
    statements: [
      `ALTER TABLE users ADD COLUMN username TEXT`,
    ],
  },
  {
    id: '2026-04-22-add-shift-metadata-columns',
    statements: [
      `ALTER TABLE shifts ADD COLUMN shift_type TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE shifts ADD COLUMN location TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    id: '2026-04-22-shifts-unique-import-index',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_shifts_lookup_identity
       ON shifts (shift_date, start_time, end_time, title, shift_type, location)`,
    ],
  },
  {
    id: '2026-04-22-create-shift-import-runs',
    statements: [
      `CREATE TABLE IF NOT EXISTS shift_import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        source_filename TEXT,
        total_rows INTEGER NOT NULL DEFAULT 0,
        valid_rows INTEGER NOT NULL DEFAULT 0,
        inserted_rows INTEGER NOT NULL DEFAULT 0,
        duplicate_rows INTEGER NOT NULL DEFAULT 0,
        skipped_rows INTEGER NOT NULL DEFAULT 0,
        invalid_rows INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'preview',
        details_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_user_id) REFERENCES users(id)
      )`,
    ],
  },
  {
    id: '2026-04-27-unique-shift-assignments',
    statements: [
      `DELETE FROM shift_assignments
       WHERE id NOT IN (
         SELECT id
         FROM (
           SELECT
             id,
             ROW_NUMBER() OVER (
               PARTITION BY shift_id, user_id
               ORDER BY
                 responded_at IS NOT NULL DESC,
                 responded_at DESC,
                 CASE status
                   WHEN 'yes' THEN 0
                   WHEN 'maybe' THEN 1
                   WHEN 'no' THEN 2
                   ELSE 3
                 END,
                 id ASC
             ) AS duplicate_rank
           FROM shift_assignments
         )
         WHERE duplicate_rank = 1
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignments_shift_user
      ON shift_assignments (shift_id, user_id)`,
    ],
  },
  {
    id: '2026-04-27-add-users-favorite-color-column',
    statements: [
      `ALTER TABLE users ADD COLUMN favorite_color TEXT DEFAULT ''`,
    ],
  },
  {
    id: '2026-04-27-add-arrival-confirmation-column',
    statements: [
      `ALTER TABLE shift_assignments ADD COLUMN arrival_confirmed_at DATETIME`,
    ],
  },
  {
    id: '2026-04-27-extend-notification-log',
    statements: [
      `ALTER TABLE shift_notification_log ADD COLUMN recipient_telegram_id TEXT`,
      `ALTER TABLE shift_notification_log ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'sent'`,
      `ALTER TABLE shift_notification_log ADD COLUMN error_message TEXT`,
      `ALTER TABLE shift_notification_log ADD COLUMN clicked_at DATETIME`,
    ],
  },
  {
    id: '2026-04-27-fix-liad-display-name',
    statements: [
      `UPDATE users
       SET first_name = 'ליעד מסינגיסר',
           last_name = '',
           updated_at = CURRENT_TIMESTAMP
       WHERE first_name = 'ליעד מסינגיסר'
         AND last_name = 'מסינגיסר'`,
    ],
  },
];

function runStatement(statement) {
  return new Promise((resolve, reject) => {
    db.run(statement, [], (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function isIgnorableMigrationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('duplicate column name') ||
    message.includes('already exists')
  );
}

function runMigration(migration) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM schema_migrations WHERE id = ?`,
      [migration.id],
      async (selectErr, row) => {
        if (selectErr) {
          reject(selectErr);
          return;
        }

        if (row) {
          resolve();
          return;
        }

        try {
          for (const statement of migration.statements) {
            try {
              await runStatement(statement);
            } catch (statementErr) {
              if (!isIgnorableMigrationError(statementErr)) {
                throw statementErr;
              }
            }
          }

          await runStatement(
            `INSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', CURRENT_TIMESTAMP)`
          );

          resolve();
        } catch (migrationErr) {
          reject(migrationErr);
        }
      }
    );
  });
}

async function applyMigrations() {
  await runStatement(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const migration of migrations) {
    await runMigration(migration);
  }
}

function initDb() {
  const schema = fs.readFileSync(schemaPath, 'utf8');

  db.serialize(() => {
    db.exec(schema, async (err) => {
      if (err) {
        console.error('DB init error:', err.message);
        return;
      }

      try {
        await applyMigrations();
        createDbBackup('startup');
        lastBackupAt = Date.now();
        logStorageStatus();
      } catch (migrationErr) {
        console.error('DB migration error:', migrationErr.message);
        process.exitCode = 1;
        throw migrationErr;
      }
    });
  });
}

module.exports = {
  db,
  initDb,
  createDbBackup,
  scheduleDbBackup,
  dbPath,
  backupDir,
  isPersistentStoragePath,
};
