const { db, scheduleDbBackup } = require('./database');

function run(sql, params = [], options = {}) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else {
        if (!options.skipBackup) {
          scheduleDbBackup('write');
        }
        resolve(this);
      }
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function withTransaction(work) {
  await run('BEGIN IMMEDIATE TRANSACTION', [], { skipBackup: true });

  try {
    const result = await work();
    await run('COMMIT', [], { skipBackup: true });
    return result;
  } catch (err) {
    try {
      await run('ROLLBACK', [], { skipBackup: true });
    } catch (rollbackErr) {
      console.error('Transaction rollback error:', rollbackErr.message);
    }

    throw err;
  }
}

module.exports = { run, get, all, withTransaction };
