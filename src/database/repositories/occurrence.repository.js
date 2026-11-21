export class OccurrenceRepository {
  constructor(db) {
    this.db = db;
  }

  createOrGet({ reminderId, chatId, scheduledAt, status = 'queued' }) {
    const now = new Date().toISOString();
    const insertResult = this.db
      .prepare(`
        INSERT OR IGNORE INTO reminder_occurrences (
          reminder_id, chat_id, scheduled_at, status, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(Number(reminderId), Number(chatId), scheduledAt, status, now);

    const row = this.db
      .prepare('SELECT * FROM reminder_occurrences WHERE reminder_id = ? AND scheduled_at = ?')
      .get(Number(reminderId), scheduledAt);

    return {
      occurrence: row,
      created: insertResult.changes > 0
    };
  }

  findById(id) {
    return (
      this.db.prepare('SELECT * FROM reminder_occurrences WHERE id = ?').get(Number(id)) || null
    );
  }

  findWithReminder(id) {
    const row = this.db
      .prepare(`
        SELECT
          o.*,
          r.title AS r_title,
          r.description AS r_description,
          r.photo_file_id AS r_photo_file_id,
          r.link_title AS r_link_title,
          r.link_url AS r_link_url,
          r.completion_enabled AS r_completion_enabled,
          r.mentions_enabled AS r_mentions_enabled,
          r.mentions_data AS r_mentions_data,
          r.context_type AS r_context_type,
          r.context_id AS r_context_id,
          r.schedule_type AS r_schedule_type
        FROM reminder_occurrences o
        JOIN reminders r ON r.id = o.reminder_id
        WHERE o.id = ?
      `)
      .get(Number(id));

    if (!row) return null;
    return {
      occurrence: {
        id: row.id,
        reminder_id: row.reminder_id,
        chat_id: row.chat_id,
        scheduled_at: row.scheduled_at,
        status: row.status,
        sent_at: row.sent_at,
        message_id: row.message_id,
        has_photo: Boolean(row.has_photo),
        rendered_text: row.rendered_text,
        error_message: row.error_message,
        created_at: row.created_at
      },
      reminder: {
        id: row.reminder_id,
        title: row.r_title,
        description: row.r_description,
        photo_file_id: row.r_photo_file_id,
        link_title: row.r_link_title,
        link_url: row.r_link_url,
        completion_enabled: Boolean(row.r_completion_enabled),
        mentions_enabled: Boolean(row.r_mentions_enabled),
        mentions_data: JSON.parse(row.r_mentions_data || '[]'),
        context_type: row.r_context_type,
        context_id: row.r_context_id,
        schedule_type: row.r_schedule_type
      }
    };
  }

  markSending(id) {
    this.db
      .prepare(`UPDATE reminder_occurrences SET status = 'sending' WHERE id = ?`)
      .run(Number(id));
  }

  markSent(id, { messageId, hasPhoto, renderedText }) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE reminder_occurrences
        SET status = 'sent', sent_at = ?, message_id = ?, has_photo = ?, rendered_text = ?, error_message = NULL
        WHERE id = ?
      `)
      .run(now, messageId ?? null, hasPhoto ? 1 : 0, renderedText ?? null, Number(id));
  }

  markFailed(id, errorMessage) {
    this.db
      .prepare(`UPDATE reminder_occurrences SET status = 'failed', error_message = ? WHERE id = ?`)
      .run(errorMessage || null, Number(id));
  }

  cancelPendingByReminder(reminderId) {
    return this.db
      .prepare(`
        UPDATE reminder_occurrences
        SET status = 'cancelled'
        WHERE reminder_id = ? AND status IN ('pending', 'queued')
      `)
      .run(Number(reminderId)).changes;
  }

  cancelPendingByChat(chatId) {
    return this.db
      .prepare(`
        UPDATE reminder_occurrences
        SET status = 'cancelled'
        WHERE chat_id = ? AND status IN ('pending', 'queued')
      `)
      .run(Number(chatId)).changes;
  }
}
