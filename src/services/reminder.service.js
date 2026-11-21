import { DateTime } from 'luxon';
import { computeNextRunAt, isValidTimezone } from '../utils/date.utils.js';
import {
  validateButtonTitle,
  validateTelegramHtml,
  validateTitle,
  validateUrl
} from '../utils/validation.utils.js';

export class ReminderService {
  constructor({ db, reminderRepo, occurrenceRepo, queueRepo, chatRepo, logger = null }) {
    this.db = db;
    this.reminderRepo = reminderRepo;
    this.occurrenceRepo = occurrenceRepo;
    this.queueRepo = queueRepo;
    this.chatRepo = chatRepo;
    this.logger = logger;
  }

  validateDraft(draft) {
    const titleCheck = validateTitle(draft.title);
    if (!titleCheck.valid) {
      throw new Error(titleCheck.error);
    }

    let description = null;
    if (draft.description) {
      const maxDescLen = draft.photoFileId ? 850 : 3000;
      const htmlCheck = validateTelegramHtml(draft.description, maxDescLen);
      if (!htmlCheck.valid) {
        throw new Error(htmlCheck.error);
      }
      description = htmlCheck.value;
    }

    let linkTitle = null;
    let linkUrl = null;
    if (draft.linkTitle || draft.linkUrl) {
      const btnCheck = validateButtonTitle(draft.linkTitle);
      if (!btnCheck.valid) throw new Error(btnCheck.error);
      const urlCheck = validateUrl(draft.linkUrl);
      if (!urlCheck.valid) throw new Error(urlCheck.error);
      linkTitle = btnCheck.value;
      linkUrl = urlCheck.value;
    }

    if (!isValidTimezone(draft.timezone)) {
      throw new Error('Некорректный часовой пояс.');
    }

    if (!['once', 'daily', 'weekly'].includes(draft.scheduleType)) {
      throw new Error('Некорректный тип расписания.');
    }

    const nowUtc = DateTime.utc();
    const nextRunAt = computeNextRunAt({
      scheduleType: draft.scheduleType,
      scheduleData: draft.scheduleData,
      timezone: draft.timezone,
      fromUtc: nowUtc,
      inclusive: false
    });

    if (draft.scheduleType === 'once') {
      const target = DateTime.fromISO(nextRunAt, { zone: 'utc' });
      if (target <= nowUtc) {
        throw new Error('Указанные дата и время уже прошли. Выберите время в будущем.');
      }
    }

    return {
      title: titleCheck.value,
      description,
      photoFileId: draft.photoFileId || null,
      linkTitle,
      linkUrl,
      completionEnabled: Boolean(draft.completionEnabled),
      mentionsEnabled: Boolean(draft.mentionsEnabled),
      mentionsData: Array.isArray(draft.mentionsData) ? draft.mentionsData : [],
      scheduleType: draft.scheduleType,
      scheduleData: draft.scheduleData,
      timezone: draft.timezone,
      nextRunAt
    };
  }

  createReminder(draft) {
    const validated = this.validateDraft(draft);
    const created = this.reminderRepo.create({
      ownerTelegramId: draft.ownerTelegramId,
      contextType: draft.contextType,
      contextId: draft.contextId,
      ...validated,
      isActive: true
    });

    this.logger?.info('Создано напоминание', {
      reminderId: created.id,
      contextType: created.context_type,
      contextId: created.context_id,
      scheduleType: created.schedule_type,
      nextRunAt: created.next_run_at
    });

    return created;
  }

  getById(id) {
    return this.reminderRepo.findById(id);
  }

  listByContext(contextType, contextId) {
    return this.reminderRepo.listByContext(contextType, contextId, { includeArchived: false });
  }

  updateReminder(reminderId, patch) {
    const existing = this.reminderRepo.findById(reminderId);
    if (!existing || existing.is_archived) {
      throw new Error('Напоминание не найдено.');
    }

    const merged = {
      title: 'title' in patch ? patch.title : existing.title,
      description: 'description' in patch ? patch.description : existing.description,
      photoFileId: 'photoFileId' in patch ? patch.photoFileId : existing.photo_file_id,
      linkTitle: 'linkTitle' in patch ? patch.linkTitle : existing.link_title,
      linkUrl: 'linkUrl' in patch ? patch.linkUrl : existing.link_url,
      completionEnabled:
        'completionEnabled' in patch ? patch.completionEnabled : existing.completion_enabled,
      mentionsEnabled:
        'mentionsEnabled' in patch ? patch.mentionsEnabled : existing.mentions_enabled,
      mentionsData: 'mentionsData' in patch ? patch.mentionsData : existing.mentions_data,
      scheduleType: 'scheduleType' in patch ? patch.scheduleType : existing.schedule_type,
      scheduleData: 'scheduleData' in patch ? patch.scheduleData : existing.schedule_data,
      timezone: 'timezone' in patch ? patch.timezone : existing.timezone
    };

    const validated = this.validateDraft(merged);

    const updated = this.reminderRepo.update(reminderId, {
      ...validated,
      nextRunAt: existing.is_active ? validated.nextRunAt : existing.next_run_at
    });

    this.logger?.info('Обновлено напоминание', {
      reminderId,
      nextRunAt: updated.next_run_at
    });

    return updated;
  }

  toggleActive(reminderId) {
    const existing = this.reminderRepo.findById(reminderId);
    if (!existing || existing.is_archived) {
      throw new Error('Напоминание не найдено.');
    }

    if (existing.is_active) {
      const tx = this.db.transaction(() => {
        this.queueRepo.cancelByReminder(reminderId);
        this.occurrenceRepo.cancelPendingByReminder(reminderId);
        return this.reminderRepo.update(reminderId, { isActive: false });
      });
      return tx();
    }

    const nowUtc = DateTime.utc();
    const nextRunAt = computeNextRunAt({
      scheduleType: existing.schedule_type,
      scheduleData: existing.schedule_data,
      timezone: existing.timezone,
      fromUtc: nowUtc,
      inclusive: false
    });

    if (existing.schedule_type === 'once' && DateTime.fromISO(nextRunAt, { zone: 'utc' }) <= nowUtc) {
      throw new Error(
        'Время этого одноразового напоминания уже прошло. Измените дату и время перед возобновлением.'
      );
    }

    return this.reminderRepo.update(reminderId, {
      isActive: true,
      nextRunAt
    });
  }

  deleteReminder(reminderId) {
    const tx = this.db.transaction(() => {
      this.queueRepo.cancelByReminder(reminderId);
      this.occurrenceRepo.cancelPendingByReminder(reminderId);
      return this.reminderRepo.delete(reminderId);
    });
    const deleted = tx();
    if (deleted) {
      this.logger?.info('Удалено напоминание', { reminderId });
    }
    return deleted;
  }

  handleBotRemovedFromGroup(chatId) {
    const tx = this.db.transaction(() => {
      this.chatRepo.setActive(chatId, false);
      const paused = this.reminderRepo.deactivateByContext('group', chatId);
      const cancelledOcc = this.occurrenceRepo.cancelPendingByChat(chatId);
      const cancelledQueue = this.queueRepo.cancelByChat(chatId);
      return { paused, cancelledOcc, cancelledQueue };
    });

    const stats = tx();
    this.logger?.info('Бот удалён из группы, данные и расписания деактивированы', {
      chatId,
      ...stats
    });
    return stats;
  }

  handleChatMigration(oldChatId, newChatId) {
    this.chatRepo.migrateChatId(oldChatId, newChatId);
    this.logger?.info('Выполнена миграция чата в супергруппу', { oldChatId, newChatId });
  }
}
