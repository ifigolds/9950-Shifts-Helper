import path from 'path';
import sqlite3 from 'sqlite3';

const DEFAULT_DB_DIR = path.join(process.cwd(), 'server', 'db');
const dbDir = process.env.DB_STORAGE_DIR || DEFAULT_DB_DIR;
const dbPath = process.env.DB_PATH || path.join(dbDir, 'app.db');

const USERS_TO_RESTORE = [
  {
    telegram_id: '7846108712',
    username: null,
    first_name: '\u05d0\u05e8\u05d9\u05d0\u05dc',
    last_name: '\u05d5\u05d5\u05dc\u05d4\u05e0\u05d3\u05dc\u05e8',
    phone: '0584814000',
    rank: '\u05e8\u05d1\"\u05d8',
    service_type: '\u05d7\u05d5\u05d1\u05d4',
  },
  {
    telegram_id: '7091468858',
    username: null,
    first_name: '\u05d0\u05dc\u05d5\u05df',
    last_name: '\u05d3\u05d5\u05d3\u05d9\u05d0\u05df',
    phone: '0506878770',
    rank: '\u05e1\u05d2\u05df',
    service_type: '\u05e7\u05d1\u05e2',
  },
  {
    telegram_id: '835081178',
    username: 'omer147147',
    first_name: '\u05e2\u05d5\u05de\u05e8',
    last_name: '\u05d1\u05d5\u05d1\u05dc\u05d9\u05dc',
    phone: '0543971237',
    rank: '\u05e8\u05e1\"\u05dc',
    service_type: '\u05de\u05d9\u05dc\u05d5\u05d0\u05d9\u05dd',
  },
  {
    telegram_id: '1719935893',
    username: null,
    first_name: '\u05dc\u05d9\u05e8\u05d5\u05df',
    last_name: '\u05e9\u05e9\u05d5\u05df',
    phone: '0543086363',
    rank: '\u05e8\u05d1\"\u05d8',
    service_type: '\u05d7\u05d5\u05d1\u05d4',
  },
  {
    telegram_id: '1011952234',
    username: 'liadd8',
    first_name: '\u05dc\u05d9\u05e2\u05d3 \u05de\u05e1\u05d9\u05e0\u05d2\u05d9\u05e1\u05e8',
    last_name: '\u05de\u05e1\u05d9\u05e0\u05d2\u05d9\u05e1\u05e8',
    phone: '0526705744',
    rank: '\u05e8\u05d1\"\u05d8',
    service_type: '\u05d7\u05d5\u05d1\u05d4',
  },
  {
    telegram_id: '8772939117',
    username: null,
    first_name: '\u05e9\u05d2\u05d9\u05d0',
    last_name: '\u05db\u05d7\u05dc\u05d5\u05df',
    phone: '0547199878',
    rank: '\u05e8\u05d1\"\u05d8',
    service_type: '\u05d7\u05d5\u05d1\u05d4',
  },
  {
    telegram_id: '325368848',
    username: 'Koz36',
    first_name: 'Omer',
    last_name: 'Sela',
    phone: '0525851222',
    rank: '\u05e8\u05d1-\u05e1\u05e8\u05df',
    service_type: '\u05de\u05d9\u05dc\u05d5\u05d0\u05d9\u05dd',
  },
  {
    telegram_id: '8741961213',
    username: null,
    first_name: '\u05de\u05d9\u05d4',
    last_name: '\u05de\u05df',
    phone: '0587802028',
    rank: '\u05e8\u05d1\"\u05d8',
    service_type: '\u05d7\u05d5\u05d1\u05d4',
  },
  {
    telegram_id: '5862540060',
    username: null,
    first_name: '\u05d8\u05dc\u05d9\u05d4',
    last_name: '\u05e2\u05d6\u05e8\u05df',
    phone: '0586991044',
    rank: '\u05e8\u05d1\"\u05d8',
    service_type: '\u05d7\u05d5\u05d1\u05d4',
  },
];

const UPSERT_SQL = `
  INSERT INTO users (
    telegram_id,
    username,
    first_name,
    last_name,
    phone,
    rank,
    service_type,
    role,
    registration_status,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT(telegram_id) DO UPDATE SET
    username = COALESCE(excluded.username, users.username),
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    phone = excluded.phone,
    rank = excluded.rank,
    service_type = excluded.service_type,
    role = CASE WHEN users.role = 'admin' THEN users.role ELSE 'user' END,
    registration_status = 'approved',
    updated_at = CURRENT_TIMESTAMP
`;

function openDatabase(targetPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(targetPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

async function main() {
  const db = await openDatabase(dbPath);

  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION');

    for (const user of USERS_TO_RESTORE) {
      await run(db, UPSERT_SQL, [
        user.telegram_id,
        user.username,
        user.first_name,
        user.last_name,
        user.phone,
        user.rank,
        user.service_type,
      ]);
    }

    await run(db, 'COMMIT');

    const totals = await get(
      db,
      `SELECT
         COUNT(*) AS total_users,
         SUM(CASE WHEN registration_status = 'approved' THEN 1 ELSE 0 END) AS approved_users
       FROM users`
    );

    console.log(`Restored ${USERS_TO_RESTORE.length} known users into ${dbPath}`);
    console.log(`Current totals: ${totals.total_users} users, ${totals.approved_users} approved`);
  } catch (error) {
    try {
      await run(db, 'ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError.message);
    }

    throw error;
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

main().catch((error) => {
  console.error('User restore failed:', error.message);
  process.exitCode = 1;
});
