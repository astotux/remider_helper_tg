import { formatTimezoneHuman, formatTimezoneOffset } from '../../utils/date.utils.js';
import { escapeHtml } from '../../utils/validation.utils.js';
import {
  mainMenuKeyboard,
  settingsKeyboard,
  timezoneSelectionKeyboard
} from '../keyboards/menus.keyboard.js';
import { renderMessage, safeAnswerCbQuery } from '../telegram.adapter.js';

const TIMEZONE_PICKER_PROMPT =
  '🌍 <b>Выбор часового пояса</b>\n\n' +
  'Нажмите кнопку с вашим временем на часах или просто напишите в чат:\n' +
  '• <b>Город</b> (например: <code>Пермь</code>, <code>Сочи</code>, <code>Берлин</code>)\n' +
  '• <b>Разницу с Москвой</b> (например: <code>+2</code>, <code>МСК+4</code>, <code>-1</code>)\n' +
  '• <b>Ваше текущее время</b> (например: <code>14:30</code>)';

export function createSettingsHandler({ timezoneService, permissionService, sessionRepo }) {
  function buildSettingsText(contextType, contextId) {
    const tz = timezoneService.getContextTimezone(contextType, contextId);
    const tzDisplay = tz ? `<b>${escapeHtml(formatTimezoneOffset(tz))}</b>` : '<i>не настроен</i>';
    const scope = contextType === 'group' ? 'этой группы' : 'вашего профиля';

    return [
      '⚙️ <b>Настройки</b>',
      '',
      `🕒 Часовой пояс ${scope}: ${tzDisplay}`,
      '',
      'Все напоминания в этом чате приходят строго по выбранному времени, включая сезонный перевод часов.'
    ].join('\n');
  }

  return {
    async handleOpenSettings(ctx) {
      const { contextType, contextId, userId, sessionKey } = ctx.appContext;
      const allowed = await permissionService.canManageContext({ contextType, contextId, userId });
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Настройки группы доступны только администраторам.', true);
        return;
      }

      sessionRepo.delete(sessionKey);
      await safeAnswerCbQuery(ctx);
      await renderMessage(ctx, buildSettingsText(contextType, contextId), {
        reply_markup: settingsKeyboard()
      });
    },

    async handleOpenTimezonePicker(ctx, page = 'ru') {
      const { contextType, contextId, userId, sessionKey } = ctx.appContext;
      const allowed = await permissionService.canManageContext({ contextType, contextId, userId });
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Настройки группы доступны только администраторам.', true);
        return;
      }

      sessionRepo.set(sessionKey, 'settings:tz_input', { contextType, contextId, tzPage: page });
      await safeAnswerCbQuery(ctx);
      await renderMessage(ctx, TIMEZONE_PICKER_PROMPT, {
        reply_markup: timezoneSelectionKeyboard({
          prefix: 'set:tz_pick',
          pagePrefix: 'set:tz_page',
          page,
          backCb: 'menu:settings'
        })
      });
    },

    async handlePickTimezone(ctx, zone) {
      const { contextType, contextId, userId, sessionKey } = ctx.appContext;
      const allowed = await permissionService.canManageContext({ contextType, contextId, userId });
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Настройки группы доступны только администраторам.', true);
        return;
      }

      try {
        const res = timezoneService.setContextTimezone(contextType, contextId, zone);
        const humanTz = formatTimezoneHuman(res.timezone);
        sessionRepo.delete(sessionKey);
        await safeAnswerCbQuery(ctx, `Выбрано: ${humanTz}`);
        await renderMessage(
          ctx,
          `✅ Часовой пояс обновлён: <b>${escapeHtml(humanTz)}</b>\nПересчитано напоминаний: ${res.recalculatedCount}\n\n${buildSettingsText(contextType, contextId)}`,
          { reply_markup: settingsKeyboard() }
        );
      } catch (err) {
        await safeAnswerCbQuery(ctx, err.message, true);
      }
    },

    async handleAbout(ctx) {
      await safeAnswerCbQuery(ctx);
      await renderMessage(
        ctx,
        [
          'ℹ️ <b>О боте</b>',
          '',
          'Удобный помощник для личных дел и командных задач в группах:',
          '',
          '• <b>Гибкое расписание:</b> разовые, ежедневные или по выбранным дням недели.',
          '• <b>Точное время:</b> работает по вашему часовому поясу, включая сезонный перевод часов.',
          '• <b>Оформление:</b> описание, фотография, кнопка со ссылкой и упоминания участников.',
          '• <b>Контроль выполнения:</b> кнопка «✅ Выполнено» показывает, кто из группы уже справился с задачей.'
        ].join('\n'),
        { reply_markup: mainMenuKeyboard() }
      );
    }
  };
}
