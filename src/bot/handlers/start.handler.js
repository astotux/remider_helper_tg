import { formatTimezoneHuman } from '../../utils/date.utils.js';
import { escapeHtml } from '../../utils/validation.utils.js';
import { backToMainKeyboard, mainMenuKeyboard } from '../keyboards/menus.keyboard.js';
import { renderMessage, safeAnswerCbQuery } from '../telegram.adapter.js';

export function buildMainMenuText(ctx, timezoneService) {
  const { contextType, contextId } = ctx.appContext;
  const tz = timezoneService.getContextTimezone(contextType, contextId);
  const tzLabel = tz
    ? `<b>${escapeHtml(formatTimezoneHuman(tz))}</b>`
    : '<i>ещё не выбран (настроим при первом напоминании)</i>';

  if (contextType === 'group') {
    return [
      '⏰ <b>Бот напоминаний</b>',
      '',
      `Группа: <b>${escapeHtml(ctx.chat?.title || 'Без названия')}</b>`,
      `🕒 Часовой пояс: ${tzLabel}`,
      '',
      'Администраторы могут настраивать общие напоминания для чата, а участники — отмечать выполнение кнопкой «✅ Выполнено».',
      '',
      'Выберите действие:'
    ].join('\n');
  }

  return [
    '⏰ <b>Бот напоминаний</b>',
    '',
    'Помогу не забыть о важных делах: настрою разовые, ежедневные или еженедельные напоминания точно по вашему времени.',
    '',
    `🕒 Часовой пояс: ${tzLabel}`,
    '',
    'Выберите действие:'
  ].join('\n');
}

export function buildHelpText() {
  return [
    '❓ <b>Справка по работе с ботом</b>',
    '',
    '<b>Возможности:</b>',
    '• Создание одноразовых, ежедневных и еженедельных напоминаний.',
    '• Работа в личных сообщениях и групповых чатах.',
    '• Поддержка HTML-разметки в описании, фотографий, кнопок со ссылками и упоминаний.',
    '• Кнопка «✅ Выполнено» с учётом участников в группе.',
    '• Независимые часовые пояса с учётом перехода на летнее/зимнее время.',
    '',
    '<b>Права в группах:</b>',
    '• Создавать, редактировать, удалять напоминания и менять настройки могут только администраторы и создатель группы.',
    '• Отмечать выполнение кнопкой «✅ Выполнено» могут все участники группы.',
    '',
    '<b>Команды:</b>',
    '/start или /menu — открыть главное меню',
    '/cancel — отменить текущее создание или редактирование',
    '/help — показать эту справку'
  ].join('\n');
}

export function registerStartHandlers({ bot, sessionRepo, timezoneService, reminderService, chatRepo, logger }) {
  const openMenu = async (ctx) => {
    if (!ctx.appContext) return;
    sessionRepo.delete(ctx.appContext.sessionKey);
    await renderMessage(ctx, buildMainMenuText(ctx, timezoneService), {
      reply_markup: mainMenuKeyboard()
    });
  };

  bot.command(['start', 'menu'], openMenu);

  bot.command('cancel', async (ctx) => {
    if (!ctx.appContext) return;
    const existing = sessionRepo.get(ctx.appContext.sessionKey);
    sessionRepo.delete(ctx.appContext.sessionKey);
    const text = existing
      ? '❌ Текущее действие отменено.\n\nВыберите действие в меню:'
      : 'Нет активного действия для отмены.';
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(buildHelpText(), { parse_mode: 'HTML', reply_markup: backToMainKeyboard() });
  });

  bot.on('my_chat_member', async (ctx) => {
    try {
      const update = ctx.update.my_chat_member;
      const chat = update.chat;
      if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;

      const newStatus = update.new_chat_member?.status;
      if (newStatus === 'left' || newStatus === 'kicked') {
        reminderService.handleBotRemovedFromGroup(chat.id);
      } else if (newStatus === 'member' || newStatus === 'administrator') {
        chatRepo.upsert({
          telegramId: chat.id,
          type: chat.type,
          title: chat.title || null,
          isActive: true
        });
        logger?.info('Бот добавлен или обновлён в группе', { chatId: chat.id, status: newStatus });
      }
    } catch (err) {
      logger?.error('Ошибка обработки my_chat_member', err);
    }
  });

  bot.on('message', async (ctx, next) => {
    const migrateTo = ctx.message?.migrate_to_chat_id;
    if (migrateTo && ctx.chat?.id) {
      try {
        reminderService.handleChatMigration(ctx.chat.id, migrateTo);
      } catch (err) {
        logger?.error('Ошибка миграции чата в супергруппу', err);
      }
      return;
    }
    return next();
  });

  return {
    async handleMenuMain(ctx) {
      sessionRepo.delete(ctx.appContext.sessionKey);
      await safeAnswerCbQuery(ctx);
      await renderMessage(ctx, buildMainMenuText(ctx, timezoneService), {
        reply_markup: mainMenuKeyboard()
      });
    },

    async handleMenuHelp(ctx) {
      await safeAnswerCbQuery(ctx);
      await renderMessage(ctx, buildHelpText(), {
        reply_markup: backToMainKeyboard()
      });
    }
  };
}
