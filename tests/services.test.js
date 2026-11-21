import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, closeDatabase } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { UserRepository } from '../src/database/repositories/user.repository.js';
import { ChatRepository } from '../src/database/repositories/chat.repository.js';
import { ReminderRepository } from '../src/database/repositories/reminder.repository.js';
import { OccurrenceRepository } from '../src/database/repositories/occurrence.repository.js';
import { QueueRepository } from '../src/database/repositories/queue.repository.js';
import { CompletionRepository } from '../src/database/repositories/completion.repository.js';
import { TimezoneService } from '../src/services/timezone.service.js';
import { ReminderService } from '../src/services/reminder.service.js';
import { DeliveryService } from '../src/services/delivery.service.js';
import { CompletionService } from '../src/services/completion.service.js';
import { PermissionService } from '../src/services/permission.service.js';

function createMockGateway() {
  const sentMessages = [];
  const editedMessages = [];
  let nextMsgId = 100;
  const adminMap = new Map();

  return {
    sentMessages,
    editedMessages,
    adminMap,
    async getChatMember(chatId, userId) {
      const status = adminMap.get(`${chatId}:${userId}`) || 'member';
      return { status, user: { id: userId } };
    },
    async sendMessage(chatId, text, extra) {
      const msg = { message_id: nextMsgId++, chat: { id: chatId }, text, extra };
      sentMessages.push({ type: 'text', ...msg });
      return msg;
    },
    async sendPhoto(chatId, fileId, extra) {
      const msg = { message_id: nextMsgId++, chat: { id: chatId }, fileId, extra };
      sentMessages.push({ type: 'photo', ...msg });
      return msg;
    },
    async editMessageText(chatId, messageId, text, extra) {
      editedMessages.push({ type: 'text', chatId, messageId, text, extra });
      return { message_id: messageId };
    },
    async editMessageCaption(chatId, messageId, caption, extra) {
      editedMessages.push({ type: 'caption', chatId, messageId, caption, extra });
      return { message_id: messageId };
    }
  };
}

describe('Services integration (reminders, timezones, permissions, completions, persistence)', () => {
  let tmpDir;
  let dbPath;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rembot-test-'));
    dbPath = path.join(tmpDir, 'test.sqlite');
    db = openDatabase(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupDeps(gateway = createMockGateway()) {
    const userRepo = new UserRepository(db);
    const chatRepo = new ChatRepository(db);
    const reminderRepo = new ReminderRepository(db);
    const occurrenceRepo = new OccurrenceRepository(db);
    const queueRepo = new QueueRepository(db);
    const completionRepo = new CompletionRepository(db);

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
      deliveryService
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
      timezoneService,
      reminderService,
      deliveryService,
      completionService,
      permissionService
    };
  }

  it('creates, edits, toggles, and deletes reminders in private chat and recalculates on timezone change', () => {
    const { timezoneService, reminderService } = setupDeps();

    timezoneService.setContextTimezone('private', 111, 'Europe/Moscow');

    const daily = reminderService.createReminder({
      ownerTelegramId: 111,
      contextType: 'private',
      contextId: 111,
      title: 'Выпить воду',
      description: '<b>200 мл</b>',
      scheduleType: 'daily',
      scheduleData: { time: '09:00' },
      timezone: 'Europe/Moscow'
    });

    assert.equal(daily.title, 'Выпить воду');
    assert.ok(daily.next_run_at.endsWith('T06:00:00.000Z'));

    const weekly = reminderService.createReminder({
      ownerTelegramId: 111,
      contextType: 'private',
      contextId: 111,
      title: 'Спорт',
      scheduleType: 'weekly',
      scheduleData: { days: [1, 3, 5], time: '19:00' },
      timezone: 'Europe/Moscow'
    });
    assert.equal(weekly.schedule_type, 'weekly');

    const once = reminderService.createReminder({
      ownerTelegramId: 111,
      contextType: 'private',
      contextId: 111,
      title: 'Новый год',
      scheduleType: 'once',
      scheduleData: { date: '2099-12-31', time: '23:55' },
      timezone: 'Europe/Moscow'
    });
    assert.equal(once.next_run_at, '2099-12-31T20:55:00.000Z');

    // Edit title, photo, link, completion, mentions
    const edited = reminderService.updateReminder(daily.id, {
      title: 'Выпить стакан воды',
      photoFileId: 'file_123',
      linkTitle: 'Трекер',
      linkUrl: 'https://example.com/water',
      completionEnabled: true,
      mentionsEnabled: true,
      mentionsData: [{ telegramId: 111, firstName: 'Иван' }]
    });
    assert.equal(edited.title, 'Выпить стакан воды');
    assert.equal(edited.photo_file_id, 'file_123');
    assert.equal(edited.link_url, 'https://example.com/water');

    // Change timezone from Europe/Moscow (UTC+3) to Asia/Almaty (UTC+5)
    const tzRes = timezoneService.setContextTimezone('private', 111, 'Asia/Almaty');
    assert.equal(tzRes.recalculatedCount, 3);

    const onceAfterTz = reminderService.getById(once.id);
    assert.equal(onceAfterTz.timezone, 'Asia/Almaty');
    assert.equal(onceAfterTz.next_run_at, '2099-12-31T18:55:00.000Z');

    // Toggle pause/resume and delete
    const paused = reminderService.toggleActive(daily.id);
    assert.equal(paused.is_active, false);
    const resumed = reminderService.toggleActive(daily.id);
    assert.equal(resumed.is_active, true);

    assert.equal(reminderService.deleteReminder(weekly.id), true);
    assert.equal(reminderService.listByContext('private', 111).length, 2);
  });

  it('enforces group admin permissions dynamically via Telegram API', async () => {
    const gateway = createMockGateway();
    gateway.adminMap.set('-100500:1', 'administrator');
    gateway.adminMap.set('-100500:2', 'member');

    const { timezoneService, reminderService, permissionService } = setupDeps(gateway);
    timezoneService.setContextTimezone('group', -100500, 'Europe/Moscow');

    const rem = reminderService.createReminder({
      ownerTelegramId: 1,
      contextType: 'group',
      contextId: -100500,
      title: 'Дейли стендап',
      scheduleType: 'daily',
      scheduleData: { time: '10:00' },
      timezone: 'Europe/Moscow'
    });

    assert.equal(
      await permissionService.canManageReminder(rem, {
        contextType: 'group',
        contextId: -100500,
        userId: 1
      }),
      true
    );

    // Regular member denied
    assert.equal(
      await permissionService.canManageReminder(rem, {
        contextType: 'group',
        contextId: -100500,
        userId: 2
      }),
      false
    );

    // User 1 loses admin rights
    gateway.adminMap.set('-100500:1', 'member');
    assert.equal(
      await permissionService.canManageReminder(rem, {
        contextType: 'group',
        contextId: -100500,
        userId: 1
      }),
      false
    );
  });

  it('delivers photo/link/mentions, tracks group completions without duplicates, and persists across restart', async () => {
    const gateway = createMockGateway();
    const {
      timezoneService,
      reminderService,
      occurrenceRepo,
      deliveryService,
      completionService
    } = setupDeps(gateway);

    timezoneService.setContextTimezone('group', -100777, 'Europe/Moscow');

    const rem = reminderService.createReminder({
      ownerTelegramId: 10,
      contextType: 'group',
      contextId: -100777,
      title: 'Отправить отчёт',
      description: '<i>Не забудьте прикрепить файл</i>',
      photoFileId: 'photo_abc',
      linkTitle: 'Форма отчёта',
      linkUrl: 'https://example.com/form',
      completionEnabled: true,
      mentionsEnabled: true,
      mentionsData: [{ username: 'alice' }, { telegramId: 42, firstName: 'Борис' }],
      scheduleType: 'daily',
      scheduleData: { time: '18:00' },
      timezone: 'Europe/Moscow'
    });

    const { occurrence } = occurrenceRepo.createOrGet({
      reminderId: rem.id,
      chatId: -100777,
      scheduledAt: rem.next_run_at,
      status: 'queued'
    });

    const sent = await deliveryService.sendOccurrence(occurrence.id);
    assert.equal(sent.messageId, 100);
    assert.equal(gateway.sentMessages.length, 1);
    assert.equal(gateway.sentMessages[0].type, 'photo');
    assert.ok(gateway.sentMessages[0].extra.caption.includes('@alice'));
    assert.ok(gateway.sentMessages[0].extra.caption.includes('tg://user?id=42'));
    assert.equal(gateway.sentMessages[0].extra.reply_markup.inline_keyboard.length, 2);

    // Two different users mark completion
    const r1 = await completionService.toggleCompletion({
      occurrenceId: occurrence.id,
      chatId: -100777,
      user: { id: 101, username: 'user1', first_name: 'Анна' }
    });
    assert.equal(r1.action, 'added');
    assert.equal(r1.total, 1);

    const r2 = await completionService.toggleCompletion({
      occurrenceId: occurrence.id,
      chatId: -100777,
      user: { id: 102, first_name: 'Иван' }
    });
    assert.equal(r2.action, 'added');
    assert.equal(r2.total, 2);

    const lastEdit = gateway.editedMessages.at(-1);
    assert.equal(lastEdit.type, 'caption');
    assert.ok(lastEdit.caption.includes('<b>Выполнили: 2</b>'));
    assert.ok(lastEdit.caption.includes('<blockquote expandable>- @user1\n- Иван</blockquote>'));

    // Direct repository insert attempt for duplicate user must ignore
    const { completionRepo } = setupDeps(gateway);
    const dupInsert = completionRepo.addCompletion({
      reminderId: rem.id,
      occurrenceId: occurrence.id,
      userTelegramId: 101,
      username: 'user1',
      firstName: 'Анна'
    });
    assert.equal(dupInsert.inserted, false);

    // Toggle off user 101
    const r3 = await completionService.toggleCompletion({
      occurrenceId: occurrence.id,
      chatId: -100777,
      user: { id: 101, username: 'user1', first_name: 'Анна' }
    });
    assert.equal(r3.action, 'removed');
    assert.equal(r3.total, 1);

    // Simulate bot restart: close DB and reopen
    closeDatabase(db);
    db = openDatabase(dbPath);
    const afterRestart = setupDeps(gateway);
    const persisted = afterRestart.completionRepo.listByOccurrence(occurrence.id);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].user_telegram_id, 102);

    // Separate occurrence has separate completion list
    const { occurrence: occ2 } = afterRestart.occurrenceRepo.createOrGet({
      reminderId: rem.id,
      chatId: -100777,
      scheduledAt: '2099-01-01T15:00:00.000Z',
      status: 'queued'
    });
    assert.equal(afterRestart.completionRepo.listByOccurrence(occ2.id).length, 0);
  });

  it('resolves Russian cities, MSK offsets, partial city suggestions, and local time candidates', () => {
    const { timezoneService } = setupDeps();

    // Города России с нормализацией регистра, ё/е, дефисов
    assert.equal(timezoneService.resolveTimezoneInput('Пермь'), 'Asia/Yekaterinburg');
    assert.equal(timezoneService.resolveTimezoneInput('сочи'), 'Europe/Moscow');
    assert.equal(timezoneService.resolveTimezoneInput('Ростов-на-Дону'), 'Europe/Moscow');
    assert.equal(timezoneService.resolveTimezoneInput('Орёл'), 'Europe/Moscow');
    assert.equal(timezoneService.resolveTimezoneInput('Южно-Сахалинск'), 'Asia/Sakhalin');
    assert.equal(timezoneService.resolveTimezoneInput('Хабаровск'), 'Asia/Vladivostok');

    // Смещения от МСК
    assert.equal(timezoneService.resolveTimezoneInput('МСК'), 'Europe/Moscow');
    assert.equal(timezoneService.resolveTimezoneInput('мск+2'), 'Asia/Yekaterinburg');
    assert.equal(timezoneService.resolveTimezoneInput('+4'), 'Asia/Novosibirsk');
    assert.equal(timezoneService.resolveTimezoneInput('-1'), 'Europe/Kaliningrad');
    assert.equal(timezoneService.resolveTimezoneInput('МСК+9'), 'Asia/Kamchatka');
    assert.equal(timezoneService.resolveTimezoneInput('+15'), null);

    // Частичное совпадение (подсказки)
    const sug = timezoneService.smartLookup('Краснояр');
    assert.equal(sug.type, 'suggestions');
    assert.equal(sug.candidates[0].zone, 'Asia/Krasnoyarsk');

    // Поиск по текущему локальному времени (например, текущее время в Екатеринбурге)
    const nowUtc = new Date();
    const ekbTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Yekaterinburg',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(nowUtc);
    const timeLookup = timezoneService.smartLookup(ekbTime);
    assert.equal(timeLookup.type, 'time_matches');
    assert.ok(timeLookup.candidates.some((c) => c.zone === 'Asia/Yekaterinburg'));
  });
});
