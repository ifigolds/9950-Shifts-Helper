const { all, get, run, withTransaction } = require('./dbUtils');
const { KNOWN_RESTORE_USERS } = require('./knownUsers');

const UPSERT_USER_SQL = `
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

async function getKnownUsersSnapshot(users = KNOWN_RESTORE_USERS) {
  if (!users.length) {
    return [];
  }

  const placeholders = users.map(() => '?').join(',');
  return all(
    `
    SELECT
      id,
      telegram_id,
      username,
      first_name,
      last_name,
      phone,
      rank,
      service_type,
      role,
      registration_status
    FROM users
    WHERE telegram_id IN (${placeholders})
    ORDER BY last_name ASC, first_name ASC, id ASC
    `,
    users.map((user) => user.telegram_id)
  );
}

async function getUserTotals() {
  return get(
    `
    SELECT
      COUNT(*) AS total_users,
      SUM(CASE WHEN registration_status = 'approved' THEN 1 ELSE 0 END) AS approved_users
    FROM users
    `
  );
}

async function restoreKnownUsers(users = KNOWN_RESTORE_USERS) {
  await withTransaction(async () => {
    for (const user of users) {
      await run(
        UPSERT_USER_SQL,
        [
          user.telegram_id,
          user.username,
          user.first_name,
          user.last_name,
          user.phone,
          user.rank,
          user.service_type,
        ],
        { skipBackup: true }
      );
    }
  });

  const [restoredUsers, totals] = await Promise.all([
    getKnownUsersSnapshot(users),
    getUserTotals(),
  ]);

  return {
    restored_count: users.length,
    users: restoredUsers,
    totals,
  };
}

module.exports = {
  KNOWN_RESTORE_USERS,
  restoreKnownUsers,
  getKnownUsersSnapshot,
};
