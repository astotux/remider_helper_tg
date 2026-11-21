export const id = '001_initial';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'group',
      title TEXT,
      timezone TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chats_telegram_id ON chats(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_chats_active ON chats(is_active);

    CREATE TABLE IF NOT EXISTS chat_known_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_telegram_id INTEGER NOT NULL,
      user_telegram_id INTEGER NOT NULL,
      username TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      last_seen_at TEXT NOT NULL,
      UNIQUE(chat_telegram_id, user_telegram_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_known_users_chat
      ON chat_known_users(chat_telegram_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS reminders (
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
      mentions_enabled INTEGER NOT NULL DEFAULT 0,
      mentions_data TEXT NOT NULL DEFAULT '[]',
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once', 'daily', 'weekly')),
      schedule_data TEXT NOT NULL,
      timezone TEXT NOT NULL,
      next_run_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_due
      ON reminders(is_active, is_archived, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_context
      ON reminders(context_type, context_id, is_archived, is_active);

    CREATE TABLE IF NOT EXISTS reminder_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
      sent_at TEXT,
      message_id INTEGER,
      has_photo INTEGER NOT NULL DEFAULT 0,
      rendered_text TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
      UNIQUE(reminder_id, scheduled_at)
    );

    CREATE INDEX IF NOT EXISTS idx_occurrences_reminder
      ON reminder_occurrences(reminder_id, scheduled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_occurrences_status
      ON reminder_occurrences(status);

    CREATE TABLE IF NOT EXISTS reminder_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurrence_id INTEGER NOT NULL UNIQUE,
      chat_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (occurrence_id) REFERENCES reminder_occurrences(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_queue_due
      ON reminder_queue(status, next_attempt_at, chat_id, id);

    CREATE TABLE IF NOT EXISTS reminder_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER NOT NULL,
      occurrence_id INTEGER NOT NULL,
      user_telegram_id INTEGER NOT NULL,
      username TEXT,
      first_name TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
      FOREIGN KEY (occurrence_id) REFERENCES reminder_occurrences(id) ON DELETE CASCADE,
      UNIQUE(occurrence_id, user_telegram_id)
    );

    CREATE INDEX IF NOT EXISTS idx_completions_occurrence
      ON reminder_completions(occurrence_id, completed_at ASC);

    CREATE TABLE IF NOT EXISTS fsm_sessions (
      session_key TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fsm_sessions_updated
      ON fsm_sessions(updated_at);
  `);
}
