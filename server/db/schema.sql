CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    rank TEXT,
    service_type TEXT,
    favorite_color TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    registration_status TEXT DEFAULT 'not_registered',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    shift_type TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shift_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    responded_at DATETIME,
    arrival_confirmed_at DATETIME,
    comment TEXT,
    FOREIGN KEY (shift_id) REFERENCES shifts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS registration_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    step TEXT NOT NULL,
    temp_first_name TEXT,
    temp_last_name TEXT,
    temp_phone TEXT,
    temp_rank TEXT,
    temp_service_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_pending_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    shift_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shift_notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_key TEXT UNIQUE NOT NULL,
    notification_type TEXT NOT NULL,
    shift_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    related_shift_id INTEGER,
    recipient_telegram_id TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'sent',
    error_message TEXT,
    clicked_at DATETIME,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shift_import_runs (
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
);
