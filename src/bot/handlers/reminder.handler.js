import { formatScheduleSummary } from '../../utils/date.utils.js';
import { escapeHtml } from '../../utils/validation.utils.js';
import {
  reminderDeleteConfirmKeyboard,
  reminderEditFieldKeyboard,
  reminderManageKeyboard,
  remindersListKeyboard
} from '../keyboards/menus.keyboard.js';
import { formatReminderDetails } from '../scenes/wizard.flow.js';
import { renderMessage, safeAnswerCbQuery } from '../telegram.adapter.js';

export function createReminderHandler({ reminderService, permissionService, sessionRepo }) {
  async function renderList(ctx) {
    const { contextType, contextId, userId, sessionKey } = ctx.appContext;
    const allowed = await permissionService.canManageContext({ contextType, contextId, userId });
    if (!allowed) {
      await safeAnswerCbQuery(ctx, 'Управлять напоминаниями группы могут только администраторы.', true);
      return;
    }

    sessionRepo.delete(sessionKey);
    const reminders = reminderService.listByContext(contextType, contextId);
    await safeAnswerCbQuery(ctx);

    if (reminders.length === 0) {
      await renderMessage(
        ctx,
        '📋 <b>Список напоминаний пуст</b>\n\nНажмите «➕ Создать напоминание», чтобы добавить первое.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Создать напоминание', callback_data: 'menu:create' }],
              [{ text: '⬅️ В главное меню', callback_data: 'menu:main' }]
            ]
          }
        }
      );
      return;
    }

    const lines = reminders.slice(0, 15).map((rem, idx) => {
      const icon = rem.is_active ? '🟢' : '⏸';
      const sched = formatScheduleSummary(rem.schedule_type, rem.schedule_data, rem.timezone);
      const flags = [
        rem.description ? '📄' : '',
        rem.photo_file_id ? '🖼' : '',
        rem.link_url ? '🔗' : '',
        rem.completion_enabled ? '✅' : ''
      ]
        .filter(Boolean)
        .join('');
      return `${idx + 1}. ${icon} <b>${escapeHtml(rem.title)}</b> ${flags}\n    <i>${escapeHtml(sched)}</i>`;
    });

    const footer =
      reminders.length > 15 ? `\n\n<i>Показаны первые 15 из ${reminders.length} напоминаний.</i>` : '';

    await renderMessage(
      ctx,
      `📋 <b>Напоминания (${reminders.length})</b>\n\n${lines.join('\n')}${footer}\n\nВыберите напоминание для управления:`,
      { reply_markup: remindersListKeyboard(reminders.slice(0, 15)) }
    );
  }

  return {
    handleList: renderList,

    async handleView(ctx, reminderId) {
      const reminder = reminderService.getById(reminderId);
      const allowed = await permissionService.canManageReminder(reminder, ctx.appContext);
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Напоминание не найдено или недостаточно прав.', true);
        return;
      }
      sessionRepo.delete(ctx.appContext.sessionKey);
      await safeAnswerCbQuery(ctx);
      await renderMessage(ctx, formatReminderDetails(reminder), {
        reply_markup: reminderManageKeyboard(reminder)
      });
    },

    async handleToggle(ctx, reminderId) {
      const reminder = reminderService.getById(reminderId);
      const allowed = await permissionService.canManageReminder(reminder, ctx.appContext);
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Недостаточно прав или напоминание не найдено.', true);
        return;
      }
      try {
        const updated = reminderService.toggleActive(reminderId);
        await safeAnswerCbQuery(
          ctx,
          updated.is_active ? 'Напоминание возобновлено' : 'Напоминание приостановлено'
        );
        await renderMessage(ctx, formatReminderDetails(updated), {
          reply_markup: reminderManageKeyboard(updated)
        });
      } catch (err) {
        await safeAnswerCbQuery(ctx, err.message, true);
      }
    },

    async handleEditMenu(ctx, reminderId) {
      const reminder = reminderService.getById(reminderId);
      const allowed = await permissionService.canManageReminder(reminder, ctx.appContext);
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Недостаточно прав или напоминание не найдено.', true);
        return;
      }
      sessionRepo.delete(ctx.appContext.sessionKey);
      await safeAnswerCbQuery(ctx);
      await renderMessage(
        ctx,
        `✏️ <b>Редактирование напоминания</b>\n\n${formatReminderDetails(reminder)}\n\nВыберите поле для изменения:`,
        { reply_markup: reminderEditFieldKeyboard(reminder) }
      );
    },

    async handleDeletePrompt(ctx, reminderId) {
      const reminder = reminderService.getById(reminderId);
      const allowed = await permissionService.canManageReminder(reminder, ctx.appContext);
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Недостаточно прав или напоминание не найдено.', true);
        return;
      }
      await safeAnswerCbQuery(ctx);
      await renderMessage(
        ctx,
        `🗑 <b>Подтверждение удаления</b>\n\nВы действительно хотите удалить напоминание «<b>${escapeHtml(reminder.title)}</b>»? Это действие нельзя отменить.`,
        { reply_markup: reminderDeleteConfirmKeyboard(reminder.id) }
      );
    },

    async handleDeleteConfirm(ctx, reminderId) {
      const reminder = reminderService.getById(reminderId);
      const allowed = await permissionService.canManageReminder(reminder, ctx.appContext);
      if (!allowed) {
        await safeAnswerCbQuery(ctx, 'Напоминание уже удалено или недостаточно прав.', true);
        return;
      }
      reminderService.deleteReminder(reminder.id);
      await safeAnswerCbQuery(ctx, 'Напоминание удалено');
      await renderList(ctx);
    }
  };
}
