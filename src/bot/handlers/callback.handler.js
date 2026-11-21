import { safeAnswerCbQuery } from '../telegram.adapter.js';

export function registerCallbackAndMessageHandlers({
  bot,
  startHandlers,
  reminderHandler,
  settingsHandler,
  wizardFlow,
  completionService,
  logger
}) {
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data || !ctx.appContext) {
      await safeAnswerCbQuery(ctx);
      return;
    }

    try {
      // Отметка выполнения доступна всем участникам чата
      if (data.startsWith('cmp:')) {
        const occurrenceId = Number.parseInt(data.slice(4), 10);
        if (!Number.isInteger(occurrenceId) || occurrenceId <= 0) {
          await safeAnswerCbQuery(ctx, 'Некорректные данные кнопки.', true);
          return;
        }
        const res = await completionService.toggleCompletion({
          occurrenceId,
          chatId: ctx.appContext.contextId,
          user: ctx.from
        });
        if (!res.ok) {
          await safeAnswerCbQuery(ctx, res.reason, true);
        } else {
          await safeAnswerCbQuery(
            ctx,
            res.action === 'added' ? '✅ Отмечено как выполненное' : '↩️ Отметка выполнения снята'
          );
        }
        return;
      }

      if (data === 'menu:main') return await startHandlers.handleMenuMain(ctx);
      if (data === 'menu:help') return await startHandlers.handleMenuHelp(ctx);
      if (data === 'menu:create') return await wizardFlow.startCreate(ctx);
      if (data === 'menu:list') return await reminderHandler.handleList(ctx);
      if (data === 'menu:settings') return await settingsHandler.handleOpenSettings(ctx);

      if (data === 'set:tz') return await settingsHandler.handleOpenTimezonePicker(ctx, 'ru');
      if (data === 'set:tz_page:ru') return await settingsHandler.handleOpenTimezonePicker(ctx, 'ru');
      if (data === 'set:tz_page:world') return await settingsHandler.handleOpenTimezonePicker(ctx, 'world');
      if (data === 'set:about') return await settingsHandler.handleAbout(ctx);
      if (data.startsWith('set:tz_pick:')) {
        return await settingsHandler.handlePickTimezone(ctx, data.slice('set:tz_pick:'.length));
      }

      if (data.startsWith('rem:view:')) {
        const id = Number.parseInt(data.slice('rem:view:'.length), 10);
        if (Number.isInteger(id)) return await reminderHandler.handleView(ctx, id);
      }
      if (data.startsWith('rem:toggle:')) {
        const id = Number.parseInt(data.slice('rem:toggle:'.length), 10);
        if (Number.isInteger(id)) return await reminderHandler.handleToggle(ctx, id);
      }
      if (data.startsWith('rem:edit:')) {
        const id = Number.parseInt(data.slice('rem:edit:'.length), 10);
        if (Number.isInteger(id)) return await reminderHandler.handleEditMenu(ctx, id);
      }
      if (data.startsWith('rem:del:')) {
        const id = Number.parseInt(data.slice('rem:del:'.length), 10);
        if (Number.isInteger(id)) return await reminderHandler.handleDeletePrompt(ctx, id);
      }
      if (data.startsWith('rem:del_ok:')) {
        const id = Number.parseInt(data.slice('rem:del_ok:'.length), 10);
        if (Number.isInteger(id)) return await reminderHandler.handleDeleteConfirm(ctx, id);
      }

      if (data.startsWith('edit:f:')) {
        const parts = data.split(':');
        const field = parts[2];
        const id = Number.parseInt(parts[3], 10);
        if (field && Number.isInteger(id)) {
          return await wizardFlow.startEditField(ctx, id, field);
        }
      }

      if (data.startsWith('wiz:')) {
        return await wizardFlow.handleCallback(ctx, data);
      }

      await safeAnswerCbQuery(ctx, 'Неизвестная или устаревшая кнопка.');
    } catch (err) {
      logger?.error('Ошибка при обработке callback_query', { data, error: err });
      await safeAnswerCbQuery(ctx, 'Произошла ошибка при обработке действия.', true);
    }
  });

  bot.on('message', async (ctx) => {
    if (!ctx.appContext) return;
    try {
      await wizardFlow.handleMessage(ctx);
    } catch (err) {
      logger?.error('Ошибка при обработке сообщения в FSM', err);
      await ctx.reply('⚠️ Произошла ошибка при обработке сообщения. Попробуйте ещё раз или введите /cancel.');
    }
  });
}
