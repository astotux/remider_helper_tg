export class UserRepository {
  constructor(db) {
    this.db = db;
  }

  findByTelegramId(telegramId) {
    return this.db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(Number(telegramId)) || null;
  }

  upsert({ telegramId, username = null, firstName = null, lastName = null }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = excluded.updated_at
    `);
    stmt.run(Number(telegramId), username, firstName, lastName, now, now);
    return this.findByTelegramId(telegramId);
  }

  setTimezone(telegramId, timezone) {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET timezone = ?, updated_at = ? WHERE telegram_id = ?')
      .run(timezone, now, Number(telegramId));
    return this.findByTelegramId(telegramId);
  }
}
