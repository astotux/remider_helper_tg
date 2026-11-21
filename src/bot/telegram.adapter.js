export class TelegrafGateway {
  constructor(telegram) {
    this.telegram = telegram;
  }

  async getChatMember(chatId, userId) {
    return this.telegram.getChatMember(chatId, userId);
  }

  async getChatMemberCount(chatId) {
    return this.telegram.getChatMemberCount(chatId);
  }

  async sendMessage(chatId, text, extra = {}) {
    return this.telegram.sendMessage(chatId, text, extra);
  }

  async sendPhoto(chatId, fileId, extra = {}) {
    return this.telegram.sendPhoto(chatId, fileId, extra);
  }

  async editMessageText(chatId, messageId, text, extra = {}) {
    return this.telegram.editMessageText(chatId, messageId, undefined, text, extra);
  }

  async editMessageCaption(chatId, messageId, caption, extra = {}) {
    return this.telegram.editMessageCaption(chatId, messageId, undefined, caption, extra);
  }
}

export async function safeAnswerCbQuery(ctx, text = undefined, showAlert = false) {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCbQuery(text, { show_alert: showAlert });
  } catch {
    // Игнорируем ошибку протухшего callback_query
  }
}

export async function renderMessage(ctx, text, extra = {}) {
  const payload = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  };

  if (ctx.callbackQuery?.message && !ctx.callbackQuery.message.photo) {
    try {
      return await ctx.editMessageText(text, payload);
    } catch (err) {
      const msg = String(err?.description || err?.message || '');
      if (msg.includes('message is not modified')) {
        return ctx.callbackQuery.message;
      }
      // Если редактирование невозможно, отправляем новое сообщение
    }
  }

  return ctx.reply(text, payload);
}
