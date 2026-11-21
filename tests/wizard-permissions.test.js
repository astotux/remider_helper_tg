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
import { SessionRepository } from '../src/database/repositories/session.repository.js';
import { TimezoneService } from '../src/services/timezone.service.js';
import { ReminderService } from '../src/services/reminder.service.js';
import { PermissionService } from '../src/services/permission.service.js';
import { WizardFlow } from '../src/bot/scenes/wizard.flow.js';
import { createLogger } from '../src/utils/logger.js';
import { createTelegramBot } from '../src/bot/bot.js';
import { DeliveryService } from '../src/services/delivery.service.js';
import { CompletionService } from '../src/services/completion.service.js';
import { CompletionRepository } from '../src/database/repositories/completion.repository.js';

function createFakeCtx({ chatId, userId, chatType = 'group', text = null, callbackData = null }) {
  const replies = [];
  const edits = [];
  const cbAnswers = [];

  return {
    replies,
    edits,
    cbAnswers,
    chat: { id: chatId, type: chatType, title: 'Тестовая группа' },
    from: { id: userId, first_name: `User${userId}`, username: `user${userId}` },
    appContext: {
      contextType: chatType === 'private' ? 'private' : 'group',
      contextId: chatId,
      userId,
      sessionKey: `${chatType === 'private' ? 'private' : 'group'}:${chatId}:${userId}`
    },
    message: text ? { text } : undefined,
    callbackQuery: callbackData
      ? { data: callbackData, message: { message_id: 1, text: 'menu' } }
      : undefined,
    async reply(msg, extra) {
      replies.push({ msg, extra });
      return { message_id: 10 };
    },
    async editMessageText(msg, extra) {
      edits.push({ msg, extra });
      return { message_id: 1 };
    },
    async answerCbQuery(msg, opts) {
      cbAnswers.push({ msg, opts });
    }
  };
}

describe('WizardFlow concurrent multi-user FSM & double-click safety', () => {
  let tmpDir;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rembot-wiz-'));
    db = openDatabase(path.join(tmpDir, 'wiz.sqlite'));
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isolates concurrent wizard sessions of two admins in the same group and prevents duplicate creation on double click', async () => {
    const gateway = {
      async getChatMember(_chatId, userId) {
        return { status: userId === 1 || userId === 2 ? 'administrator' : 'member' };
      }
    };

    const userRepo = new UserRepository(db);
    const chatRepo = new ChatRepository(db);
    const reminderRepo = new ReminderRepository(db);
    const occurrenceRepo = new OccurrenceRepository(db);
    const queueRepo = new QueueRepository(db);
    const sessionRepo = new SessionRepository(db);

    const timezoneService = new TimezoneService({ db, userRepo, chatRepo, reminderRepo });
    const reminderService = new ReminderService({
      db,
      reminderRepo,
      occurrenceRepo,
      queueRepo,
      chatRepo
    });
    const permissionService = new PermissionService({ telegramGateway: gateway });

    const wizard = new WizardFlow({
      sessionRepo,
      chatRepo,
      reminderService,
      timezoneService,
      permissionService
    });

    timezoneService.setContextTimezone('group', -1001, 'Europe/Moscow');

    // Admin 1 и Admin 2 одновременно запускают создание в одной группе
    const ctx1 = createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'menu:create' });
    const ctx2 = createFakeCtx({ chatId: -1001, userId: 2, callbackData: 'menu:create' });
    await wizard.startCreate(ctx1);
    await wizard.startCreate(ctx2);

    // Обычный участник (userId = 3) не может начать создание
    const ctxMember = createFakeCtx({ chatId: -1001, userId: 3, callbackData: 'menu:create' });
    await wizard.startCreate(ctxMember);
    assert.equal(ctxMember.cbAnswers[0].opts.show_alert, true);
    assert.equal(sessionRepo.get('group:-1001:3'), null);

    // Admin 1 выбирает ежедневное, Admin 2 выбирает еженедельное
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:st:daily' }),
      'wiz:st:daily'
    );
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 2, callbackData: 'wiz:st:weekly' }),
      'wiz:st:weekly'
    );

    assert.equal(sessionRepo.get('group:-1001:1').state, 'create:schedule_time');
    assert.equal(sessionRepo.get('group:-1001:2').state, 'create:schedule_days');

    // Завершаем шаг за шагом для Admin 1
    await wizard.handleMessage(createFakeCtx({ chatId: -1001, userId: 1, text: '09:30' }));
    await wizard.handleMessage(createFakeCtx({ chatId: -1001, userId: 1, text: 'Утренний отчёт' }));
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:skip_desc' }),
      'wiz:skip_desc'
    );
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:skip_photo' }),
      'wiz:skip_photo'
    );
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:link_no' }),
      'wiz:link_no'
    );
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:comp_yes' }),
      'wiz:comp_yes'
    );
    await wizard.handleCallback(
      createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:m_done' }),
      'wiz:m_done'
    );

    assert.equal(sessionRepo.get('group:-1001:1').state, 'create:preview');
    // Сессия Admin 2 по-прежнему нетронута
    assert.equal(sessionRepo.get('group:-1001:2').state, 'create:schedule_days');

    // Двойное нажатие на подтверждение не создаёт дубликат
    const confirm1 = createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:confirm' });
    const confirm2 = createFakeCtx({ chatId: -1001, userId: 1, callbackData: 'wiz:confirm' });
    await wizard.handleCallback(confirm1, 'wiz:confirm');
    await wizard.handleCallback(confirm2, 'wiz:confirm');

    const createdList = reminderService.listByContext('group', -1001);
    assert.equal(createdList.length, 1);
    assert.equal(createdList[0].title, 'Утренний отчёт');
  });

  it('rotates log files when maxSizeBytes is exceeded and wires createTelegramBot cleanly', () => {
    const logDir = path.join(tmpDir, 'logs');
    const logger = createLogger({
      logLevel: 'info',
      logDir,
      logMaxSizeBytes: 120,
      logMaxFiles: 3
    });
    logger.writeToConsole = false;

    for (let i = 0; i < 10; i += 1) {
      logger.info(`Тестовое сообщение лога номер ${i} для проверки ротации`);
    }

    const files = fs.readdirSync(logDir);
    assert.ok(files.includes('bot.log'));
    assert.ok(files.includes('bot.log.1'));

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

    const botBundle = createTelegramBot({
      botToken: '123456:TEST_TOKEN',
      userRepo,
      chatRepo,
      sessionRepo,
      timezoneService,
      reminderService,
      permissionServiceFactory: (gw) => new PermissionService({ telegramGateway: gw }),
      deliveryServiceFactory: (gw) =>
        new DeliveryService({ telegramGateway: gw, occurrenceRepo, completionRepo }),
      completionServiceFactory: (ds) =>
        new CompletionService({ db, occurrenceRepo, completionRepo, deliveryService: ds }),
      logger
    });

    assert.ok(botBundle.bot);
    assert.ok(botBundle.telegramGateway);
  });
});
