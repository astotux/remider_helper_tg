import { buildCompletionSyncKey } from '../database/repositories/completion.repository.js';

export class CompletionService {
  constructor({
    db,
    occurrenceRepo,
    completionRepo,
    deliveryService,
    reminderService = null,
    telegramGateway = null,
    logger = null
  }) {
    this.db = db;
    this.occurrenceRepo = occurrenceRepo;
    this.completionRepo = completionRepo;
    this.deliveryService = deliveryService;
    this.reminderService = reminderService;
    this.telegramGateway = telegramGateway;
    this.logger = logger;
  }

  async resolveRequiredCompletions(reminder, chatId) {
    if (!reminder.stop_on_complete) return null;

    if (reminder.context_type === 'private' || reminder.stop_mode === 'any_one') {
      return 1;
    }

    if (reminder.stop_mode === 'custom_count') {
      return Math.max(1, Number(reminder.required_completions) || 1);
    }

    if (reminder.stop_mode === 'mentioned') {
      return Math.max(1, reminder.mentions_data?.length || 1);
    }

    if (reminder.stop_mode === 'all_members') {
      if (this.telegramGateway?.getChatMemberCount) {
        try {
          const total = await this.telegramGateway.getChatMemberCount(chatId);
          // Вычитаем самого бота из общего числа участников чата
          return Math.max(1, Number(total) - 1);
        } catch (err) {
          this.logger?.warn('Не удалось получить число участников чата, используется запасное значение', {
            chatId,
            error: err.message
          });
        }
      }
      return Math.max(1, Number(reminder.required_completions) || 1);
    }

    return 1;
  }

  async toggleCompletion({ occurrenceId, chatId, user }) {
    const joined = this.occurrenceRepo.findWithReminder(occurrenceId);
    if (!joined) {
      return { ok: false, reason: 'Напоминание не найдено или уже удалено.' };
    }

    const { occurrence, reminder } = joined;
    if (!reminder.completion_enabled) {
      return { ok: false, reason: 'Для этого напоминания отметка выполнения отключена.' };
    }

    if (Number(occurrence.chat_id) !== Number(chatId)) {
      return { ok: false, reason: 'Недопустимый контекст чата.' };
    }

    const syncKey = buildCompletionSyncKey(occurrence);

    const action = this.db.transaction(() => {
      const existing = this.completionRepo.findBySyncKeyAndUser(syncKey, user.id);
      if (existing) {
        this.completionRepo.removeCompletionBySyncKey(syncKey, user.id);
        return 'removed';
      }
      this.completionRepo.addCompletion({
        reminderId: reminder.id,
        occurrenceId: occurrence.id,
        syncKey,
        userTelegramId: user.id,
        username: user.username || null,
        firstName: user.first_name || 'Пользователь'
      });
      return 'added';
    })();

    const completions = this.completionRepo.listBySyncKey(syncKey);

    if (occurrence.series_id) {
      await this.deliveryService.refreshSeriesMessages(occurrence.series_id);
    } else {
      await this.deliveryService.refreshOccurrenceMessage(occurrence.id);
    }

    let seriesStopped = false;
    if (action === 'added' && reminder.stop_on_complete && reminder.is_active && this.reminderService) {
      const required = await this.resolveRequiredCompletions(reminder, chatId);
      if (required !== null && completions.length >= required) {
        this.reminderService.completeAndStopSeries(reminder.id);
        seriesStopped = true;
      }
    }

    this.logger?.debug('Обновлена отметка выполнения', {
      occurrenceId: occurrence.id,
      syncKey,
      userId: user.id,
      action,
      totalCompletions: completions.length,
      seriesStopped
    });

    return {
      ok: true,
      action,
      total: completions.length,
      seriesStopped
    };
  }
}
