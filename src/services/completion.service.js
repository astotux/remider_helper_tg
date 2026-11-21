export class CompletionService {
  constructor({ db, occurrenceRepo, completionRepo, deliveryService, logger = null }) {
    this.db = db;
    this.occurrenceRepo = occurrenceRepo;
    this.completionRepo = completionRepo;
    this.deliveryService = deliveryService;
    this.logger = logger;
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

    const action = this.db.transaction(() => {
      const existing = this.completionRepo.findByOccurrenceAndUser(occurrence.id, user.id);
      if (existing) {
        this.completionRepo.removeCompletion(occurrence.id, user.id);
        return 'removed';
      }
      this.completionRepo.addCompletion({
        reminderId: reminder.id,
        occurrenceId: occurrence.id,
        userTelegramId: user.id,
        username: user.username || null,
        firstName: user.first_name || 'Пользователь'
      });
      return 'added';
    })();

    const completions = this.completionRepo.listByOccurrence(occurrence.id);
    await this.deliveryService.refreshOccurrenceMessage(occurrence.id);

    this.logger?.debug('Обновлена отметка выполнения', {
      occurrenceId: occurrence.id,
      userId: user.id,
      action,
      totalCompletions: completions.length
    });

    return {
      ok: true,
      action,
      total: completions.length
    };
  }
}
