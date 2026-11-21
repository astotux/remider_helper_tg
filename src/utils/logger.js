import fs from 'node:fs';
import path from 'node:path';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};

export class Logger {
  constructor(options = {}) {
    this.level = LEVELS[options.level] ? options.level : 'info';
    this.logDir = options.logDir || null;
    this.logFileName = options.logFileName || 'bot.log';
    this.maxSizeBytes = options.maxSizeBytes || 5 * 1024 * 1024;
    this.maxFiles = options.maxFiles || 5;
    this.writeToConsole = options.writeToConsole ?? true;

    if (this.logDir) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  shouldLog(level) {
    return LEVELS[level] >= LEVELS[this.level];
  }

  formatLine(level, message, meta) {
    const timestamp = new Date().toISOString();
    const upper = level.toUpperCase().padEnd(5);
    let line = `[${timestamp}] ${upper} ${message}`;
    if (meta !== undefined && meta !== null) {
      if (meta instanceof Error) {
        line += ` | ${meta.stack || meta.message}`;
      } else if (typeof meta === 'object') {
        try {
          line += ` | ${JSON.stringify(meta, (_k, v) => (v instanceof Error ? v.stack || v.message : v))}`;
        } catch {
          line += ` | [unserializable meta]`;
        }
      } else {
        line += ` | ${String(meta)}`;
      }
    }
    return line;
  }

  rotateIfNeeded(filePath) {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size < this.maxSizeBytes) return;

    for (let i = this.maxFiles - 1; i >= 1; i -= 1) {
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
      if (fs.existsSync(src)) {
        if (fs.existsSync(dst)) {
          fs.unlinkSync(dst);
        }
        fs.renameSync(src, dst);
      }
    }
  }

  write(level, message, meta) {
    if (!this.shouldLog(level)) return;
    const line = this.formatLine(level, message, meta);

    if (this.writeToConsole) {
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    if (this.logDir) {
      try {
        const filePath = path.join(this.logDir, this.logFileName);
        this.rotateIfNeeded(filePath);
        fs.appendFileSync(filePath, `${line}\n`, 'utf8');
      } catch (err) {
        if (this.writeToConsole) {
          console.error('Ошибка записи лога в файл:', err.message);
        }
      }
    }
  }

  debug(message, meta) {
    this.write('debug', message, meta);
  }

  info(message, meta) {
    this.write('info', message, meta);
  }

  warn(message, meta) {
    this.write('warn', message, meta);
  }

  error(message, meta) {
    this.write('error', message, meta);
  }
}

export function createLogger(config = {}) {
  return new Logger({
    level: config.logLevel || 'info',
    logDir: config.logDir || null,
    maxSizeBytes: config.logMaxSizeBytes,
    maxFiles: config.logMaxFiles
  });
}
