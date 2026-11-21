import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/config.js';
import { createLogger } from '../utils/logger.js';
import { openDatabase, closeDatabase } from './db.js';
import * as m001 from './migrations/001_initial.js';
import * as m002 from './migrations/002_interval_series.js';

const MIGRATIONS = [m001, m002];

export function runMigrations(db, logger = null) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM migrations').all();
  const appliedIds = new Set(appliedRows.map((row) => row.id));

  const insertMigration = db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)');

  let count = 0;
  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    if (migration.disableForeignKeys) {
      db.pragma('foreign_keys = OFF');
    }

    try {
      const applyTx = db.transaction(() => {
        migration.up(db);
        insertMigration.run(migration.id, new Date().toISOString());
      });
      applyTx();
    } finally {
      if (migration.disableForeignKeys) {
        db.pragma('foreign_keys = ON');
      }
    }

    count += 1;
    logger?.info(`Применена миграция БД: ${migration.id}`);
  }

  return count;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = openDatabase(config.databasePath);
  try {
    const applied = runMigrations(db, logger);
    logger.info(`Миграции завершены. Применено новых: ${applied}`);
  } finally {
    closeDatabase(db);
  }
}
