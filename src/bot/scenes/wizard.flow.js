import { DateTime } from 'luxon';
import {
  computeNextRunAt,
  formatScheduleSummary,
  formatTimezoneHuman,
  formatUtcInTimezone
} from '../../utils/date.utils.js';
import {
  escapeHtml,
  parseDateInput,
  parseTimeInput,
  validateButtonTitle,
  validateTelegramHtml,
  validateTitle,
  validateUrl
} from '../../utils/validation.utils.js';
import {
  booleanChoiceKeyboard,
  mainMenuKeyboard,
  mentionsStepKeyboard,
  previewConfirmKeyboard,
  reminderEditFieldKeyboard,
  reminderManageKeyboard,
  scheduleTypeKeyboard,
  stepControlsKeyboard,
  timezoneCandidatesKeyboard,
  timezoneSelectionKeyboard,
  weekdaysKeyboard
} from '../keyboards/menus.keyboard.js';
import { renderMessage, safeAnswerCbQuery } from '../telegram.adapter.js';

export function formatReminderDetails(reminder) {
  const status = reminder.is_active ? '🟢 Активно' : '⏸ Приостановлено';
  const sched = formatScheduleSummary(
    reminder.schedule_type,
    reminder.schedule_data,
    reminder.timezone
  );
  const nextRun =
    reminder.is_active && reminder.next_run_at
      ? formatUtcInTimezone(reminder.next_run_at, reminder.timezone)
      : '—';

  const lines = [
    `📌 <b>${escapeHtml(reminder.title)}</b>`,
    `Статус: ${status}`,
    `Расписание: ${escapeHtml(sched)}`,
    `Следующая отправка: <b>${escapeHtml(nextRun)}</b>`,
    `Часовой пояс: <b>${escapeHtml(formatTimezoneHuman(reminder.timezone))}</b>`
  ];

  if (reminder.description) {
    lines.push(`Описание: добавлено (${reminder.description.length} симв.)`);
  }
  if (reminder.photo_file_id) {
    lines.push('Фотография: прикреплена 🖼');
  }
  if (reminder.link_title && reminder.link_url) {
    lines.push(`Кнопка-ссылка: ${escapeHtml(reminder.link_title)} (${escapeHtml(reminder.link_url)})`);
  }
  lines.push(`Кнопка «Выполнено»: ${reminder.completion_enabled ? 'включена ✅' : 'выключена'}`);

  if (reminder.mentions_enabled && reminder.mentions_data?.length > 0) {
    const names = reminder.mentions_data
      .map((m) => (m.username ? `@${m.username}` : m.firstName || `ID ${m.telegramId}`))
      .join(', ');
    lines.push(`Упоминания: ${escapeHtml(names)}`);
  }

  return lines.join('\n');
}

function formatMentionsPreview(mentionsData = []) {
  if (!mentionsData.length) return 'не выбраны';
  return mentionsData
    .map((m) => (m.username ? `@${escapeHtml(m.username)}` : escapeHtml(m.firstName || `ID ${m.telegramId}`)))
    .join(', ');
}

function parseManualMentions(text) {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const parsed = [];
  const invalid = [];

  for (const token of tokens) {
    if (token.startsWith('@')) {
      const username = token.slice(1);
      if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(username)) {
        parsed.push({ username });
      } else {
        invalid.push(token);
      }
      continue;
    }

    const idWithName = /^(.+):(\d{5,15})$/.exec(token);
    if (idWithName) {
      parsed.push({
        telegramId: Number(idWithName[2]),
        firstName: idWithName[1].trim().slice(0, 64)
      });
      continue;
    }

    if (/^\d{5,15}$/.test(token)) {
      parsed.push({
        telegramId: Number(token),
        firstName: `Пользователь ${token}`
      });
      continue;
    }

    invalid.push(token);
  }

  return { parsed, invalid };
}

function mergeMentions(existing = [], additions = []) {
  const result = [...existing];
  for (const item of additions) {
    const dup = result.some((m) => {
      if (item.telegramId && m.telegramId) return Number(m.telegramId) === Number(item.telegramId);
      if (item.username && m.username) return m.username.toLowerCase() === item.username.toLowerCase();
      return false;
    });
    if (!dup) result.push(item);
  }
  return result.slice(0, 20);
}

export class WizardFlow {
  constructor({
    sessionRepo,
    chatRepo,
    reminderService,
    timezoneService,
    permissionService,
    logger = null
  }) {
    this.sessionRepo = sessionRepo;
    this.chatRepo = chatRepo;
    this.reminderService = reminderService;
    this.timezoneService = timezoneService;
    this.permissionService = permissionService;
    this.logger = logger;
  }

  async startCreate(ctx) {
    const { contextType, contextId, userId, sessionKey } = ctx.appContext;
    const allowed = await this.permissionService.canManageContext({ contextType, contextId, userId });
    if (!allowed) {
      await safeAnswerCbQuery(ctx, 'Создавать напоминания в группе могут только администраторы.', true);
      return;
    }

    const draft = {
      mode: 'create',
      contextType,
      contextId,
      ownerTelegramId: userId,
      scheduleType: null,
      scheduleData: {},
      title: null,
      description: null,
      photoFileId: null,
      linkTitle: null,
      linkUrl: null,
      completionEnabled: false,
      mentionsEnabled: false,
      mentionsData: [],
      timezone: this.timezoneService.getContextTimezone(contextType, contextId)
    };

    this.sessionRepo.set(sessionKey, 'create:schedule_type', draft);
    await safeAnswerCbQuery(ctx);
    await this.renderStep(ctx, 'create:schedule_type', draft);
  }

  async startEditField(ctx, reminderId, field) {
    const { contextType, contextId, userId, sessionKey } = ctx.appContext;
    const reminder = this.reminderService.getById(reminderId);
    const allowed = await this.permissionService.canManageReminder(reminder, {
      contextType,
      contextId,
      userId
    });
    if (!allowed) {
      await safeAnswerCbQuery(ctx, 'Нет прав или напоминание не найдено.', true);
      return;
    }

    if (field === 'completion') {
      const updated = this.reminderService.updateReminder(reminder.id, {
        completionEnabled: !reminder.completion_enabled
      });
      await safeAnswerCbQuery(
        ctx,
        updated.completion_enabled ? 'Кнопка «Выполнено» включена' : 'Кнопка «Выполнено» выключена'
      );
      await renderMessage(
        ctx,
        `✏️ <b>Редактирование напоминания</b>\n\n${formatReminderDetails(updated)}\n\nВыберите поле для изменения:`,
        { reply_markup: reminderEditFieldKeyboard(updated) }
      );
      return;
    }

    const draft = {
      mode: 'edit',
      reminderId: reminder.id,
      contextType,
      contextId,
      scheduleType: reminder.schedule_type,
      scheduleData: { ...reminder.schedule_data },
      timezone: reminder.timezone,
      mentionsData: [...(reminder.mentions_data || [])],
      linkTitle: reminder.link_title,
      linkUrl: reminder.link_url
    };

    const stateMap = {
      title: 'edit:title',
      description: 'edit:description',
      photo: 'edit:photo',
      link: 'edit:link_title',
      mentions: 'edit:mentions',
      time: 'edit:time',
      days: 'edit:days',
      date: 'edit:date',
      sched: 'edit:sched_type'
    };

    const targetState = stateMap[field];
    if (!targetState) {
      await safeAnswerCbQuery(ctx, 'Неизвестное поле.', true);
      return;
    }

    this.sessionRepo.set(sessionKey, targetState, draft);
    await safeAnswerCbQuery(ctx);
    await this.renderStep(ctx, targetState, draft);
  }

  getPreviousCreateState(state, draft) {
    switch (state) {
      case 'create:schedule_days':
      case 'create:schedule_date':
        return 'create:schedule_type';
      case 'create:schedule_time':
        if (draft.scheduleType === 'weekly') return 'create:schedule_days';
        if (draft.scheduleType === 'once') return 'create:schedule_date';
        return 'create:schedule_type';
      case 'create:title':
        return 'create:schedule_time';
      case 'create:description':
        return 'create:title';
      case 'create:photo':
        return 'create:description';
      case 'create:link_ask':
        return 'create:photo';
      case 'create:link_title':
        return 'create:link_ask';
      case 'create:link_url':
        return 'create:link_title';
      case 'create:completion':
        return draft.linkUrl ? 'create:link_url' : 'create:link_ask';
      case 'create:mentions':
        return 'create:completion';
      case 'create:timezone':
        return 'create:mentions';
      case 'create:preview': {
        const ctxTz = this.timezoneService.getContextTimezone(draft.contextType, draft.contextId);
        return ctxTz ? 'create:mentions' : 'create:timezone';
      }
      default:
        return 'create:schedule_type';
    }
  }

  async handleCallback(ctx, data) {
    const { contextType, contextId, userId, sessionKey } = ctx.appContext;
    const session = this.sessionRepo.get(sessionKey);

    if (data === 'wiz:cancel') {
      this.sessionRepo.delete(sessionKey);
      await safeAnswerCbQuery(ctx, 'Действие отменено');
      if (session?.data?.mode === 'edit' && session.data.reminderId) {
        const rem = this.reminderService.getById(session.data.reminderId);
        if (rem) {
          await renderMessage(ctx, formatReminderDetails(rem), {
            reply_markup: reminderManageKeyboard(rem)
          });
          return true;
        }
      }
      await renderMessage(ctx, '❌ Создание отменено.\n\nВыберите действие в меню:', {
        reply_markup: mainMenuKeyboard()
      });
      return true;
    }

    if (!session) {
      await safeAnswerCbQuery(ctx, 'Сессия создания/редактирования уже завершена или устарела.', true);
      return true;
    }

    const allowed = await this.permissionService.canManageContext({ contextType, contextId, userId });
    if (!allowed) {
      this.sessionRepo.delete(sessionKey);
      await safeAnswerCbQuery(ctx, 'У вас больше нет прав администратора.', true);
      return true;
    }

    const { state, data: draft } = session;

    if (data === 'wiz:back') {
      await safeAnswerCbQuery(ctx);
      if (draft.mode === 'edit') {
        if (state === 'edit:link_url') {
          this.sessionRepo.set(sessionKey, 'edit:link_title', draft);
          await this.renderStep(ctx, 'edit:link_title', draft);
          return true;
        }
        if (state === 'edit:sched_days' || state === 'edit:sched_date') {
          this.sessionRepo.set(sessionKey, 'edit:sched_type', draft);
          await this.renderStep(ctx, 'edit:sched_type', draft);
          return true;
        }
        if (state === 'edit:sched_time') {
          const prev =
            draft.scheduleType === 'weekly'
              ? 'edit:sched_days'
              : draft.scheduleType === 'once'
                ? 'edit:sched_date'
                : 'edit:sched_type';
          this.sessionRepo.set(sessionKey, prev, draft);
          await this.renderStep(ctx, prev, draft);
          return true;
        }
        this.sessionRepo.delete(sessionKey);
        const rem = this.reminderService.getById(draft.reminderId);
        if (rem) {
          await renderMessage(
            ctx,
            `✏️ <b>Редактирование напоминания</b>\n\n${formatReminderDetails(rem)}\n\nВыберите поле для изменения:`,
            { reply_markup: reminderEditFieldKeyboard(rem) }
          );
        }
        return true;
      }

      const prevState = this.getPreviousCreateState(state, draft);
      this.sessionRepo.set(sessionKey, prevState, draft);
      await this.renderStep(ctx, prevState, draft);
      return true;
    }

    // Выбор типа расписания (create или edit)
    if (data.startsWith('wiz:st:')) {
      const type = data.split(':')[2];
      if (!['daily', 'weekly', 'once'].includes(type)) {
        await safeAnswerCbQuery(ctx, 'Некорректный выбор.', true);
        return true;
      }

      if (state !== 'create:schedule_type' && state !== 'edit:sched_type') {
        await safeAnswerCbQuery(ctx, 'Этот шаг уже пройден.');
        return true;
      }

      draft.scheduleType = type;
      draft.scheduleData =
        type === 'weekly'
          ? { days: draft.scheduleData?.days || [], time: draft.scheduleData?.time || null }
          : type === 'once'
            ? { date: draft.scheduleData?.date || null, time: draft.scheduleData?.time || null }
            : { time: draft.scheduleData?.time || null };

      const prefix = draft.mode === 'edit' ? 'edit:sched' : 'create:schedule';
      const nextState =
        type === 'weekly'
          ? `${prefix}_days`
          : type === 'once'
            ? `${prefix}_date`
            : `${prefix}_time`;

      this.sessionRepo.set(sessionKey, nextState, draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // Переключение дня недели
    if (data.startsWith('wiz:day:')) {
      if (state !== 'create:schedule_days' && state !== 'edit:days' && state !== 'edit:sched_days') {
        await safeAnswerCbQuery(ctx, 'Этот шаг уже не активен.');
        return true;
      }
      const day = Number(data.split(':')[2]);
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        await safeAnswerCbQuery(ctx, 'Некорректный день.', true);
        return true;
      }
      const days = new Set((draft.scheduleData.days || []).map(Number));
      if (days.has(day)) days.delete(day);
      else days.add(day);
      draft.scheduleData.days = [...days].sort((a, b) => a - b);

      this.sessionRepo.set(sessionKey, state, draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, state, draft);
      return true;
    }

    if (data === 'wiz:days_ok') {
      if (state !== 'create:schedule_days' && state !== 'edit:days' && state !== 'edit:sched_days') {
        await safeAnswerCbQuery(ctx, 'Этот шаг уже не активен.');
        return true;
      }
      if (!draft.scheduleData.days || draft.scheduleData.days.length === 0) {
        await safeAnswerCbQuery(ctx, 'Выберите хотя бы один день недели.', true);
        return true;
      }
      await safeAnswerCbQuery(ctx);
      if (state === 'edit:days') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          scheduleData: { ...draft.scheduleData }
        });
        return true;
      }
      const nextState = state === 'edit:sched_days' ? 'edit:sched_time' : 'create:schedule_time';
      this.sessionRepo.set(sessionKey, nextState, draft);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // Пропуск шагов при создании
    if (data === 'wiz:skip_desc' && state === 'create:description') {
      draft.description = null;
      this.sessionRepo.set(sessionKey, 'create:photo', draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, 'create:photo', draft);
      return true;
    }

    if (data === 'wiz:skip_photo' && state === 'create:photo') {
      draft.photoFileId = null;
      this.sessionRepo.set(sessionKey, 'create:link_ask', draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, 'create:link_ask', draft);
      return true;
    }

    if (data === 'wiz:link_yes' && state === 'create:link_ask') {
      this.sessionRepo.set(sessionKey, 'create:link_title', draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, 'create:link_title', draft);
      return true;
    }

    if (data === 'wiz:link_no' && state === 'create:link_ask') {
      draft.linkTitle = null;
      draft.linkUrl = null;
      this.sessionRepo.set(sessionKey, 'create:completion', draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, 'create:completion', draft);
      return true;
    }

    if ((data === 'wiz:comp_yes' || data === 'wiz:comp_no') && state === 'create:completion') {
      draft.completionEnabled = data === 'wiz:comp_yes';
      this.sessionRepo.set(sessionKey, 'create:mentions', draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, 'create:mentions', draft);
      return true;
    }

    // Очистка полей при редактировании
    if (data === 'wiz:clear_desc' && state === 'edit:description') {
      await safeAnswerCbQuery(ctx, 'Описание удалено');
      await this.finishEdit(ctx, sessionKey, draft.reminderId, { description: null });
      return true;
    }

    if (data === 'wiz:clear_photo' && state === 'edit:photo') {
      await safeAnswerCbQuery(ctx, 'Фотография удалена');
      await this.finishEdit(ctx, sessionKey, draft.reminderId, { photoFileId: null });
      return true;
    }

    if (data === 'wiz:clear_link' && state === 'edit:link_title') {
      await safeAnswerCbQuery(ctx, 'Кнопка со ссылкой удалена');
      await this.finishEdit(ctx, sessionKey, draft.reminderId, { linkTitle: null, linkUrl: null });
      return true;
    }

    // Упоминания (create или edit)
    if (data.startsWith('wiz:m_tog:') && (state === 'create:mentions' || state === 'edit:mentions')) {
      const idx = Number.parseInt(data.split(':')[2], 10);
      const knownUsers =
        contextType === 'group' ? this.chatRepo.getKnownUsers(contextId, 10) : [];
      const targetUser = knownUsers[idx];
      if (!targetUser) {
        await safeAnswerCbQuery(ctx, 'Пользователь не найден.', true);
        return true;
      }

      const existsIdx = draft.mentionsData.findIndex(
        (m) => Number(m.telegramId) === Number(targetUser.user_telegram_id)
      );
      if (existsIdx >= 0) {
        draft.mentionsData.splice(existsIdx, 1);
      } else {
        draft.mentionsData.push({
          telegramId: Number(targetUser.user_telegram_id),
          username: targetUser.username || null,
          firstName: targetUser.first_name
        });
      }
      draft.mentionsEnabled = draft.mentionsData.length > 0;
      this.sessionRepo.set(sessionKey, state, draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, state, draft);
      return true;
    }

    if (data === 'wiz:m_clear' && (state === 'create:mentions' || state === 'edit:mentions')) {
      draft.mentionsData = [];
      draft.mentionsEnabled = false;
      this.sessionRepo.set(sessionKey, state, draft);
      await safeAnswerCbQuery(ctx, 'Упоминания очищены');
      await this.renderStep(ctx, state, draft);
      return true;
    }

    if (data === 'wiz:m_done' && (state === 'create:mentions' || state === 'edit:mentions')) {
      draft.mentionsEnabled = draft.mentionsData.length > 0;
      await safeAnswerCbQuery(ctx);
      if (state === 'edit:mentions') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          mentionsEnabled: draft.mentionsEnabled,
          mentionsData: draft.mentionsData
        });
        return true;
      }
      await this.advanceAfterMentions(ctx, sessionKey, draft);
      return true;
    }

    // Переключение страницы часовых поясов (Россия / Мир) на шаге создания
    if (data.startsWith('wiz:tz_page:') && state === 'create:timezone') {
      const page = data.slice('wiz:tz_page:'.length) === 'world' ? 'world' : 'ru';
      draft.tzPage = page;
      this.sessionRepo.set(sessionKey, state, draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, state, draft);
      return true;
    }

    // Выбор часового пояса на шаге создания
    if (data.startsWith('wiz:tz:') && state === 'create:timezone') {
      const zone = data.slice('wiz:tz:'.length);
      try {
        const res = this.timezoneService.setContextTimezone(contextType, contextId, zone);
        draft.timezone = res.timezone;
        this.sessionRepo.set(sessionKey, 'create:preview', draft);
        await safeAnswerCbQuery(ctx, `Выбрано: ${formatTimezoneHuman(res.timezone)}`);
        await this.renderStep(ctx, 'create:preview', draft);
      } catch (err) {
        await safeAnswerCbQuery(ctx, err.message, true);
      }
      return true;
    }

    // Финальное подтверждение создания
    if (data === 'wiz:confirm') {
      if (state !== 'create:preview') {
        await safeAnswerCbQuery(ctx, 'Напоминание уже создано или шаг неактуален.');
        return true;
      }

      // Сначала удаляем сессию для защиты от двойного нажатия
      this.sessionRepo.delete(sessionKey);

      try {
        const created = this.reminderService.createReminder(draft);
        await safeAnswerCbQuery(ctx, 'Напоминание создано!');
        await renderMessage(
          ctx,
          `✅ <b>Напоминание успешно создано!</b>\n\n${formatReminderDetails(created)}`,
          { reply_markup: reminderManageKeyboard(created) }
        );
      } catch (err) {
        await safeAnswerCbQuery(ctx, err.message, true);
        await renderMessage(ctx, `⚠️ Не удалось создать напоминание: ${escapeHtml(err.message)}`, {
          reply_markup: mainMenuKeyboard()
        });
      }
      return true;
    }

    await safeAnswerCbQuery(ctx, 'Кнопка устарела для текущего шага.');
    return true;
  }

  async handleMessage(ctx) {
    const { contextType, contextId, userId, sessionKey } = ctx.appContext;
    const session = this.sessionRepo.get(sessionKey);
    if (!session) return false;

    const { state, data: draft } = session;

    // Проверяем права (актуально для групп)
    const allowed = await this.permissionService.canManageContext({ contextType, contextId, userId });
    if (!allowed) {
      this.sessionRepo.delete(sessionKey);
      return false;
    }

    // Настройка часового пояса из меню Настроек
    if (state === 'settings:tz_input') {
      return this.handleTimezoneTextInput(ctx, {
        sessionKey,
        contextType,
        contextId,
        mode: 'settings'
      });
    }

    // Шаг фотографии (ожидает photo)
    if (state === 'create:photo' || state === 'edit:photo') {
      const photos = ctx.message?.photo;
      if (!photos || photos.length === 0) {
        await ctx.reply('Пожалуйста, отправьте фотографию как изображение (не документом) или нажмите кнопку ниже.');
        return true;
      }
      const bestPhoto = photos[photos.length - 1];
      if (state === 'edit:photo') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, { photoFileId: bestPhoto.file_id });
        return true;
      }
      draft.photoFileId = bestPhoto.file_id;
      this.sessionRepo.set(sessionKey, 'create:link_ask', draft);
      await this.renderStep(ctx, 'create:link_ask', draft);
      return true;
    }

    const text = ctx.message?.text;
    if (typeof text !== 'string') {
      await ctx.reply('Пожалуйста, отправьте текстовое сообщение для этого шага.');
      return true;
    }

    // Дата для одноразового напоминания
    if (state === 'create:schedule_date' || state === 'edit:date' || state === 'edit:sched_date') {
      const parsed = parseDateInput(text);
      if (!parsed.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(parsed.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      draft.scheduleData.date = parsed.value;
      if (state === 'edit:date') {
        try {
          await this.finishEdit(ctx, sessionKey, draft.reminderId, {
            scheduleData: { ...draft.scheduleData }
          });
        } catch (err) {
          await ctx.reply(`⚠️ ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
        }
        return true;
      }
      const nextState = state === 'edit:sched_date' ? 'edit:sched_time' : 'create:schedule_time';
      this.sessionRepo.set(sessionKey, nextState, draft);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // Время отправки
    if (state === 'create:schedule_time' || state === 'edit:time' || state === 'edit:sched_time') {
      const parsed = parseTimeInput(text);
      if (!parsed.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(parsed.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      draft.scheduleData.time = parsed.value;

      if (draft.scheduleType === 'once' && draft.timezone) {
        const nextIso = computeNextRunAt({
          scheduleType: 'once',
          scheduleData: draft.scheduleData,
          timezone: draft.timezone
        });
        if (DateTime.fromISO(nextIso, { zone: 'utc' }) <= DateTime.utc()) {
          await ctx.reply(
            '⚠️ Указанные дата и время уже прошли для вашего часового пояса. Введите время в будущем.'
          );
          return true;
        }
      }

      if (state === 'edit:time') {
        try {
          await this.finishEdit(ctx, sessionKey, draft.reminderId, {
            scheduleData: { ...draft.scheduleData }
          });
        } catch (err) {
          await ctx.reply(`⚠️ ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
        }
        return true;
      }

      if (state === 'edit:sched_time') {
        try {
          await this.finishEdit(ctx, sessionKey, draft.reminderId, {
            scheduleType: draft.scheduleType,
            scheduleData: { ...draft.scheduleData }
          });
        } catch (err) {
          await ctx.reply(`⚠️ ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
        }
        return true;
      }

      this.sessionRepo.set(sessionKey, 'create:title', draft);
      await this.renderStep(ctx, 'create:title', draft);
      return true;
    }

    // Заголовок
    if (state === 'create:title' || state === 'edit:title') {
      const check = validateTitle(text);
      if (!check.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(check.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      if (state === 'edit:title') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, { title: check.value });
        return true;
      }
      draft.title = check.value;
      this.sessionRepo.set(sessionKey, 'create:description', draft);
      await this.renderStep(ctx, 'create:description', draft);
      return true;
    }

    // Описание (HTML)
    if (state === 'create:description' || state === 'edit:description') {
      const maxLen = draft.photoFileId ? 850 : 3000;
      const check = validateTelegramHtml(text, maxLen);
      if (!check.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(check.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      if (state === 'edit:description') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, { description: check.value });
        return true;
      }
      draft.description = check.value;
      this.sessionRepo.set(sessionKey, 'create:photo', draft);
      await this.renderStep(ctx, 'create:photo', draft);
      return true;
    }

    // Название кнопки со ссылкой
    if (state === 'create:link_title' || state === 'edit:link_title') {
      const check = validateButtonTitle(text);
      if (!check.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(check.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      draft.linkTitle = check.value;
      const nextState = state === 'edit:link_title' ? 'edit:link_url' : 'create:link_url';
      this.sessionRepo.set(sessionKey, nextState, draft);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // URL ссылки
    if (state === 'create:link_url' || state === 'edit:link_url') {
      const check = validateUrl(text);
      if (!check.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(check.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      draft.linkUrl = check.value;
      if (state === 'edit:link_url') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          linkTitle: draft.linkTitle,
          linkUrl: draft.linkUrl
        });
        return true;
      }
      this.sessionRepo.set(sessionKey, 'create:completion', draft);
      await this.renderStep(ctx, 'create:completion', draft);
      return true;
    }

    // Ввод упоминаний вручную
    if (state === 'create:mentions' || state === 'edit:mentions') {
      const { parsed, invalid } = parseManualMentions(text);
      if (parsed.length === 0) {
        await ctx.reply(
          '⚠️ Не удалось распознать упоминания. Укажите <code>@username</code>, Telegram ID (например <code>123456789</code>) или <code>Имя:123456789</code>.',
          { parse_mode: 'HTML' }
        );
        return true;
      }

      draft.mentionsData = mergeMentions(draft.mentionsData, parsed);
      draft.mentionsEnabled = draft.mentionsData.length > 0;
      this.sessionRepo.set(sessionKey, state, draft);

      if (invalid.length > 0) {
        await ctx.reply(
          `⚠️ Часть значений пропущена как некорректная: ${escapeHtml(invalid.join(', '))}`,
          { parse_mode: 'HTML' }
        );
      }

      await this.renderStep(ctx, state, draft);
      return true;
    }

    // Ввод часового пояса на шаге создания
    if (state === 'create:timezone') {
      return this.handleTimezoneTextInput(ctx, {
        sessionKey,
        contextType,
        contextId,
        draft,
        mode: 'create'
      });
    }

    return false;
  }

  async handleTimezoneTextInput(ctx, { sessionKey, contextType, contextId, draft = null, mode }) {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply(
        'Напишите ваш город (например: <code>Пермь</code>, <code>Сочи</code>), разницу с Москвой (например: <code>+2</code>, <code>МСК-1</code>) или текущее время (<code>14:30</code>).',
        { parse_mode: 'HTML' }
      );
      return true;
    }

    const prefix = mode === 'settings' ? 'set:tz_pick' : 'wiz:tz';
    const backCb = mode === 'settings' ? 'set:tz' : 'wiz:tz_page:ru';
    const cancelCb = mode === 'settings' ? null : 'wiz:cancel';

    const lookup = this.timezoneService.smartLookup(text);
    if (lookup.type === 'exact') {
      const res = this.timezoneService.setContextTimezone(contextType, contextId, lookup.timezone);
      if (mode === 'settings') {
        this.sessionRepo.delete(sessionKey);
        await ctx.reply(
          `✅ Часовой пояс обновлён: <b>${escapeHtml(formatTimezoneHuman(res.timezone))}</b>\nПересчитано напоминаний: ${res.recalculatedCount}`,
          { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
        );
      } else {
        draft.timezone = res.timezone;
        this.sessionRepo.set(sessionKey, 'create:preview', draft);
        await this.renderStep(ctx, 'create:preview', draft);
      }
      return true;
    }

    if (lookup.type === 'time_matches' || lookup.type === 'suggestions') {
      const promptText =
        lookup.type === 'time_matches'
          ? '🕒 По вашему времени подходят следующие города. Нажмите на нужный:'
          : '🔎 Возможно, вы имели в виду один из этих городов?';
      await ctx.reply(promptText, {
        reply_markup: timezoneCandidatesKeyboard({
          candidates: lookup.candidates,
          prefix,
          backCb,
          cancelCb
        })
      });
      return true;
    }

    await ctx.reply(
      '⚠️ Город не найден. Выберите пояс кнопкой выше или напишите:\n• крупный город рядом (например: <code>Пермь</code>, <code>Сочи</code>, <code>Берлин</code>)\n• разницу с Москвой (<code>+2</code>, <code>МСК+4</code>, <code>-1</code>)\n• текущее время на ваших часах (<code>14:30</code>)',
      { parse_mode: 'HTML' }
    );
    return true;
  }

  async advanceAfterMentions(ctx, sessionKey, draft) {
    const existingTz = this.timezoneService.getContextTimezone(draft.contextType, draft.contextId);
    if (existingTz) {
      draft.timezone = existingTz;
      this.sessionRepo.set(sessionKey, 'create:preview', draft);
      await this.renderStep(ctx, 'create:preview', draft);
    } else {
      this.sessionRepo.set(sessionKey, 'create:timezone', draft);
      await this.renderStep(ctx, 'create:timezone', draft);
    }
  }

  async finishEdit(ctx, sessionKey, reminderId, patch) {
    const updated = this.reminderService.updateReminder(reminderId, patch);
    this.sessionRepo.delete(sessionKey);
    await renderMessage(
      ctx,
      `✅ <b>Изменения сохранены!</b>\n\n${formatReminderDetails(updated)}`,
      { reply_markup: reminderManageKeyboard(updated) }
    );
  }

  async renderStep(ctx, state, draft) {
    const isEdit = draft.mode === 'edit';

    switch (state) {
      case 'create:schedule_type':
      case 'edit:sched_type':
        await renderMessage(ctx, '📅 <b>Шаг 1. Выберите тип расписания:</b>', {
          reply_markup: scheduleTypeKeyboard({
            backCb: isEdit ? 'wiz:back' : null,
            cancelCb: 'wiz:cancel'
          })
        });
        break;

      case 'create:schedule_days':
      case 'edit:days':
      case 'edit:sched_days':
        await renderMessage(
          ctx,
          '📆 <b>Выберите один или несколько дней недели</b> и нажмите «Продолжить»:',
          {
            reply_markup: weekdaysKeyboard(draft.scheduleData?.days || [], {
              backCb: 'wiz:back',
              cancelCb: 'wiz:cancel'
            })
          }
        );
        break;

      case 'create:schedule_date':
      case 'edit:date':
      case 'edit:sched_date':
        await renderMessage(
          ctx,
          '📆 <b>Введите дату</b> в формате <code>ДД.ММ.ГГГГ</code> или <code>ГГГГ-ММ-ДД</code> (например, <code>25.12.2026</code>):',
          { reply_markup: stepControlsKeyboard({ backCb: 'wiz:back', cancelCb: 'wiz:cancel' }) }
        );
        break;

      case 'create:schedule_time':
      case 'edit:time':
      case 'edit:sched_time':
        await renderMessage(
          ctx,
          '🕒 <b>Введите время отправки</b> в формате <code>ЧЧ:ММ</code> (например, <code>09:00</code> или <code>18:30</code>):',
          { reply_markup: stepControlsKeyboard({ backCb: 'wiz:back', cancelCb: 'wiz:cancel' }) }
        );
        break;

      case 'create:title':
      case 'edit:title':
        await renderMessage(ctx, '📝 <b>Введите заголовок напоминания</b> (обязательно, до 200 символов):', {
          reply_markup: stepControlsKeyboard({ backCb: 'wiz:back', cancelCb: 'wiz:cancel' })
        });
        break;

      case 'create:description':
      case 'edit:description':
        await renderMessage(
          ctx,
          '📄 <b>Введите описание</b> (необязательно).\n\nПоддерживается HTML-разметка Telegram:\n<code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;u&gt;</code>, <code>&lt;s&gt;</code>, <code>&lt;code&gt;</code>, <code>&lt;pre&gt;</code>, <code>&lt;a href="https://..."&gt;</code>.',
          {
            reply_markup: stepControlsKeyboard({
              skipCb: isEdit ? null : 'wiz:skip_desc',
              clearCb: isEdit ? 'wiz:clear_desc' : null,
              backCb: 'wiz:back',
              cancelCb: 'wiz:cancel'
            })
          }
        );
        break;

      case 'create:photo':
      case 'edit:photo':
        await renderMessage(ctx, '🖼 <b>Отправьте одну фотографию</b> для напоминания (или пропустите шаг):', {
          reply_markup: stepControlsKeyboard({
            skipCb: isEdit ? null : 'wiz:skip_photo',
            clearCb: isEdit ? 'wiz:clear_photo' : null,
            backCb: 'wiz:back',
            cancelCb: 'wiz:cancel'
          })
        });
        break;

      case 'create:link_ask':
        await renderMessage(ctx, '🔗 <b>Добавить кнопку со ссылкой к напоминанию?</b>', {
          reply_markup: booleanChoiceKeyboard({
            yesText: '🔗 Добавить ссылку',
            yesCb: 'wiz:link_yes',
            noText: '⏭ Пропустить',
            noCb: 'wiz:link_no'
          })
        });
        break;

      case 'create:link_title':
      case 'edit:link_title':
        await renderMessage(
          ctx,
          '🔗 <b>Введите текст для кнопки со ссылкой</b> (например, <code>Открыть инструкцию</code>):',
          {
            reply_markup: stepControlsKeyboard({
              clearCb: isEdit ? 'wiz:clear_link' : null,
              backCb: 'wiz:back',
              cancelCb: 'wiz:cancel'
            })
          }
        );
        break;

      case 'create:link_url':
      case 'edit:link_url':
        await renderMessage(
          ctx,
          '🌐 <b>Введите URL ссылки</b> (должна начинаться с <code>https://</code> или <code>http://</code>):',
          { reply_markup: stepControlsKeyboard({ backCb: 'wiz:back', cancelCb: 'wiz:cancel' }) }
        );
        break;

      case 'create:completion':
        await renderMessage(
          ctx,
          '✅ <b>Включить кнопку «Выполнено»?</b>\n\nПри нажатии в группе бот покажет список выполнивших участников.',
          {
            reply_markup: booleanChoiceKeyboard({
              yesText: '✅ Включить',
              yesCb: 'wiz:comp_yes',
              noText: '✖️ Не включать',
              noCb: 'wiz:comp_no'
            })
          }
        );
        break;

      case 'create:mentions':
      case 'edit:mentions': {
        const knownUsers =
          draft.contextType === 'group' ? this.chatRepo.getKnownUsers(draft.contextId, 10) : [];
        const currentText = formatMentionsPreview(draft.mentionsData);
        const groupHint =
          knownUsers.length > 0
            ? '\n\nВыберите участников из списка ниже (пользователи, взаимодействовавшие с ботом в чате) или отправьте вручную <code>@username</code> / Telegram ID.'
            : '\n\nПри необходимости отправьте <code>@username</code>, Telegram ID (например <code>123456789</code>) или <code>Имя:123456789</code>, либо нажмите «Продолжить».';

        await renderMessage(
          ctx,
          `👥 <b>Упоминания (необязательно)</b>\nВыбрано: ${currentText}${groupHint}`,
          {
            reply_markup: mentionsStepKeyboard({
              knownUsers,
              selectedMentions: draft.mentionsData || []
            })
          }
        );
        break;
      }

      case 'create:timezone':
        await renderMessage(
          ctx,
          '🌍 <b>Настройка часового пояса</b>\n\nНажмите кнопку с вашим временем на часах или напишите в чат:\n• <b>Город</b> (например: <code>Пермь</code>, <code>Сочи</code>, <code>Берлин</code>)\n• <b>Разницу с Москвой</b> (например: <code>+2</code>, <code>МСК+4</code>, <code>-1</code>)\n• <b>Ваше текущее время</b> (например: <code>14:30</code>)',
          {
            reply_markup: timezoneSelectionKeyboard({
              prefix: 'wiz:tz',
              pagePrefix: 'wiz:tz_page',
              page: draft.tzPage || 'ru',
              backCb: 'wiz:back',
              cancelCb: 'wiz:cancel'
            })
          }
        );
        break;

      case 'create:preview': {
        const nextRunAt = computeNextRunAt({
          scheduleType: draft.scheduleType,
          scheduleData: draft.scheduleData,
          timezone: draft.timezone
        });
        const schedSummary = formatScheduleSummary(
          draft.scheduleType,
          draft.scheduleData,
          draft.timezone
        );
        const lines = [
          '🔎 <b>Предварительный просмотр напоминания</b>',
          '',
          `📌 <b>Заголовок:</b> ${escapeHtml(draft.title)}`,
          `📅 <b>Расписание:</b> ${escapeHtml(schedSummary)}`,
          `🕒 <b>Ближайшая отправка:</b> ${escapeHtml(formatUtcInTimezone(nextRunAt, draft.timezone))}`,
          `📄 <b>Описание:</b> ${draft.description ? `\n${draft.description}` : 'нет'}`,
          `🖼 <b>Фотография:</b> ${draft.photoFileId ? 'прикреплена ✅' : 'нет'}`,
          `🔗 <b>Кнопка-ссылка:</b> ${draft.linkTitle ? `${escapeHtml(draft.linkTitle)} (${escapeHtml(draft.linkUrl)})` : 'нет'}`,
          `✅ <b>Кнопка «Выполнено»:</b> ${draft.completionEnabled ? 'включена' : 'выключена'}`,
          `👥 <b>Упоминания:</b> ${formatMentionsPreview(draft.mentionsData)}`
        ];

        await renderMessage(ctx, lines.join('\n'), {
          reply_markup: previewConfirmKeyboard()
        });
        break;
      }

      default:
        break;
    }
  }
}
