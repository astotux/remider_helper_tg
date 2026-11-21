const ADMIN_STATUSES = new Set(['creator', 'administrator']);

export class PermissionService {
  constructor({ telegramGateway, logger = null }) {
    this.telegramGateway = telegramGateway;
    this.logger = logger;
  }

  async isGroupAdmin(chatId, userId) {
    try {
      const member = await this.telegramGateway.getChatMember(chatId, userId);
      return Boolean(member && ADMIN_STATUSES.has(member.status));
    } catch (err) {
      this.logger?.warn('Не удалось проверить права администратора через Telegram API', {
        chatId,
        userId,
        error: err.message
      });
      return false;
    }
  }

  async canManageContext({ contextType, contextId, userId }) {
    if (contextType === 'private') {
      return Number(contextId) === Number(userId);
    }
    if (contextType === 'group') {
      return this.isGroupAdmin(contextId, userId);
    }
    return false;
  }

  async canManageReminder(reminder, { contextType, contextId, userId }) {
    if (!reminder || reminder.is_archived) return false;
    if (reminder.context_type !== contextType) return false;
    if (Number(reminder.context_id) !== Number(contextId)) return false;

    if (contextType === 'private') {
      return Number(reminder.owner_telegram_id) === Number(userId);
    }
    if (contextType === 'group') {
      return this.isGroupAdmin(contextId, userId);
    }
    return false;
  }
}
