import { buildCompletionSyncKey } from '../database/repositories/completion.repository.js';
import { escapeHtml } from '../utils/validation.utils.js';

function formatMentionTag(mention) {
  if (mention.username) {
    const clean = String(mention.username).replace(/^@+/, '');
    return `@${escapeHtml(clean)}`;
  }
  if (mention.telegramId) {
    const name = escapeHtml(mention.firstName || 'Пользователь');
    return `<a href="tg://user?id=${Number(mention.telegramId)}">${name}</a>`;
  }
  return '';
}

function formatCompletionLine(completion) {
  if (completion.username) {
    return `- @${escapeHtml(completion.username)}`;
  }
  return `- ${escapeHtml(completion.first_name || 'Пользователь')}`;
}

export class DeliveryService {
  constructor({ telegramGateway, occurrenceRepo, completionRepo, logger = null }) {
    this.telegramGateway = telegramGateway;
    this.occurrenceRepo = occurrenceRepo;
    this.completionRepo = completionRepo;
    this.logger = logger;
  }

  buildInlineKeyboard(reminder, occurrenceId = null) {
    const rows = [];

    if (reminder.link_title && reminder.link_url) {
      rows.push([{ text: reminder.link_title, url: reminder.link_url }]);
    }

    if (reminder.completion_enabled && occurrenceId) {
      rows.push([{ text: '✅ Выполнено', callback_data: `cmp:${occurrenceId}` }]);
    }

    return rows.length > 0 ? { inline_keyboard: rows } : undefined;
  }

  buildReminderText(reminder, completions = []) {
    const maxLen = reminder.photo_file_id ? 1024 : 4096;
    const parts = [`⏰ <b>${escapeHtml(reminder.title)}</b>`];

    if (reminder.description) {
      parts.push(reminder.description);
    }

    if (reminder.mentions_enabled && Array.isArray(reminder.mentions_data) && reminder.mentions_data.length > 0) {
      const tags = reminder.mentions_data.map(formatMentionTag).filter(Boolean);
      if (tags.length > 0) {
        parts.push(`👥 ${tags.join(' ')}`);
      }
    }

    let baseText = parts.join('\n\n');

    if (reminder.completion_enabled && completions.length > 0) {
      let completionBlock = '';
      if (reminder.context_type === 'private') {
        completionBlock = '\n\n✅ <b>Выполнено</b>';
      } else {
        const lines = completions.map(formatCompletionLine);
        completionBlock = `\n\n<b>Выполнили: ${completions.length}</b>\n<blockquote expandable>${lines.join('\n')}</blockquote>`;

        if (baseText.length + completionBlock.length > maxLen) {
          const kept = [];
          for (let i = 0; i < lines.length; i += 1) {
            const remaining = lines.length - (i + 1);
            const suffix = remaining > 0 ? `\n… и ещё ${remaining}` : '';
            const candidate = `\n\n<b>Выполнили: ${completions.length}</b>\n<blockquote expandable>${[...kept, lines[i]].join('\n')}${suffix}</blockquote>`;
            if (baseText.length + candidate.length <= maxLen) {
              kept.push(lines[i]);
            } else {
              break;
            }
          }
          const remaining = lines.length - kept.length;
          const tail = remaining > 0 ? `\n… и ещё ${remaining}` : '';
          completionBlock = `\n\n<b>Выполнили: ${completions.length}</b>\n<blockquote expandable>${kept.join('\n')}${tail}</blockquote>`;
        }
      }

      if (baseText.length + completionBlock.length <= maxLen) {
        baseText += completionBlock;
      }
    }

    if (baseText.length > maxLen) {
      baseText = `${baseText.slice(0, maxLen - 1)}…`;
    }

    return baseText;
  }

  async sendOccurrence(occurrenceId) {
    const joined = this.occurrenceRepo.findWithReminder(occurrenceId);
    if (!joined) {
      throw new Error(`Срабатывание #${occurrenceId} не найдено`);
    }

    const { occurrence, reminder } = joined;
    const syncKey = buildCompletionSyncKey(occurrence);
    const completions = reminder.completion_enabled
      ? this.completionRepo.listBySyncKey(syncKey)
      : [];

    const text = this.buildReminderText(reminder, completions);
    const replyMarkup = this.buildInlineKeyboard(reminder, occurrence.id);

    this.occurrenceRepo.markSending(occurrence.id);

    let sentMessage;
    const hasPhoto = Boolean(reminder.photo_file_id);

    if (hasPhoto) {
      sentMessage = await this.telegramGateway.sendPhoto(occurrence.chat_id, reminder.photo_file_id, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    } else {
      sentMessage = await this.telegramGateway.sendMessage(occurrence.chat_id, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        disable_web_page_preview: true
      });
    }

    this.occurrenceRepo.markSent(occurrence.id, {
      messageId: sentMessage?.message_id ?? null,
      hasPhoto,
      renderedText: text
    });

    return {
      occurrenceId: occurrence.id,
      reminderId: reminder.id,
      scheduleType: reminder.schedule_type,
      messageId: sentMessage?.message_id ?? null
    };
  }

  async refreshOccurrenceMessage(occurrenceId) {
    const joined = this.occurrenceRepo.findWithReminder(occurrenceId);
    if (!joined) return false;

    const { occurrence, reminder } = joined;
    if (!occurrence.message_id || occurrence.status !== 'sent') return false;

    const syncKey = buildCompletionSyncKey(occurrence);
    const completions = this.completionRepo.listBySyncKey(syncKey);
    const text = this.buildReminderText(reminder, completions);
    const replyMarkup = this.buildInlineKeyboard(reminder, occurrence.id);

    try {
      if (occurrence.has_photo) {
        await this.telegramGateway.editMessageCaption(
          occurrence.chat_id,
          occurrence.message_id,
          text,
          { parse_mode: 'HTML', reply_markup: replyMarkup }
        );
      } else {
        await this.telegramGateway.editMessageText(
          occurrence.chat_id,
          occurrence.message_id,
          text,
          { parse_mode: 'HTML', reply_markup: replyMarkup, disable_web_page_preview: true }
        );
      }
      return true;
    } catch (err) {
      const msg = String(err?.description || err?.message || '');
      if (msg.includes('message is not modified')) {
        return true;
      }
      if (msg.includes("can't parse entities") && text.includes('<blockquote expandable>')) {
        const fallbackText = text.replaceAll('<blockquote expandable>', '<blockquote>');
        if (occurrence.has_photo) {
          await this.telegramGateway.editMessageCaption(
            occurrence.chat_id,
            occurrence.message_id,
            fallbackText,
            { parse_mode: 'HTML', reply_markup: replyMarkup }
          );
        } else {
          await this.telegramGateway.editMessageText(
            occurrence.chat_id,
            occurrence.message_id,
            fallbackText,
            { parse_mode: 'HTML', reply_markup: replyMarkup, disable_web_page_preview: true }
          );
        }
        return true;
      }
      this.logger?.warn('Не удалось обновить сообщение со списком выполнивших', {
        occurrenceId,
        error: msg
      });
      return false;
    }
  }

  /**
   * Синхронизирует отображение отметки «Выполнено» во всех уже отправленных сообщениях серии.
   */
  async refreshSeriesMessages(seriesId) {
    if (!seriesId) return 0;
    const sentOccurrences = this.occurrenceRepo.listSentBySeries(seriesId);
    let updated = 0;
    for (const occ of sentOccurrences) {
      const ok = await this.refreshOccurrenceMessage(occ.id);
      if (ok) updated += 1;
    }
    return updated;
  }
}
