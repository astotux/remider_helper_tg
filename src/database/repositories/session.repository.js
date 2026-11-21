export class SessionRepository {
  constructor(db) {
    this.db = db;
  }

  get(sessionKey) {
    const row = this.db
      .prepare('SELECT * FROM fsm_sessions WHERE session_key = ?')
      .get(sessionKey);
    if (!row) return null;
    return {
      sessionKey: row.session_key,
      state: row.state,
      data: JSON.parse(row.data || '{}'),
      updatedAt: row.updated_at
    };
  }

  set(sessionKey, state, data = {}) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO fsm_sessions (session_key, state, data, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
          state = excluded.state,
          data = excluded.data,
          updated_at = excluded.updated_at
      `)
      .run(sessionKey, state, JSON.stringify(data), now);
    return { sessionKey, state, data, updatedAt: now };
  }

  delete(sessionKey) {
    this.db.prepare('DELETE FROM fsm_sessions WHERE session_key = ?').run(sessionKey);
  }

  cleanupOlderThan(isoCutoff) {
    return this.db
      .prepare('DELETE FROM fsm_sessions WHERE updated_at < ?')
      .run(isoCutoff).changes;
  }
}
