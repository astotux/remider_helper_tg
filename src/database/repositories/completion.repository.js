export function buildCompletionSyncKey(occurrence) {
  if (occurrence?.series_id) {
    return `series:${occurrence.series_id}`;
  }
  return `occ:${occurrence.id}`;
}

export class CompletionRepository {
  constructor(db) {
    this.db = db;
  }

  findBySyncKeyAndUser(syncKey, userTelegramId) {
    return (
      this.db
        .prepare('SELECT * FROM reminder_completions WHERE sync_key = ? AND user_telegram_id = ?')
        .get(syncKey, Number(userTelegramId)) || null
    );
  }

  findByOccurrenceAndUser(occurrenceId, userTelegramId) {
    return this.findBySyncKeyAndUser(`occ:${Number(occurrenceId)}`, userTelegramId);
  }

  addCompletion({
    reminderId,
    occurrenceId,
    syncKey = `occ:${Number(occurrenceId)}`,
    userTelegramId,
    username = null,
    firstName
  }) {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(`
        INSERT OR IGNORE INTO reminder_completions (
          reminder_id, occurrence_id, sync_key, user_telegram_id, username, first_name, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(reminderId),
        Number(occurrenceId),
        syncKey,
        Number(userTelegramId),
        username || null,
        firstName || 'Пользователь',
        now
      );

    return {
      inserted: res.changes > 0,
      record: this.findBySyncKeyAndUser(syncKey, userTelegramId)
    };
  }

  removeCompletionBySyncKey(syncKey, userTelegramId) {
    const res = this.db
      .prepare('DELETE FROM reminder_completions WHERE sync_key = ? AND user_telegram_id = ?')
      .run(syncKey, Number(userTelegramId));
    return res.changes > 0;
  }

  removeCompletion(occurrenceId, userTelegramId) {
    return this.removeCompletionBySyncKey(`occ:${Number(occurrenceId)}`, userTelegramId);
  }

  listBySyncKey(syncKey) {
    return this.db
      .prepare(`
        SELECT * FROM reminder_completions
        WHERE sync_key = ?
        ORDER BY completed_at ASC, id ASC
      `)
      .all(syncKey);
  }

  listByOccurrence(occurrenceId) {
    return this.listBySyncKey(`occ:${Number(occurrenceId)}`);
  }
}
