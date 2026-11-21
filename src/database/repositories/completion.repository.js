export class CompletionRepository {
  constructor(db) {
    this.db = db;
  }

  findByOccurrenceAndUser(occurrenceId, userTelegramId) {
    return (
      this.db
        .prepare('SELECT * FROM reminder_completions WHERE occurrence_id = ? AND user_telegram_id = ?')
        .get(Number(occurrenceId), Number(userTelegramId)) || null
    );
  }

  addCompletion({ reminderId, occurrenceId, userTelegramId, username = null, firstName }) {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(`
        INSERT OR IGNORE INTO reminder_completions (
          reminder_id, occurrence_id, user_telegram_id, username, first_name, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(reminderId),
        Number(occurrenceId),
        Number(userTelegramId),
        username || null,
        firstName || 'Пользователь',
        now
      );

    return {
      inserted: res.changes > 0,
      record: this.findByOccurrenceAndUser(occurrenceId, userTelegramId)
    };
  }

  removeCompletion(occurrenceId, userTelegramId) {
    const res = this.db
      .prepare('DELETE FROM reminder_completions WHERE occurrence_id = ? AND user_telegram_id = ?')
      .run(Number(occurrenceId), Number(userTelegramId));
    return res.changes > 0;
  }

  listByOccurrence(occurrenceId) {
    return this.db
      .prepare(`
        SELECT * FROM reminder_completions
        WHERE occurrence_id = ?
        ORDER BY completed_at ASC, id ASC
      `)
      .all(Number(occurrenceId));
  }
}
