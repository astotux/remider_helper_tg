export const id = '002_interval_series';
export const disableForeignKeys = true;

export function up(db) {
  // 1. Расширяем reminders: тип 'interval', настройки автоостановки и параметры серии
  db.exec(`
    CREATE TABLE reminders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_telegram_id INTEGER NOT NULL,
      context_type TEXT NOT NULL CHECK(context_type IN ('private', 'group')),
      context_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      photo_file_id TEXT,
      link_title TEXT,
      link_url TEXT,
      completion_enabled INTEGER NOT NULL DEFAULT 0,
      stop_on_complete INTEGER NOT NULL DEFAULT 0,
      stop_mode TEXT NOT NULL DEFAULT 'none' CHECK(stop_mode IN ('none', 'any_one', 'all_members', 'custom_count', 'mentioned')),
      required_completions INTEGER,
      mentions_enabled INTEGER NOT NULL DEFAULT 0,
      mentions_data TEXT NOT NULL DEFAULT '[]',
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once', 'daily', 'weekly', 'interval')),
      schedule_data TEXT NOT NULL,
      timezone TEXT NOT NULL,
      series_id TEXT,
      series_ends_at TEXT,
      next_run_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO reminders_new (
      id, owner_telegram_id, context_type, context_id,
      title, description, photo_file_id, link_title, link_url,
      completion_enabled, stop_on_complete, stop_mode, required_completions,
      mentions_enabled, mentions_data, schedule_type, schedule_data, timezone,
      series_id, series_ends_at, next_run_at, is_active, is_archived,
      created_at, updated_at
    )
    SELECT
      id, owner_telegram_id, context_type, context_id,
      title, description, photo_file_id, link_title, link_url,
      completion_enabled, 0, 'none', NULL,
      mentions_enabled, mentions_data, schedule_type, schedule_data, timezone,
      NULL, NULL, next_run_at, is_active, is_archived,
      created_at, updated_at
    FROM reminders;

    DROP TABLE reminders;
    ALTER TABLE reminders_new RENAME TO reminders;

    CREATE INDEX idx_reminders_due
      ON reminders(is_active, is_archived, next_run_at);
    CREATE INDEX idx_reminders_context
      ON reminders(context_type, context_id, is_archived, is_active);
  `);

  // 2. Добавляем series_id к reminder_occurrences для синхронизации сообщений одной серии
  db.exec(`
    ALTER TABLE reminder_occurrences ADD COLUMN series_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_occurrences_series
      ON reminder_occurrences(series_id, status, id);
  `);

  // 3. Перестраиваем reminder_completions с sync_key (общий ключ синхронизации: series:<id> или occ:<id>)
  db.exec(`
    CREATE TABLE reminder_completions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER NOT NULL,
      occurrence_id INTEGER NOT NULL,
      sync_key TEXT NOT NULL,
      user_telegram_id INTEGER NOT NULL,
      username TEXT,
      first_name TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
      FOREIGN KEY (occurrence_id) REFERENCES reminder_occurrences(id) ON DELETE CASCADE,
      UNIQUE(sync_key, user_telegram_id)
    );

    INSERT INTO reminder_completions_new (
      id, reminder_id, occurrence_id, sync_key, user_telegram_id, username, first_name, completed_at
    )
    SELECT
      id, reminder_id, occurrence_id, 'occ:' || occurrence_id, user_telegram_id, username, first_name, completed_at
    FROM reminder_completions;

    DROP TABLE reminder_completions;
    ALTER TABLE reminder_completions_new RENAME TO reminder_completions;

    CREATE INDEX idx_completions_sync_key
      ON reminder_completions(sync_key, completed_at ASC);
    CREATE INDEX idx_completions_occurrence
      ON reminder_completions(occurrence_id, completed_at ASC);
  `);
}
