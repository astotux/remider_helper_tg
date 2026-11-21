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
  dateQuickPickKeyboard,
  mainMenuKeyboard,
  mentionsStepKeyboard,
  previewConfirmKeyboard,
  reminderEditFieldKeyboard,
  reminderManageKeyboard,
  repeatAskKeyboard,
  repeatCompletionKeyboard,
  repeatDurationKeyboard,
  repeatStepKeyboard,
  scheduleTypeKeyboard,
  stepControlsKeyboard,
  timezoneCandidatesKeyboard,
  timezoneSelectionKeyboard,
  weekdaysKeyboard
} from '../keyboards/menus.keyboard.js';
import { renderMessage, safeAnswerCbQuery } from '../telegram.adapter.js';

function formatStopConditionLabel({ completionEnabled, stopOnComplete, stopMode, requiredCompletions }) {
  if (!completionEnabled) return 'выключена';
  if (!stopOnComplete) return 'включена (не останавливает повторы)';
  switch (stopMode) {
    case 'all_members':
      return 'включена (остановит повторы, когда выполнят все в чате)';
    case 'mentioned':
      return 'включена (остановит повторы, когда выполнят упомянутые)';
    case 'custom_count':
      return `включена (остановит повторы после ${requiredCompletions || 1} чел.)`;
    case 'any_one':
    default:
      return 'включена (остановит повторы после 1-го выполнения)';
  }
}

function parseIntervalMinutesInput(text) {
  const s = String(text || '').trim().toLowerCase().replace(',', '.');
  const hourMatch = /^(\d+(?:\.\d+)?)\s*(?:ч|час|часа|часов|h)$/i.exec(s);
  if (hourMatch) {
    const mins = Math.round(Number.parseFloat(hourMatch[1]) * 60);
    if (mins >= 1 && mins <= 1440) return { valid: true, value: mins };
    return { valid: false, error: 'Интервал должен быть от 1 минуты до 24 часов.' };
  }
  const minMatch = /^(\d+)\s*(?:м|мин|минут|минуты|m)?$/i.exec(s);
  if (minMatch) {
    const mins = Number.parseInt(minMatch[1], 10);
    if (mins >= 1 && mins <= 1440) return { valid: true, value: mins };
    return { valid: false, error: 'Интервал должен быть от 1 до 1440 минут (24 часа).' };
  }
  return {
    valid: false,
    error: 'Укажите интервал в минутах (например, <code>15</code>, <code>45</code>) или часах (<code>2ч</code>).'
  };
}

function parseDurationMinutesInput(text, scheduleType = 'once') {
  const s = String(text || '').trim().toLowerCase().replace(',', '.');
  const maxDur = scheduleType === 'once' ? 10080 : 1439;
  const minMatch = /^(\d+)\s*(?:м|мин|минут|минуты|m)$/i.exec(s);
  if (minMatch) {
    const mins = Number.parseInt(minMatch[1], 10);
    if (mins >= 1 && mins <= maxDur) return { valid: true, value: mins };
    return {
      valid: false,
      error:
        scheduleType === 'once'
          ? 'Длительность должна быть от 1 минуты до 7 дней.'
          : 'Для повторяющегося расписания длительность окна должна быть меньше 24 часов.'
    };
  }
  const hourMatch = /^(\d+(?:\.\d+)?)\s*(?:ч|час|часа|часов|h)?$/i.exec(s);
  if (hourMatch) {
    const mins = Math.round(Number.parseFloat(hourMatch[1]) * 60);
    if (mins >= 1 && mins <= maxDur) return { valid: true, value: mins };
    return {
      valid: false,
      error:
        scheduleType === 'once'
          ? 'Длительность должна быть от 1 минуты до 7 дней (168 часов).'
          : 'Для повторяющегося расписания длительность окна должна быть до 23 часов.'
    };
  }
  return {
    valid: false,
    error: 'Укажите длительность в часах (например, <code>5</code> или <code>1.5ч</code>) либо минутах (<code>90м</code>).'
  };
}

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

  if (reminder.series_id && reminder.series_ends_at) {
    lines.push(
      `Текущее окно повторов до: <b>${escapeHtml(formatUtcInTimezone(reminder.series_ends_at, reminder.timezone))}</b>`
    );
  }

  if (reminder.description) {
    lines.push(`Описание: добавлено (${reminder.description.length} симв.)`);
  }
  if (reminder.photo_file_id) {
    lines.push('Фотография: прикреплена 🖼');
  }
  if (reminder.link_title && reminder.link_url) {
    lines.push(`Кнопка-ссылка: ${escapeHtml(reminder.link_title)} (${escapeHtml(reminder.link_url)})`);
  }
  lines.push(
    `Кнопка «Выполнено»: ${formatStopConditionLabel({
      completionEnabled: reminder.completion_enabled,
      stopOnComplete: reminder.stop_on_complete,
      stopMode: reminder.stop_mode,
      requiredCompletions: reminder.required_completions
    })}`
  );

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
    onReminderActivated = null,
    logger = null
  }) {
    this.sessionRepo = sessionRepo;
    this.chatRepo = chatRepo;
    this.reminderService = reminderService;
    this.timezoneService = timezoneService;
    this.permissionService = permissionService;
    this.onReminderActivated = onReminderActivated;
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
      stopOnComplete: false,
      stopMode: 'none',
      requiredCompletions: null,
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

    const hasRepeat = Boolean(reminder.schedule_data?.repeat);

    if (field === 'completion' && !hasRepeat) {
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
      scheduleData: {
        ...reminder.schedule_data,
        repeat: reminder.schedule_data?.repeat ? { ...reminder.schedule_data.repeat } : null
      },
      timezone: reminder.timezone,
      completionEnabled: reminder.completion_enabled,
      stopOnComplete: reminder.stop_on_complete,
      stopMode: reminder.stop_mode,
      requiredCompletions: reminder.required_completions,
      mentionsData: [...(reminder.mentions_data || [])],
      linkTitle: reminder.link_title,
      linkUrl: reminder.link_url
    };

    const stateMap = {
      title: 'edit:title',
      description: 'edit:description',
      photo: 'edit:photo',
      link: 'edit:link_title',
      completion: 'edit:completion',
      mentions: 'edit:mentions',
      time: 'edit:time',
      days: 'edit:days',
      date: 'edit:date',
      sched: 'edit:sched_type',
      repeat: 'edit:repeat_ask'
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
      case 'create:repeat_ask':
        return 'create:schedule_time';
      case 'create:repeat_step':
        return 'create:repeat_ask';
      case 'create:repeat_duration':
        return 'create:repeat_step';
      case 'create:title':
        return draft.scheduleData?.repeat ? 'create:repeat_duration' : 'create:repeat_ask';
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
      case 'create:stop_count':
        return 'create:completion';
      case 'create:mentions':
        return draft.stopMode === 'custom_count' ? 'create:stop_count' : 'create:completion';
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
        if (state === 'edit:sched_repeat_ask') {
          this.sessionRepo.set(sessionKey, 'edit:sched_time', draft);
          await this.renderStep(ctx, 'edit:sched_time', draft);
          return true;
        }
        if (state === 'edit:repeat_step' || state === 'edit:sched_repeat_step') {
          const prev = state === 'edit:sched_repeat_step' ? 'edit:sched_repeat_ask' : 'edit:repeat_ask';
          this.sessionRepo.set(sessionKey, prev, draft);
          await this.renderStep(ctx, prev, draft);
          return true;
        }
        if (state === 'edit:repeat_dur' || state === 'edit:sched_repeat_dur') {
          const prev = state === 'edit:sched_repeat_dur' ? 'edit:sched_repeat_step' : 'edit:repeat_step';
          this.sessionRepo.set(sessionKey, prev, draft);
          await this.renderStep(ctx, prev, draft);
          return true;
        }
        if (state === 'edit:stop_count') {
          this.sessionRepo.set(sessionKey, 'edit:completion', draft);
          await this.renderStep(ctx, 'edit:completion', draft);
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

    // Выбор базового типа расписания (daily / weekly / once)
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
      const prevRepeat = draft.scheduleData?.repeat || null;
      if (type === 'weekly') {
        draft.scheduleData = {
          days: draft.scheduleData?.days || [],
          time: draft.scheduleData?.time || null,
          repeat: prevRepeat
        };
      } else if (type === 'once') {
        draft.scheduleData = {
          date: draft.scheduleData?.date || null,
          time: draft.scheduleData?.time || null,
          repeat: prevRepeat
        };
      } else {
        draft.scheduleData = {
          time: draft.scheduleData?.time || null,
          repeat: prevRepeat
        };
      }

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

    // Быстрый выбор даты (Сегодня / Завтра) для одноразового напоминания
    if (
      data.startsWith('wiz:date_pick:') &&
      (state === 'create:schedule_date' || state === 'edit:date' || state === 'edit:sched_date')
    ) {
      const kind = data.slice('wiz:date_pick:'.length);
      const tz = draft.timezone || 'Europe/Moscow';
      const base = DateTime.now().setZone(tz);
      const target = kind === 'tomorrow' ? base.plus({ days: 1 }) : base;
      draft.scheduleData.date = target.toFormat('yyyy-MM-dd');

      await safeAnswerCbQuery(ctx);
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

    // Подтип: повторять ли внутри окна (после ввода времени)
    if (
      (data === 'wiz:rep:no' || data === 'wiz:rep:yes') &&
      (state === 'create:repeat_ask' || state === 'edit:repeat_ask' || state === 'edit:sched_repeat_ask')
    ) {
      await safeAnswerCbQuery(ctx);
      if (data === 'wiz:rep:no') {
        draft.scheduleData.repeat = null;
        if (state === 'edit:repeat_ask' || state === 'edit:sched_repeat_ask') {
          await this.finishEdit(ctx, sessionKey, draft.reminderId, {
            scheduleType: draft.scheduleType,
            scheduleData: { ...draft.scheduleData },
            stopOnComplete: false,
            stopMode: 'none',
            requiredCompletions: null
          });
          return true;
        }
        draft.stopOnComplete = false;
        draft.stopMode = 'none';
        draft.requiredCompletions = null;
        this.sessionRepo.set(sessionKey, 'create:title', draft);
        await this.renderStep(ctx, 'create:title', draft);
        return true;
      }

      draft.scheduleData.repeat = draft.scheduleData.repeat || {
        intervalMinutes: 30,
        durationMinutes: 300
      };
      const nextState =
        state === 'edit:repeat_ask'
          ? 'edit:repeat_step'
          : state === 'edit:sched_repeat_ask'
            ? 'edit:sched_repeat_step'
            : 'create:repeat_step';
      this.sessionRepo.set(sessionKey, nextState, draft);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // Выбор интервала повторов (15 / 30 / 60 / 120 мин)
    if (
      data.startsWith('wiz:rep_step:') &&
      (state === 'create:repeat_step' || state === 'edit:repeat_step' || state === 'edit:sched_repeat_step')
    ) {
      const mins = Number.parseInt(data.slice('wiz:rep_step:'.length), 10);
      if (!Number.isInteger(mins) || mins < 1 || mins > 1440) {
        await safeAnswerCbQuery(ctx, 'Некорректный интервал.', true);
        return true;
      }
      draft.scheduleData.repeat = {
        ...(draft.scheduleData.repeat || {}),
        intervalMinutes: mins
      };
      const nextState =
        state === 'edit:repeat_step'
          ? 'edit:repeat_dur'
          : state === 'edit:sched_repeat_step'
            ? 'edit:sched_repeat_dur'
            : 'create:repeat_duration';
      this.sessionRepo.set(sessionKey, nextState, draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // Выбор длительности окна повторов
    if (
      data.startsWith('wiz:rep_dur:') &&
      (state === 'create:repeat_duration' || state === 'edit:repeat_dur' || state === 'edit:sched_repeat_dur')
    ) {
      const mins = Number.parseInt(data.slice('wiz:rep_dur:'.length), 10);
      const maxDur = draft.scheduleType === 'once' ? 10080 : 1439;
      if (!Number.isInteger(mins) || mins < 0 || mins > maxDur) {
        await safeAnswerCbQuery(ctx, 'Некорректная длительность.', true);
        return true;
      }
      const intervalMins = Number(draft.scheduleData.repeat?.intervalMinutes || 1);
      if (mins > 0 && mins < intervalMins) {
        await safeAnswerCbQuery(
          ctx,
          'Длительность окна не может быть меньше интервала повторов.',
          true
        );
        return true;
      }

      draft.scheduleData.repeat = {
        ...draft.scheduleData.repeat,
        durationMinutes: mins === 0 ? null : mins
      };
      await safeAnswerCbQuery(ctx);

      if (state === 'edit:repeat_dur' || state === 'edit:sched_repeat_dur') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          scheduleType: draft.scheduleType,
          scheduleData: { ...draft.scheduleData }
        });
        return true;
      }

      this.sessionRepo.set(sessionKey, 'create:title', draft);
      await this.renderStep(ctx, 'create:title', draft);
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
      draft.stopOnComplete = false;
      draft.stopMode = 'none';
      draft.requiredCompletions = null;
      this.sessionRepo.set(sessionKey, 'create:mentions', draft);
      await safeAnswerCbQuery(ctx);
      await this.renderStep(ctx, 'create:mentions', draft);
      return true;
    }

    if (data.startsWith('wiz:cm:') && (state === 'create:completion' || state === 'edit:completion')) {
      const mode = data.slice('wiz:cm:'.length);
      if (mode === 'off') {
        draft.completionEnabled = false;
        draft.stopOnComplete = false;
        draft.stopMode = 'none';
        draft.requiredCompletions = null;
      } else if (mode === 'on') {
        draft.completionEnabled = true;
        draft.stopOnComplete = false;
        draft.stopMode = 'none';
        draft.requiredCompletions = null;
      } else if (mode === 'stop_one') {
        draft.completionEnabled = true;
        draft.stopOnComplete = true;
        draft.stopMode = 'any_one';
        draft.requiredCompletions = null;
      } else if (mode === 'stop_all') {
        draft.completionEnabled = true;
        draft.stopOnComplete = true;
        draft.stopMode = 'all_members';
        draft.requiredCompletions = null;
      } else if (mode === 'stop_mentioned') {
        draft.completionEnabled = true;
        draft.stopOnComplete = true;
        draft.stopMode = 'mentioned';
        draft.requiredCompletions = null;
      } else if (mode === 'stop_count') {
        draft.completionEnabled = true;
        draft.stopOnComplete = true;
        draft.stopMode = 'custom_count';
        const nextState = state === 'edit:completion' ? 'edit:stop_count' : 'create:stop_count';
        this.sessionRepo.set(sessionKey, nextState, draft);
        await safeAnswerCbQuery(ctx);
        await this.renderStep(ctx, nextState, draft);
        return true;
      } else {
        await safeAnswerCbQuery(ctx, 'Неизвестный режим.', true);
        return true;
      }

      await safeAnswerCbQuery(ctx);
      if (state === 'edit:completion') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          completionEnabled: draft.completionEnabled,
          stopOnComplete: draft.stopOnComplete,
          stopMode: draft.stopMode,
          requiredCompletions: draft.requiredCompletions
        });
        return true;
      }

      this.sessionRepo.set(sessionKey, 'create:mentions', draft);
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
        this.onReminderActivated?.();
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

    const allowed = await this.permissionService.canManageContext({ contextType, contextId, userId });
    if (!allowed) {
      this.sessionRepo.delete(sessionKey);
      return false;
    }

    if (state === 'settings:tz_input') {
      return this.handleTimezoneTextInput(ctx, {
        sessionKey,
        contextType,
        contextId,
        mode: 'settings'
      });
    }

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

    // Ввод собственного интервала повторов
    if (state === 'create:repeat_step' || state === 'edit:repeat_step' || state === 'edit:sched_repeat_step') {
      const parsed = parseIntervalMinutesInput(text);
      if (!parsed.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(parsed.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      draft.scheduleData.repeat = {
        ...(draft.scheduleData.repeat || {}),
        intervalMinutes: parsed.value
      };
      const nextState =
        state === 'edit:repeat_step'
          ? 'edit:repeat_dur'
          : state === 'edit:sched_repeat_step'
            ? 'edit:sched_repeat_dur'
            : 'create:repeat_duration';
      this.sessionRepo.set(sessionKey, nextState, draft);
      await this.renderStep(ctx, nextState, draft);
      return true;
    }

    // Ввод собственной длительности окна повторов
    if (state === 'create:repeat_duration' || state === 'edit:repeat_dur' || state === 'edit:sched_repeat_dur') {
      const parsed = parseDurationMinutesInput(text, draft.scheduleType);
      if (!parsed.valid) {
        await ctx.reply(`⚠️ ${escapeHtml(parsed.error)}`, { parse_mode: 'HTML' });
        return true;
      }
      const intervalMins = Number(draft.scheduleData.repeat?.intervalMinutes || 1);
      if (parsed.value < intervalMins) {
        await ctx.reply('⚠️ Длительность окна не может быть меньше интервала повторов.');
        return true;
      }
      draft.scheduleData.repeat = {
        ...draft.scheduleData.repeat,
        durationMinutes: parsed.value
      };
      if (state === 'edit:repeat_dur' || state === 'edit:sched_repeat_dur') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          scheduleType: draft.scheduleType,
          scheduleData: { ...draft.scheduleData }
        });
        return true;
      }
      this.sessionRepo.set(sessionKey, 'create:title', draft);
      await this.renderStep(ctx, 'create:title', draft);
      return true;
    }

    // Ввод точного количества отметок выполнения для остановки повторов
    if (state === 'create:stop_count' || state === 'edit:stop_count') {
      const num = Number.parseInt(text.trim(), 10);
      if (!Number.isInteger(num) || num < 1 || num > 1000) {
        await ctx.reply('⚠️ Укажите целое число участников от 1 до 1000.');
        return true;
      }
      draft.requiredCompletions = num;
      if (state === 'edit:stop_count') {
        await this.finishEdit(ctx, sessionKey, draft.reminderId, {
          completionEnabled: true,
          stopOnComplete: true,
          stopMode: 'custom_count',
          requiredCompletions: num
        });
        return true;
      }
      this.sessionRepo.set(sessionKey, 'create:mentions', draft);
      await this.renderStep(ctx, 'create:mentions', draft);
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
        this.sessionRepo.set(sessionKey, 'edit:sched_repeat_ask', draft);
        await this.renderStep(ctx, 'edit:sched_repeat_ask', draft);
        return true;
      }

      this.sessionRepo.set(sessionKey, 'create:repeat_ask', draft);
      await this.renderStep(ctx, 'create:repeat_ask', draft);
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
          '📆 <b>Выберите дату</b> кнопкой или введите вручную в формате <code>ДД.ММ.ГГГГ</code> (например, <code>25.12.2026</code>):',
          { reply_markup: dateQuickPickKeyboard({ backCb: 'wiz:back', cancelCb: 'wiz:cancel' }) }
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

      case 'create:repeat_ask':
      case 'edit:repeat_ask':
      case 'edit:sched_repeat_ask':
        await renderMessage(
          ctx,
          '🔁 <b>Повторять напоминание, если его ещё не выполнили?</b>\n\nМожно настроить повторную отправку каждые 15 мин, 30 мин или 1 час в течение нужного времени (например, 5 часов).',
          { reply_markup: repeatAskKeyboard() }
        );
        break;

      case 'create:repeat_step':
      case 'edit:repeat_step':
      case 'edit:sched_repeat_step':
        await renderMessage(
          ctx,
          '⏱ <b>Как часто повторять напоминание?</b>\n\nВыберите готовый вариант или отправьте интервал текстом (например, <code>10</code> мин или <code>2ч</code>):',
          { reply_markup: repeatStepKeyboard() }
        );
        break;

      case 'create:repeat_duration':
      case 'edit:repeat_dur':
      case 'edit:sched_repeat_dur':
        await renderMessage(
          ctx,
          '⏳ <b>В течение какого времени повторять напоминание?</b>\n\nВыберите длительность кнопкой или напишите в чат (например, <code>5</code> часов или <code>90м</code>):',
          { reply_markup: repeatDurationKeyboard({ scheduleType: draft.scheduleType }) }
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
      case 'edit:completion':
        if (draft.scheduleData?.repeat) {
          const hint =
            draft.contextType === 'group'
              ? 'Кнопка «✅ Выполнено» будет общей для всех повторных сообщений серии. Выберите, когда останавливать повторы:'
              : 'Кнопка «✅ Выполнено» будет общей для всех повторных сообщений серии. Остановить повторы, когда вы нажмёте «Выполнено»?';
          await renderMessage(ctx, `✅ <b>Отметка «Выполнено» и автоостановка</b>\n\n${hint}`, {
            reply_markup: repeatCompletionKeyboard({
              contextType: draft.contextType,
              hasMentions: Boolean(draft.mentionsData?.length > 0)
            })
          });
        } else {
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
        }
        break;

      case 'create:stop_count':
      case 'edit:stop_count':
        await renderMessage(
          ctx,
          '🔢 <b>Сколько человек должны нажать «✅ Выполнено», чтобы остановить повторы?</b>\n\nОтправьте целое число (например, <code>3</code>):',
          { reply_markup: stepControlsKeyboard({ backCb: 'wiz:back', cancelCb: 'wiz:cancel' }) }
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
          `✅ <b>Кнопка «Выполнено»:</b> ${formatStopConditionLabel({
            completionEnabled: draft.completionEnabled,
            stopOnComplete: draft.stopOnComplete,
            stopMode: draft.stopMode,
            requiredCompletions: draft.requiredCompletions
          })}`,
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
