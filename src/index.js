import { loadConfig, validateBotConfig } from './config/config.js';
import { createLogger } from './utils/logger.js';
import { openDatabase, closeDatabase } from './database/db.js';
import { runMigrations } from './database/migrate.js';
import { UserRepository } from './database/repositories/user.repository.js';
import { ChatRepository } from './database/repositories/chat.repository.js';
import { ReminderRepository } from './database/repositories/reminder.repository.js';
import { OccurrenceRepository } from './database/repositories/occurrence.repository.js';
import { QueueRepository } from './database/repositories/queue.repository.js';
import { CompletionRepository } from './database/repositories/completion.repository.js';
import { SessionRepository } from './database/repositories/session.repository.js';
import { TimezoneService } from './services/timezone.service.js';
import { PermissionService } from './services/permission.service.js';
import { ReminderService } from './services/reminder.service.js';
import { DeliveryService } from './services/delivery.service.js';
import { CompletionService } from './services/completion.service.js';
import { SchedulerService } from './services/scheduler.service.js';
import { DeliveryQueue } from './queues/delivery.queue.js';
import { createTelegramBot } from './bot/bot.js';

async function bootstrap() {
  const config = loadConfig();
  validateBotConfig(config);

  const logger = createLogger(config);
  const db = openDatabase(config.databasePath);
  runMigrations(db, logger);

  const userRepo = new UserRepository(db);
  const chatRepo = new ChatRepository(db);
  const reminderRepo = new ReminderRepository(db);
  const occurrenceRepo = new OccurrenceRepository(db);
  const queueRepo = new QueueRepository(db);
  const completionRepo = new CompletionRepository(db);
  const sessionRepo = new SessionRepository(db);

  const timezoneService = new TimezoneService({
    db,
    userRepo,
    chatRepo,
    reminderRepo,
    logger
  });

  const reminderService = new ReminderService({
    db,
    reminderRepo,
    occurrenceRepo,
    queueRepo,
    chatRepo,
    logger
  });

  let schedulerRef = null;

  const { bot, deliveryService } = createTelegramBot({
    botToken: config.botToken,
    userRepo,
    chatRepo,
    sessionRepo,
    timezoneService,
    reminderService,
    permissionServiceFactory: (telegramGateway) =>
      new PermissionService({ telegramGateway, logger }),
    deliveryServiceFactory: (telegramGateway) =>
      new DeliveryService({ telegramGateway, occurrenceRepo, completionRepo, logger }),
    completionServiceFactory: (delService, telegramGateway) =>
      new CompletionService({
        db,
        occurrenceRepo,
        completionRepo,
        deliveryService: delService,
        reminderService,
        telegramGateway,
        logger
      }),
    onReminderActivated: () => {
      void schedulerRef?.tick();
    },
    logger
  });

  const deliveryQueue = new DeliveryQueue({
    queueRepo,
    occurrenceRepo,
    reminderRepo,
    deliveryService,
    reminderService,
    config,
    logger
  });

  const scheduler = new SchedulerService({
    db,
    reminderRepo,
    occurrenceRepo,
    queueRepo,
    deliveryQueue,
    config,
    logger
  });
  schedulerRef = scheduler;

  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'menu', description: 'Открыть меню напоминаний' },
    { command: 'cancel', description: 'Отменить текущее действие' },
    { command: 'help', description: 'Справка' }
  ]);

  let isShuttingDown = false;
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Получен сигнал ${signal}. Завершение работы...`);

    try {
      scheduler.stop();
      bot.stop(signal);
      await deliveryQueue.stop();
      closeDatabase(db);
      logger.info('Бот корректно остановлен.');
      process.exit(0);
    } catch (err) {
      logger.error('Ошибка при завершении работы', err);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  deliveryQueue.start();
  scheduler.start();

  await bot.launch({
    allowedUpdates: ['message', 'callback_query', 'my_chat_member']
  });

  logger.info('Telegram-бот успешно запущен');
}

bootstrap().catch((err) => {
  console.error('Критическая ошибка запуска бота:', err);
  process.exit(1);
});
