import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';
import { openDatabase, closeDatabase } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { UserRepository } from '../src/database/repositories/user.repository.js';
import { ChatRepository } from '../src/database/repositories/chat.repository.js';
import { ReminderRepository } from '../src/database/repositories/reminder.repository.js';
import { OccurrenceRepository } from '../src/database/repositories/occurrence.repository.js';
import { QueueRepository } from '../src/database/repositories/queue.repository.js';
import { CompletionRepository } from '../src/database/repositories/completion.repository.js';
import { SessionRepository } from '../src/database/repositories/session.repository.js';
import { TimezoneService } from '../src/services/timezone.service.js';
import { ReminderService } from '../src/services/reminder.service.js';
import { DeliveryService } from '../src/services/delivery.service.js';
import { CompletionService } from '../src/services/completion.service.js';
import { PermissionService } from '../src/services/permission.service.js';
import { SchedulerService } from '../src/services/scheduler.service.js';
import { DeliveryQueue } from '../src/queues/delivery.queue.js';
import { computeMissedAndNext } from '../src/utils/date.utils.js';
import { WizardFlow } from '../src/bot/scenes/wizard.flow.js';
import * as m001 from '../src/database/migrations/001_initial.js';

describe('Repeat-window sub-type (once/daily/weekly), synchronized completions, and auto-stop', () => {
  let tmpDir;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rembot-rep-'));
    db = openDatabase(path.join(tmpDir, 'rep.sqlite'));
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupAll({ memberCount = 4 } = {}) {
    const sent = [];
    const edits = [];
    let nextId = 500;

    const gateway = {
      sent,
      edits,
      async getChatMember() {
        return { status: 'administrator' };
      },
      async getChatMemberCount() {
        return memberCount; // включает бота -> нужно (memberCount - 1) отметок
      },
      async sendMessage(chatId, text, extra) {
        const msg = { message_id: nextId++, chat: { id: chatId }, text, extra };
        sent.push(msg);
        return msg;
      },
      async sendPhoto(chatId, fileId, extra) {
        const msg = { message_id: nextId++, chat: { id: chatId }, fileId, extra };
        sent.push(msg);
        return msg;
      },
      async editMessageText(chatId, messageId, text, extra) {
        edits.push({ chatId, messageId, text, extra });
        return { message_id: messageId };
      },
      async editMessageCaption(chatId, messageId, caption, extra) {
        edits.push({ chatId, messageId, caption, extra });
        return { message_id: messageId };
      }
    };

    const userRepo = new UserRepository(db);
    const chatRepo = new ChatRepository(db);
    const reminderRepo = new ReminderRepository(db);
    const occurrenceRepo = new OccurrenceRepository(db);
    const queueRepo = new QueueRepository(db);
    const completionRepo = new CompletionRepository(db);
    const sessionRepo = new SessionRepository(db);

    const timezoneService = new TimezoneService({ db, userRepo, chatRepo, reminderRepo });
    const reminderService = new ReminderService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      chatRepo
    });
    const deliveryService = new DeliveryService({
      telegramGateway: gateway,
      occurrenceRepo,
      completionRepo
    });
    const completionService = new CompletionService({
      db,
      occurrenceRepo,
      completionRepo,
      deliveryService,
      reminderService,
      telegramGateway: gateway
    });
    const permissionService = new PermissionService({ telegramGateway: gateway });

    return {
      gateway,
      userRepo,
      chatRepo,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      completionRepo,
      sessionRepo,
      timezoneService,
      reminderService,
      deliveryService,
      completionService,
      permissionService
    };
  }

  it('opens repeat window for daily/once reminders, caps missed slots, and advances daily to next day after window ends', () => {
    const baseData = { time: '12:00', repeat: { intervalMinutes: 30, durationMinutes: 300 } };

    // 1. Наступило базовое время 12:00 MSK (09:00 UTC), сейчас 11:05 UTC -> окно открылось в 09:00 UTC (конец 14:00 UTC)
    const opened = computeMissedAndNext({
      scheduleType: 'daily',
      scheduleData: baseData,
      timezone: 'Europe/Moscow',
      currentNextRunAtIso: '2026-11-22T09:00:00.000Z',
      seriesId: null,
      seriesEndsAtIso: null,
      seriesIdFactory: () => 's_day1',
      nowUtc: DateTime.fromISO('2026-11-22T11:05:00.000Z'),
      maxMissed: 3
    });

    assert.equal(opened.totalMissed, 5); // 09:00, 09:30, 10:00, 10:30, 11:00
    assert.equal(opened.occurrenceSeriesId, 's_day1');
    assert.equal(opened.nextSeriesId, 's_day1');
    assert.equal(opened.nextSeriesEndsAt, '2026-11-22T14:00:00.000Z');
    assert.equal(opened.nextRunAt, '2026-11-22T11:30:00.000Z');

    // 2. Последний слот окна (14:00 UTC) -> occurrence получает s_day1, а напоминание переходит на завтрашний 09:00 UTC
    const finished = computeMissedAndNext({
      scheduleType: 'daily',
      scheduleData: baseData,
      timezone: 'Europe/Moscow',
      currentNextRunAtIso: '2026-11-22T14:00:00.000Z',
      seriesId: 's_day1',
      seriesEndsAtIso: '2026-11-22T14:00:00.000Z',
      nowUtc: DateTime.fromISO('2026-11-22T14:01:00.000Z'),
      maxMissed: 3
    });
    assert.deepEqual(finished.missedSlots, ['2026-11-22T14:00:00.000Z']);
    assert.equal(finished.occurrenceSeriesId, 's_day1');
    assert.equal(finished.nextSeriesId, null);
    assert.equal(finished.nextSeriesEndsAt, null);
    assert.equal(finished.nextRunAt, '2026-11-23T09:00:00.000Z');

    // 3. Для once последний слот окна переводит nextRunAt в null
    const finishedOnce = computeMissedAndNext({
      scheduleType: 'once',
      scheduleData: { date: '2026-11-22', ...baseData },
      timezone: 'Europe/Moscow',
      currentNextRunAtIso: '2026-11-22T14:00:00.000Z',
      seriesId: 's_once',
      seriesEndsAtIso: '2026-11-22T14:00:00.000Z',
      nowUtc: DateTime.fromISO('2026-11-22T14:01:00.000Z'),
      maxMissed: 3
    });
    assert.equal(finishedOnce.occurrenceSeriesId, 's_once');
    assert.equal(finishedOnce.nextRunAt, null);
  });

  it('synchronizes completion across daily repeat messages, stops today on all_members, and starts fresh series next day', async () => {
    const {
      gateway,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      reminderService,
      deliveryService,
      completionService
    } = setupAll({ memberCount: 4 }); // 3 человека + бот

    const config = {
      schedulerPollIntervalMs: 60000,
      queuePollIntervalMs: 50,
      chatMessageIntervalMs: 50,
      maxMissedOccurrencesPerReminder: 3,
      maxDeliveryAttempts: 3
    };

    const scheduler = new SchedulerService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      deliveryQueue: null,
      config
    });

    // Создаём ежедневное напоминание в 12:00 MSK (09:00 UTC) с повтором каждые 30 мин в течение 5 часов
    const rem = reminderRepo.create({
      ownerTelegramId: 1,
      contextType: 'group',
      contextId: -100888,
      title: 'Проверить сервер',
      completionEnabled: true,
      stopOnComplete: true,
      stopMode: 'all_members',
      scheduleType: 'daily',
      scheduleData: { time: '12:00', repeat: { intervalMinutes: 30, durationMinutes: 300 } },
      timezone: 'Europe/Moscow',
      nextRunAt: '2090-11-22T09:00:00.000Z'
    });

    // День 1: 09:00 и 09:30 UTC
    await scheduler.tick(DateTime.fromISO('2090-11-22T09:00:05.000Z'));
    await scheduler.tick(DateTime.fromISO('2090-11-22T09:30:05.000Z'));

    const day1Occs = db
      .prepare('SELECT * FROM reminder_occurrences WHERE reminder_id = ? ORDER BY id ASC')
      .all(rem.id);
    assert.equal(day1Occs.length, 2);
    assert.ok(day1Occs[0].series_id);
    assert.equal(day1Occs[0].series_id, day1Occs[1].series_id);

    const m1 = await deliveryService.sendOccurrence(day1Occs[0].id);
    const m2 = await deliveryService.sendOccurrence(day1Occs[1].id);

    // Первый участник жмёт на сообщение 1 -> обновляются ОБА (m1 и m2)
    const c1 = await completionService.toggleCompletion({
      occurrenceId: day1Occs[0].id,
      chatId: -100888,
      user: { id: 10, username: 'ivan', first_name: 'Иван' }
    });
    assert.equal(c1.total, 1);
    assert.equal(c1.seriesStopped, false);
    assert.deepEqual(
      gateway.edits.slice(-2).map((e) => e.messageId).sort(),
      [m1.messageId, m2.messageId]
    );

    // Повторное нажатие на сообщение 2 тем же пользователем -> снимает отметку, без дублей
    const undo = await completionService.toggleCompletion({
      occurrenceId: day1Occs[1].id,
      chatId: -100888,
      user: { id: 10, username: 'ivan', first_name: 'Иван' }
    });
    assert.equal(undo.action, 'removed');
    assert.equal(undo.total, 0);

    // Все 3 участника отмечают выполнение
    await completionService.toggleCompletion({
      occurrenceId: day1Occs[0].id,
      chatId: -100888,
      user: { id: 10, username: 'ivan', first_name: 'Иван' }
    });
    await completionService.toggleCompletion({
      occurrenceId: day1Occs[1].id,
      chatId: -100888,
      user: { id: 20, first_name: 'Мария' }
    });
    const c3 = await completionService.toggleCompletion({
      occurrenceId: day1Occs[0].id,
      chatId: -100888,
      user: { id: 30, username: 'petr', first_name: 'Пётр' }
    });
    assert.equal(c3.total, 3);
    assert.equal(c3.seriesStopped, true);

    // Ежедневное напоминание НЕ удалено — оно перенесено на завтрашний 09:00 UTC с очищенным series_id!
    const remAfterDay1 = reminderService.getById(rem.id);
    assert.equal(remAfterDay1.is_active, true);
    assert.equal(remAfterDay1.is_archived, false);
    assert.equal(remAfterDay1.series_id, null);
    assert.equal(remAfterDay1.next_run_at, '2090-11-23T09:00:00.000Z');

    // День 2: 09:00 UTC запускается новая серия с пустым списком выполнивших
    await scheduler.tick(DateTime.fromISO('2090-11-23T09:00:05.000Z'));
    const day2Occ = db
      .prepare('SELECT * FROM reminder_occurrences WHERE reminder_id = ? ORDER BY id DESC LIMIT 1')
      .get(rem.id);
    assert.notEqual(day2Occ.series_id, day1Occs[0].series_id);

    await deliveryService.sendOccurrence(day2Occ.id);
    const day2Msg = gateway.sent.at(-1);
    assert.equal(day2Msg.text.includes('Выполнили:'), false);
  });

  it('stops private once+repeat series on first click and archives when finished naturally', async () => {
    const {
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      reminderService,
      deliveryService,
      completionService
    } = setupAll();

    // 1. Одноразовое в личке с повтором: нажатие «Выполнено» останавливает и архивирует сразу
    const remPrivate = reminderService.createReminder({
      ownerTelegramId: 77,
      contextType: 'private',
      contextId: 77,
      title: 'Выпить лекарство',
      scheduleType: 'once',
      scheduleData: {
        date: '2099-05-01',
        time: '12:00',
        repeat: { intervalMinutes: 15, durationMinutes: 120 }
      },
      timezone: 'Europe/Moscow',
      completionEnabled: true,
      stopOnComplete: true,
      stopMode: 'any_one'
    });

    const { occurrence } = occurrenceRepo.createOrGet({
      reminderId: remPrivate.id,
      chatId: 77,
      scheduledAt: remPrivate.next_run_at,
      seriesId: 's_priv_1'
    });
    await deliveryService.sendOccurrence(occurrence.id);

    const res = await completionService.toggleCompletion({
      occurrenceId: occurrence.id,
      chatId: 77,
      user: { id: 77, first_name: 'Алексей' }
    });
    assert.equal(res.seriesStopped, true);
    const remAfterStop = reminderService.getById(remPrivate.id);
    assert.equal(remAfterStop.is_active, false);
    assert.equal(remAfterStop.is_archived, true);

    // 2. Одноразовое с повтором, где окно уже дошло до последнего слота -> архивируется после доставки
    const pastStart = DateTime.utc().minus({ minutes: 60 }).toISO();
    const pastEnd = DateTime.utc().minus({ minutes: 10 }).toISO();
    const remExpired = reminderRepo.create({
      ownerTelegramId: 77,
      contextType: 'private',
      contextId: 77,
      title: 'Последний повтор окна',
      scheduleType: 'once',
      scheduleData: {
        date: '2026-01-01',
        time: '10:00',
        repeat: { intervalMinutes: 30, durationMinutes: 60 }
      },
      timezone: 'Europe/Moscow',
      seriesId: 's_exp',
      seriesEndsAt: pastEnd,
      nextRunAt: pastStart
    });

    const config = {
      schedulerPollIntervalMs: 60000,
      queuePollIntervalMs: 25,
      chatMessageIntervalMs: 25,
      maxMissedOccurrencesPerReminder: 3,
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
    const scheduler = new SchedulerService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      deliveryQueue,
      config
    });

    await scheduler.tick(DateTime.utc());
    deliveryQueue.start();
    await new Promise((r) => setTimeout(r, 150));
    await deliveryQueue.stop();

    const finalRem = reminderRepo.findById(remExpired.id);
    assert.equal(finalRem.is_active, false);
    assert.equal(finalRem.is_archived, true);
  });

  it('creates daily+repeat and once+repeat reminders via WizardFlow sub-type steps', async () => {
    const {
      sessionRepo,
      chatRepo,
      reminderService,
      timezoneService,
      permissionService
    } = setupAll();

    timezoneService.setContextTimezone('group', -10055, 'Europe/Moscow');

    const wizard = new WizardFlow({
      sessionRepo,
      chatRepo,
      reminderService,
      timezoneService,
      permissionService
    });

    const mkCtx = (extra = {}) => ({
      chat: { id: -10055, type: 'group', title: 'Команда' },
      from: { id: 1, first_name: 'Admin', username: 'admin' },
      appContext: {
        contextType: 'group',
        contextId: -10055,
        userId: 1,
        sessionKey: 'group:-10055:1'
      },
      callbackQuery: extra.cb ? { data: extra.cb, message: { message_id: 1, text: 'x' } } : undefined,
      message: extra.text ? { text: extra.text } : undefined,
      async reply() {
        return { message_id: 2 };
      },
      async editMessageText() {
        return { message_id: 1 };
      },
      async answerCbQuery() {}
    });

    // 1. Ежедневное + подтип повторов (каждые 30 мин, 5 часов, остановка когда выполнят все в чате)
    await wizard.startCreate(mkCtx({ cb: 'menu:create' }));
    await wizard.handleCallback(mkCtx({ cb: 'wiz:st:daily' }), 'wiz:st:daily');
    await wizard.handleMessage(mkCtx({ text: '09:00' }));
    await wizard.handleCallback(mkCtx({ cb: 'wiz:rep:yes' }), 'wiz:rep:yes');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:rep_step:30' }), 'wiz:rep_step:30');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:rep_dur:300' }), 'wiz:rep_dur:300');
    await wizard.handleMessage(mkCtx({ text: 'Утренний отчёт' }));
    await wizard.handleCallback(mkCtx({ cb: 'wiz:skip_desc' }), 'wiz:skip_desc');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:skip_photo' }), 'wiz:skip_photo');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:link_no' }), 'wiz:link_no');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:cm:stop_all' }), 'wiz:cm:stop_all');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:m_done' }), 'wiz:m_done');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:confirm' }), 'wiz:confirm');

    // 2. Одноразовое с быстрой кнопкой "Завтра" + подтип повторов
    await wizard.startCreate(mkCtx({ cb: 'menu:create' }));
    await wizard.handleCallback(mkCtx({ cb: 'wiz:st:once' }), 'wiz:st:once');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:date_pick:tomorrow' }), 'wiz:date_pick:tomorrow');
    await wizard.handleMessage(mkCtx({ text: '14:00' }));
    await wizard.handleCallback(mkCtx({ cb: 'wiz:rep:yes' }), 'wiz:rep:yes');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:rep_step:15' }), 'wiz:rep_step:15');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:rep_dur:180' }), 'wiz:rep_dur:180');
    await wizard.handleMessage(mkCtx({ text: 'Подтвердить релиз' }));
    await wizard.handleCallback(mkCtx({ cb: 'wiz:skip_desc' }), 'wiz:skip_desc');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:skip_photo' }), 'wiz:skip_photo');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:link_no' }), 'wiz:link_no');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:cm:stop_one' }), 'wiz:cm:stop_one');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:m_done' }), 'wiz:m_done');
    await wizard.handleCallback(mkCtx({ cb: 'wiz:confirm' }), 'wiz:confirm');

    const list = reminderService.listByContext('group', -10055);
    assert.equal(list.length, 2);
    const daily = list.find((r) => r.schedule_type === 'daily');
    assert.deepEqual(daily.schedule_data.repeat, { intervalMinutes: 30, durationMinutes: 300 });
    assert.equal(daily.stop_on_complete, true);
    assert.equal(daily.stop_mode, 'all_members');

    const once = list.find((r) => r.schedule_type === 'once');
    assert.deepEqual(once.schedule_data.repeat, { intervalMinutes: 15, durationMinutes: 180 });
    assert.equal(once.stop_mode, 'any_one');
  });

  it('migrates an existing 001_initial database with existing reminders/occurrences/completions cleanly to 002', () => {
    const legacyPath = path.join(tmpDir, 'legacy.sqlite');
    const legacyDb = openDatabase(legacyPath);

    try {
      legacyDb.exec(`
        CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO migrations (id, applied_at) VALUES ('001_initial', '2026-01-01T00:00:00.000Z');
      `);
      m001.up(legacyDb);

      legacyDb.exec(`
        INSERT INTO reminders (
          owner_telegram_id, context_type, context_id, title, completion_enabled,
          schedule_type, schedule_data, timezone, next_run_at, created_at, updated_at
        ) VALUES (
          1, 'private', 1, 'Старое напоминание', 1,
          'daily', '{"time":"09:00"}', 'Europe/Moscow', '2099-01-01T06:00:00.000Z',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO reminder_occurrences (reminder_id, chat_id, scheduled_at, status, created_at)
        VALUES (1, 1, '2026-01-02T06:00:00.000Z', 'sent', '2026-01-02T06:00:00.000Z');
        INSERT INTO reminder_completions (reminder_id, occurrence_id, user_telegram_id, username, first_name, completed_at)
        VALUES (1, 1, 1, 'olduser', 'Old', '2026-01-02T06:05:00.000Z');
      `);

      const applied = runMigrations(legacyDb);
      assert.equal(applied, 1);

      const rem = legacyDb.prepare('SELECT * FROM reminders WHERE id = 1').get();
      assert.equal(rem.title, 'Старое напоминание');
      assert.equal(rem.stop_on_complete, 0);

      const comp = legacyDb.prepare('SELECT * FROM reminder_completions WHERE id = 1').get();
      assert.equal(comp.sync_key, 'occ:1');
    } finally {
      closeDatabase(legacyDb);
    }
  });
});
