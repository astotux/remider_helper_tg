import { Telegraf } from 'telegraf';
import { createContextMiddleware } from './middlewares/context.middleware.js';
import { registerStartHandlers } from './handlers/start.handler.js';
import { createSettingsHandler } from './handlers/settings.handler.js';
import { createReminderHandler } from './handlers/reminder.handler.js';
import { registerCallbackAndMessageHandlers } from './handlers/callback.handler.js';
import { WizardFlow } from './scenes/wizard.flow.js';
import { TelegrafGateway } from './telegram.adapter.js';

export function createTelegramBot({
  botToken,
  userRepo,
  chatRepo,
  sessionRepo,
  timezoneService,
  reminderService,
  permissionServiceFactory,
  deliveryServiceFactory,
  completionServiceFactory,
  logger
}) {
  const bot = new Telegraf(botToken);
  const telegramGateway = new TelegrafGateway(bot.telegram);

  const permissionService = permissionServiceFactory(telegramGateway);
  const deliveryService = deliveryServiceFactory(telegramGateway);
  const completionService = completionServiceFactory(deliveryService);

  bot.catch((err, ctx) => {
    logger?.error('Неперехваченная ошибка Telegraf', {
      updateType: ctx?.updateType,
      chatId: ctx?.chat?.id,
      error: err
    });
  });

  bot.use(createContextMiddleware({ userRepo, chatRepo, logger }));

  const startHandlers = registerStartHandlers({
    bot,
    sessionRepo,
    timezoneService,
    reminderService,
    chatRepo,
    logger
  });

  const settingsHandler = createSettingsHandler({
    timezoneService,
    permissionService,
    sessionRepo
  });

  const reminderHandler = createReminderHandler({
    reminderService,
    permissionService,
    sessionRepo
  });

  const wizardFlow = new WizardFlow({
    sessionRepo,
    chatRepo,
    reminderService,
    timezoneService,
    permissionService,
    logger
  });

  registerCallbackAndMessageHandlers({
    bot,
    startHandlers,
    reminderHandler,
    settingsHandler,
    wizardFlow,
    completionService,
    logger
  });

  return {
    bot,
    telegramGateway,
    permissionService,
    deliveryService,
    completionService
  };
}
