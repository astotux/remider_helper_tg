function mapReminderRow(row) {
  if (!row) return null;
  return {
    ...row,
    completion_enabled: Boolean(row.completion_enabled),
    stop_on_complete: Boolean(row.stop_on_complete),
    mentions_enabled: Boolean(row.mentions_enabled),
    is_active: Boolean(row.is_active),
    is_archived: Boolean(row.is_archived),
    schedule_data: JSON.parse(row.schedule_data),
    mentions_data: JSON.parse(row.mentions_data || '[]')
  };
}

export class ReminderRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        INSERT INTO reminders (
          owner_telegram_id, context_type, context_id,
          title, description, photo_file_id, link_title, link_url,
          completion_enabled, stop_on_complete, stop_mode, required_completions,
          mentions_enabled, mentions_data,
          schedule_type, schedule_data, timezone,
          series_id, series_ends_at, next_run_at,
          is_active, is_archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        Number(data.ownerTelegramId),
        data.contextType,
        Number(data.contextId),
        data.title,
        data.description ?? null,
        data.photoFileId ?? null,
        data.linkTitle ?? null,
        data.linkUrl ?? null,
        data.completionEnabled ? 1 : 0,
        data.stopOnComplete ? 1 : 0,
        data.stopMode || 'none',
        data.requiredCompletions ?? null,
        data.mentionsEnabled ? 1 : 0,
        JSON.stringify(data.mentionsData || []),
        data.scheduleType,
        JSON.stringify(data.scheduleData),
        data.timezone,
        data.seriesId ?? null,
        data.seriesEndsAt ?? null,
        data.nextRunAt ?? null,
        data.isActive !== false ? 1 : 0,
        now,
        now
      );

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(Number(id));
    return mapReminderRow(row);
  }

  listByContext(contextType, contextId, { includeArchived = false } = {}) {
    const sql = includeArchived
      ? `SELECT * FROM reminders WHERE context_type = ? AND context_id = ? ORDER BY is_active DESC, created_at DESC`
      : `SELECT * FROM reminders WHERE context_type = ? AND context_id = ? AND is_archived = 0 ORDER BY is_active DESC, created_at DESC`;
    return this.db.prepare(sql).all(contextType, Number(contextId)).map(mapReminderRow);
  }

  listActiveByContext(contextType, contextId) {
    return this.db
      .prepare(`
        SELECT * FROM reminders
        WHERE context_type = ? AND context_id = ? AND is_active = 1 AND is_archived = 0
        ORDER BY next_run_at ASC
      `)
      .all(contextType, Number(contextId))
      .map(mapReminderRow);
  }

  findDueReminders(nowIso, limit = 100) {
    return this.db
      .prepare(`
        SELECT * FROM reminders
        WHERE is_active = 1 AND is_archived = 0 AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC
        LIMIT ?
      `)
      .all(nowIso, limit)
      .map(mapReminderRow);
  }

  update(id, fields) {
    const allowedMap = {
      title: 'title',
      description: 'description',
      photoFileId: 'photo_file_id',
      linkTitle: 'link_title',
      linkUrl: 'link_url',
      completionEnabled: 'completion_enabled',
      stopOnComplete: 'stop_on_complete',
      stopMode: 'stop_mode',
      requiredCompletions: 'required_completions',
      mentionsEnabled: 'mentions_enabled',
      mentionsData: 'mentions_data',
      scheduleType: 'schedule_type',
      scheduleData: 'schedule_data',
      timezone: 'timezone',
      seriesId: 'series_id',
      seriesEndsAt: 'series_ends_at',
      nextRunAt: 'next_run_at',
      isActive: 'is_active',
      isArchived: 'is_archived'
    };

    const sets = [];
    const params = [];

    for (const [key, column] of Object.entries(allowedMap)) {
      if (!(key in fields)) continue;
      let val = fields[key];
      if (
        key === 'completionEnabled' ||
        key === 'stopOnComplete' ||
        key === 'mentionsEnabled' ||
        key === 'isActive' ||
        key === 'isArchived'
      ) {
        val = val ? 1 : 0;
      } else if (key === 'mentionsData') {
        val = JSON.stringify(val || []);
      } else if (key === 'scheduleData') {
        val = JSON.stringify(val);
      }
      sets.push(`${column} = ?`);
      params.push(val);
    }

    if (sets.length === 0) return this.findById(id);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(Number(id));

    this.db.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  delete(id) {
    const result = this.db.prepare('DELETE FROM reminders WHERE id = ?').run(Number(id));
    return result.changes > 0;
  }

  archiveAndDeactivate(id) {
    return this.update(id, { isActive: false, isArchived: true, nextRunAt: null });
  }

  deactivateByContext(contextType, contextId) {
    const now = new Date().toISOString();
    return this.db
      .prepare(`
        UPDATE reminders
        SET is_active = 0, updated_at = ?
        WHERE context_type = ? AND context_id = ? AND is_archived = 0
      `)
      .run(now, contextType, Number(contextId)).changes;
  }
}
