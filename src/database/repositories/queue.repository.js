export class QueueRepository {
  constructor(db) {
    this.db = db;
  }

  enqueue({ occurrenceId, chatId, nextAttemptAt = new Date().toISOString() }) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT OR IGNORE INTO reminder_queue (
          occurrence_id, chat_id, status, attempts, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, 'pending', 0, ?, ?, ?)
      `)
      .run(Number(occurrenceId), Number(chatId), nextAttemptAt, now, now);

    return this.db
      .prepare('SELECT * FROM reminder_queue WHERE occurrence_id = ?')
      .get(Number(occurrenceId));
  }

  /**
   * Восстанавливает зависшие в статусе 'processing' элементы после падения процесса.
   * Если сообщение уже имеет message_id в occurrences, помечает его отправленным, иначе возвращает в 'pending'.
   */
  recoverStaleProcessing() {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const alreadySent = this.db
        .prepare(`
          UPDATE reminder_queue
          SET status = 'sent', updated_at = ?
          WHERE status = 'processing'
            AND occurrence_id IN (SELECT id FROM reminder_occurrences WHERE message_id IS NOT NULL)
        `)
        .run(now).changes;

      const resetCount = this.db
        .prepare(`
          UPDATE reminder_queue
          SET status = 'pending', updated_at = ?
          WHERE status = 'processing'
        `)
        .run(now).changes;

      this.db
        .prepare(`
          UPDATE reminder_occurrences
          SET status = 'queued'
          WHERE status = 'sending' AND message_id IS NULL
        `)
        .run();

      return { alreadySent, resetCount };
    });

    return tx();
  }

  findDuePending(nowIso, limit = 50) {
    return this.db
      .prepare(`
        SELECT q.*
        FROM reminder_queue q
        JOIN reminder_occurrences o ON o.id = q.occurrence_id
        WHERE q.status = 'pending'
          AND q.next_attempt_at <= ?
          AND o.status IN ('pending', 'queued', 'sending')
        ORDER BY q.next_attempt_at ASC, q.id ASC
        LIMIT ?
      `)
      .all(nowIso, limit);
  }

  claimItem(id) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        UPDATE reminder_queue
        SET status = 'processing', attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(now, Number(id));
    if (result.changes === 0) return null;
    return this.db.prepare('SELECT * FROM reminder_queue WHERE id = ?').get(Number(id));
  }

  markSent(id) {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE reminder_queue SET status = 'sent', last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(now, Number(id));
  }

  scheduleRetry(id, nextAttemptAt, errorMessage) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE reminder_queue
        SET status = 'pending', next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(nextAttemptAt, errorMessage || null, now, Number(id));
  }

  markFailed(id, errorMessage) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE reminder_queue
        SET status = 'failed', last_error = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(errorMessage || null, now, Number(id));
  }

  cancelByChat(chatId) {
    const now = new Date().toISOString();
    return this.db
      .prepare(`
        UPDATE reminder_queue
        SET status = 'failed', last_error = 'Чат деактивирован', updated_at = ?
        WHERE chat_id = ? AND status IN ('pending', 'processing')
      `)
      .run(now, Number(chatId)).changes;
  }

  cancelByReminder(reminderId) {
    const now = new Date().toISOString();
    return this.db
      .prepare(`
        UPDATE reminder_queue
        SET status = 'failed', last_error = 'Напоминание отменено', updated_at = ?
        WHERE status = 'pending'
          AND occurrence_id IN (SELECT id FROM reminder_occurrences WHERE reminder_id = ?)
      `)
      .run(now, Number(reminderId)).changes;
  }
}
