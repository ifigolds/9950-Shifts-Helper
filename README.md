# Render persistent disk setup

The backend uses SQLite, so production must mount persistent storage before relying on user data.

Recommended Render setup:
- attach a persistent disk at `/var/data`
- set `DB_STORAGE_DIR=/var/data/sqlite`
- set `DB_BACKUP_DIR=/var/data/sqlite-backups`
- set `REQUIRE_PERSISTENT_DB=true`

The repository already includes [render.yaml](C:/Users/ifigo/PyCharmMiscProject/9950-Shifts-Helper/render.yaml), which declares that disk and these environment variables for Blueprint-based deploys.

# Restore known users safely

After the persistent disk is attached and the service is redeployed, run:

```bash
npm run restore:known-users
```

The script is idempotent:
- it upserts users by `telegram_id`
- it marks the restored users as `approved`
- it does not create duplicates if you run it more than once
- it preserves an existing `admin` role if a matching record already exists

If you need to target a specific database path manually, you can override it:

```bash
DB_PATH=/absolute/path/to/app.db npm run restore:known-users
```
