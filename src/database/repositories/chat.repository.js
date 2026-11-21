export class ChatRepository {
  constructor(db) {
    this.db = db;
  }

  findByTelegramId(telegramId) {
    return this.db
      .prepare('SELECT * FROM chats WHERE telegram_id = ?')
      .get(Number(telegramId)) || null;
  }

  upsert({ telegramId, type = 'group', title = null, isActive = true }) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO chats (telegram_id, type, title, timezone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `)
      .run(Number(telegramId), type, title, isActive ? 1 : 0, now, now);
    return this.findByTelegramId(telegramId);
  }

  setTimezone(telegramId, timezone) {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE chats SET timezone = ?, updated_at = ? WHERE telegram_id = ?')
      .run(timezone, now, Number(telegramId));
    return this.findByTelegramId(telegramId);
  }

  setActive(telegramId, isActive) {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE chats SET is_active = ?, updated_at = ? WHERE telegram_id = ?')
      .run(isActive ? 1 : 0, now, Number(telegramId));
  }

  migrateChatId(oldTelegramId, newTelegramId) {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const existingNew = this.findByTelegramId(newTelegramId);
      const existingOld = this.findByTelegramId(oldTelegramId);

      if (existingOld && !existingNew) {
        this.db
          .prepare('UPDATE chats SET telegram_id = ?, type = ?, updated_at = ? WHERE telegram_id = ?')
          .run(Number(newTelegramId), 'supergroup', now, Number(oldTelegramId));
      } else if (existingOld && existingNew) {
        this.db
          .prepare('UPDATE chats SET is_active = 0, updated_at = ? WHERE telegram_id = ?')
          .run(now, Number(oldTelegramId));
      }

      this.db
        .prepare(`
          UPDATE reminders
          SET context_id = ?, updated_at = ?
          WHERE context_type = 'group' AND context_id = ?
        `)
        .run(Number(newTelegramId), now, Number(oldTelegramId));

      this.db
        .prepare('UPDATE reminder_occurrences SET chat_id = ? WHERE chat_id = ?')
        .run(Number(newTelegramId), Number(oldTelegramId));

      this.db
        .prepare('UPDATE reminder_queue SET chat_id = ?, updated_at = ? WHERE chat_id = ?')
        .run(Number(newTelegramId), now, Number(oldTelegramId));

      this.db
        .prepare(`
          INSERT INTO chat_known_users (chat_telegram_id, user_telegram_id, username, first_name, last_name, last_seen_at)
          SELECT ?, user_telegram_id, username, first_name, last_name, last_seen_at
          FROM chat_known_users WHERE chat_telegram_id = ?
          ON CONFLICT(chat_telegram_id, user_telegram_id) DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            last_seen_at = excluded.last_seen_at
        `)
        .run(Number(newTelegramId), Number(oldTelegramId));

      this.db
        .prepare('DELETE FROM chat_known_users WHERE chat_telegram_id = ?')
        .run(Number(oldTelegramId));
    });

    tx();
  }

  recordKnownUser({ chatTelegramId, userTelegramId, username = null, firstName, lastName = null }) {
    if (!firstName) return;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO chat_known_users (chat_telegram_id, user_telegram_id, username, first_name, last_name, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_telegram_id, user_telegram_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          last_seen_at = excluded.last_seen_at
      `)
      .run(Number(chatTelegramId), Number(userTelegramId), username, firstName, lastName, now);
  }

  getKnownUsers(chatTelegramId, limit = 30) {
    return this.db
      .prepare(`
        SELECT user_telegram_id, username, first_name, last_name, last_seen_at
        FROM chat_known_users
        WHERE chat_telegram_id = ?
        ORDER BY last_seen_at DESC
        LIMIT ?
      `)
      .all(Number(chatTelegramId), limit);
  }
}
