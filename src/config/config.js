import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };

  const config = {
    botToken: (env.BOT_TOKEN || '').trim(),
    databasePath: path.resolve(env.DATABASE_PATH || './data/bot.sqlite'),
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
    logDir: path.resolve(env.LOG_DIR || './logs'),
    logMaxSizeBytes: parsePositiveInt(env.LOG_MAX_SIZE_BYTES, 5 * 1024 * 1024),
    logMaxFiles: parsePositiveInt(env.LOG_MAX_FILES, 5),
    schedulerPollIntervalMs: parsePositiveInt(env.SCHEDULER_POLL_INTERVAL_MS, 5000),
    queuePollIntervalMs: parsePositiveInt(env.QUEUE_POLL_INTERVAL_MS, 1000),
    chatMessageIntervalMs: parsePositiveInt(env.CHAT_MESSAGE_INTERVAL_MS, 2000),
    maxMissedOccurrencesPerReminder: parsePositiveInt(env.MAX_MISSED_OCCURRENCES_PER_REMINDER, 3),
    maxDeliveryAttempts: parsePositiveInt(env.MAX_DELIVERY_ATTEMPTS, 5)
  };

  return config;
}

export function validateBotConfig(config) {
  if (!config.botToken) {
    throw new Error('Не задан BOT_TOKEN в переменных окружения (.env)');
  }
}
