import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { dbPath } = require('../server/database');
const { KNOWN_RESTORE_USERS, restoreKnownUsers } = require('../server/userRestore');

async function main() {
  const result = await restoreKnownUsers(KNOWN_RESTORE_USERS);
  console.log(`Restored ${result.restored_count} known users into ${dbPath}`);
  console.log(`Current totals: ${result.totals.total_users} users, ${result.totals.approved_users} approved`);
}

main().catch((error) => {
  console.error('User restore failed:', error.message);
  process.exitCode = 1;
});
