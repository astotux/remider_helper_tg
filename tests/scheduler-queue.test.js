import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';
import { openDatabase, closeDatabase } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { ChatRepository } from '../src/database/repositories/chat.repository.js';
import { ReminderRepository } from '../src/database/repositories/reminder.repository.js';
import { OccurrenceRepository } from '../src/database/repositories/occurrence.repository.js';
import { QueueRepository } from '../src/database/repositories/queue.repository.js';
import { CompletionRepository } from '../src/database/repositories/completion.repository.js';
import { ReminderService } from '../src/services/reminder.service.js';
import { DeliveryService } from '../src/services/delivery.service.js';
import { SchedulerService } from '../src/services/scheduler.service.js';
import { DeliveryQueue } from '../src/queues/delivery.queue.js';

describe('Scheduler & DeliveryQueue (2s chat spacing, recovery, missed runs, error handling)', () => {
  let tmpDir;
  let dbPath;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rembot-sched-'));
    dbPath = path.join(tmpDir, 'sched.sqlite');
    db = openDatabase(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recovers missed runs after restart, enforces 2-second interval per chat, and archives one-time reminder', async () => {
    const sentLog = [];
    let msgId = 1;
    const mockGateway = {
      async sendMessage(chatId, text) {
        sentLog.push({ chatId, text, at: Date.now() });
        return { message_id: msgId++ };
      },
      async sendPhoto() {
        return { message_id: msgId++ };
      }
    };

    const chatRepo = new ChatRepository(db);
    const reminderRepo = new ReminderRepository(db);
    const occurrenceRepo = new OccurrenceRepository(db);
    const queueRepo = new QueueRepository(db);
    const completionRepo = new CompletionRepository(db);

    const reminderService = new ReminderService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      chatRepo
    });

    const deliveryService = new DeliveryService({
      telegramGateway: mockGateway,
      occurrenceRepo,
      completionRepo
    });

    const config = {
      schedulerPollIntervalMs: 60000,
      queuePollIntervalMs: 50,
      chatMessageIntervalMs: 200, // Используем 200мс для ускорения unit-теста при проверке интервала
      maxMissedOccurrencesPerReminder: 3,
      maxDeliveryAttempts: 3
    };

    // Создаём два напоминания в один чат, время которых уже наступило (имитация простоя)
    const pastIso = DateTime.utc().minus({ minutes: 5 }).toISO();
    const rOnce = reminderRepo.create({
      ownerTelegramId: 1,
      contextType: 'private',
      contextId: 555,
      title: 'Разовое пропущенное',
      scheduleType: 'once',
      scheduleData: { date: '2026-01-01', time: '12:00' },
      timezone: 'Europe/Moscow',
      nextRunAt: pastIso
    });

    const rDaily = reminderRepo.create({
      ownerTelegramId: 1,
      contextType: 'private',
      contextId: 555,
      title: 'Ежедневное',
      scheduleType: 'daily',
      scheduleData: { time: '09:00' },
      timezone: 'Europe/Moscow',
      nextRunAt: pastIso
    });

    const deliveryQueue = new DeliveryQueue({
      queueRepo,
      occurrenceRepo,
      reminderRepo,
      deliveryService,
      reminderService,
      config
    });

    const scheduler = new SchedulerService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      deliveryQueue,
      config
    });

    const enqueued = await scheduler.tick(DateTime.utc());
    assert.equal(enqueued, 2);

    // Повторный тик не должен дублировать те же срабатывания
    const enqueuedAgain = await scheduler.tick(DateTime.utc());
    assert.equal(enqueuedAgain, 0);

    deliveryQueue.start();
    // Ждём пока оба сообщения отправятся с интервалом >= 200ms
    const deadline = Date.now() + 2000;
    while (sentLog.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    await deliveryQueue.stop();

    assert.equal(sentLog.length, 2);
    const gap = sentLog[1].at - sentLog[0].at;
    assert.ok(gap >= 180, `Expected interval >= ~200ms, got ${gap}ms`);

    // Одноразовое напоминание архивировано после отправки
    const onceAfter = reminderRepo.findById(rOnce.id);
    assert.equal(onceAfter.is_active, false);
    assert.equal(onceAfter.is_archived, true);

    // Ежедневное напоминание получило следующий будущий next_run_at
    const dailyAfter = reminderRepo.findById(rDaily.id);
    assert.equal(dailyAfter.is_active, true);
    assert.ok(dailyAfter.next_run_at > DateTime.utc().toISO());
  });

  it('handles Telegram 429 rate limits, permanent 403 errors, and stale processing recovery', async () => {
    let callCount = 0;
    const mockGateway = {
      async sendMessage(chatId) {
        callCount += 1;
        if (chatId === 777 && callCount === 1) {
          const err = new Error('Too Many Requests');
          err.response = { error_code: 429, parameters: { retry_after: 1 } };
          throw err;
        }
        if (chatId === -100999) {
          const err = new Error('Forbidden: bot was kicked from the group chat');
          err.response = { error_code: 403, description: 'Forbidden: bot was kicked from the group chat' };
          throw err;
        }
        return { message_id: 900 };
      }
    };

    const chatRepo = new ChatRepository(db);
    const reminderRepo = new ReminderRepository(db);
    const occurrenceRepo = new OccurrenceRepository(db);
    const queueRepo = new QueueRepository(db);
    const completionRepo = new CompletionRepository(db);

    const reminderService = new ReminderService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      chatRepo
    });
    const deliveryService = new DeliveryService({
      telegramGateway: mockGateway,
      occurrenceRepo,
      completionRepo
    });

    const config = {
      queuePollIntervalMs: 50,
      chatMessageIntervalMs: 50,
      maxDeliveryAttempts: 3
    };

    const deliveryQueue = new DeliveryQueue({
      queueRepo,
      occurrenceRepo,
      reminderRepo,
      deliveryService,
      reminderService,
      config
    });

    // 1. Тест 429 retry_after
    const r1 = reminderRepo.create({
      ownerTelegramId: 777,
      contextType: 'private',
      contextId: 777,
      title: 'Тест 429',
      scheduleType: 'daily',
      scheduleData: { time: '10:00' },
      timezone: 'Europe/Moscow',
      nextRunAt: '2099-01-01T07:00:00.000Z'
    });
    const { occurrence: occ1 } = occurrenceRepo.createOrGet({
      reminderId: r1.id,
      chatId: 777,
      scheduledAt: '2026-11-21T07:00:00.000Z',
      status: 'queued'
    });
    const q1 = queueRepo.enqueue({ occurrenceId: occ1.id, chatId: 777 });
    const claimed1 = queueRepo.claimItem(q1.id);
    await deliveryQueue.deliverItem(claimed1);

    const after429 = db.prepare('SELECT * FROM reminder_queue WHERE id = ?').get(q1.id);
    assert.equal(after429.status, 'pending');
    assert.ok(after429.last_error.includes('429'));

    // 2. Тест 403 bot kicked -> деактивирует группу
    chatRepo.upsert({ telegramId: -100999, type: 'supergroup', title: 'Test', isActive: true });
    const r2 = reminderRepo.create({
      ownerTelegramId: 1,
      contextType: 'group',
      contextId: -100999,
      title: 'Групповое',
      scheduleType: 'daily',
      scheduleData: { time: '12:00' },
      timezone: 'Europe/Moscow',
      nextRunAt: '2099-01-01T09:00:00.000Z'
    });
    const { occurrence: occ2 } = occurrenceRepo.createOrGet({
      reminderId: r2.id,
      chatId: -100999,
      scheduledAt: '2026-11-21T09:00:00.000Z',
      status: 'queued'
    });
    const q2 = queueRepo.enqueue({ occurrenceId: occ2.id, chatId: -100999 });
    const claimed2 = queueRepo.claimItem(q2.id);
    await deliveryQueue.deliverItem(claimed2);

    assert.equal(chatRepo.findByTelegramId(-100999).is_active, 0);
    assert.equal(reminderRepo.findById(r2.id).is_active, false);

    // 3. Тест recoverStaleProcessing после падения процесса
    const claimedAgain = queueRepo.claimItem(q1.id);
    assert.equal(claimedAgain.status, 'processing');
    const recovered = queueRepo.recoverStaleProcessing();
    assert.equal(recovered.resetCount, 1);
    assert.equal(
      db.prepare('SELECT status FROM reminder_queue WHERE id = ?').get(q1.id).status,
      'pending'
    );
  });
});
