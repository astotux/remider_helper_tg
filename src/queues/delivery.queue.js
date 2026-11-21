function extractRetryAfterSeconds(err) {
  const code = err?.response?.error_code ?? err?.code;
  const retryAfter = err?.response?.parameters?.retry_after ?? err?.parameters?.retry_after;
  if (code === 429 && Number.isFinite(Number(retryAfter))) {
    return Math.max(1, Number(retryAfter));
  }
  return null;
}

function isPermanentChatError(err) {
  const code = err?.response?.error_code ?? err?.code;
  const desc = String(err?.response?.description || err?.description || err?.message || '').toLowerCase();

  if (code === 403) return true;
  if (
    code === 400 &&
    (desc.includes('chat not found') ||
      desc.includes('group chat was deactivated') ||
      desc.includes('user is deactivated') ||
      desc.includes('bot was kicked'))
  ) {
    return true;
  }
  return false;
}

export class DeliveryQueue {
  constructor({
    queueRepo,
    occurrenceRepo,
    reminderRepo,
    deliveryService,
    reminderService,
    config,
    logger = null
  }) {
    this.queueRepo = queueRepo;
    this.occurrenceRepo = occurrenceRepo;
    this.reminderRepo = reminderRepo;
    this.deliveryService = deliveryService;
    this.reminderService = reminderService;
    this.config = config;
    this.logger = logger;

    this.pollIntervalMs = config.queuePollIntervalMs || 1000;
    this.chatIntervalMs = config.chatMessageIntervalMs || 2000;
    this.maxAttempts = config.maxDeliveryAttempts || 5;
    this.maxConcurrentChats = 5;

    this.timer = null;
    this.wakeTimer = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.inFlightChats = new Set();
    this.inFlightPromises = new Set();
    this.lastSentAtByChat = new Map();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      void this.processPending();
    }, this.pollIntervalMs);
    this.logger?.info('Очередь отправки запущена', {
      pollIntervalMs: this.pollIntervalMs,
      chatIntervalMs: this.chatIntervalMs
    });
  }

  async stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    if (this.inFlightPromises.size > 0) {
      this.logger?.info(`Ожидание завершения текущих отправок (${this.inFlightPromises.size})...`);
      await Promise.allSettled([...this.inFlightPromises]);
    }
  }

  wakeUp(delayMs = 0) {
    if (!this.isRunning) return;
    if (delayMs <= 0) {
      void this.processPending();
      return;
    }
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.processPending();
    }, delayMs);
  }

  async processPending() {
    if (!this.isRunning || this.isProcessing) return;
    this.isProcessing = true;

    try {
      const nowIso = new Date().toISOString();
      const dueItems = this.queueRepo.findDuePending(nowIso, 50);
      if (dueItems.length === 0) return;

      let earliestWaitMs = null;

      for (const item of dueItems) {
        if (!this.isRunning) break;
        if (this.inFlightChats.size >= this.maxConcurrentChats) break;

        const chatKey = String(item.chat_id);
        if (this.inFlightChats.has(chatKey)) {
          continue;
        }

        const lastSent = this.lastSentAtByChat.get(chatKey) || 0;
        const elapsed = Date.now() - lastSent;
        if (elapsed < this.chatIntervalMs) {
          const waitMs = this.chatIntervalMs - elapsed;
          earliestWaitMs = earliestWaitMs === null ? waitMs : Math.min(earliestWaitMs, waitMs);
          continue;
        }

        const claimed = this.queueRepo.claimItem(item.id);
        if (!claimed) continue;

        this.inFlightChats.add(chatKey);
        const promise = this.deliverItem(claimed).finally(() => {
          this.inFlightChats.delete(chatKey);
          this.inFlightPromises.delete(promise);
          if (this.isRunning) {
            this.wakeUp(this.chatIntervalMs);
          }
        });
        this.inFlightPromises.add(promise);
      }

      if (earliestWaitMs !== null && this.isRunning) {
        this.wakeUp(earliestWaitMs + 20);
      }
    } catch (err) {
      this.logger?.error('Ошибка в цикле обработки очереди отправки', err);
    } finally {
      this.isProcessing = false;
    }
  }

  async deliverItem(queueItem) {
    const chatKey = String(queueItem.chat_id);

    try {
      const result = await this.deliveryService.sendOccurrence(queueItem.occurrence_id);
      this.lastSentAtByChat.set(chatKey, Date.now());
      this.queueRepo.markSent(queueItem.id);

      if (result.scheduleType === 'once') {
        this.reminderRepo.archiveAndDeactivate(result.reminderId);
      }

      this.logger?.info('Напоминание отправлено', {
        queueId: queueItem.id,
        occurrenceId: queueItem.occurrence_id,
        reminderId: result.reminderId,
        chatId: queueItem.chat_id,
        messageId: result.messageId
      });
    } catch (err) {
      const errMsg = err?.response?.description || err?.description || err?.message || String(err);
      const retryAfterSec = extractRetryAfterSeconds(err);

      if (retryAfterSec !== null) {
        const delayMs = (retryAfterSec + 1) * 1000;
        this.lastSentAtByChat.set(chatKey, Date.now() + delayMs);
        const nextAttempt = new Date(Date.now() + delayMs).toISOString();
        this.queueRepo.scheduleRetry(queueItem.id, nextAttempt, `429 retry_after=${retryAfterSec}s`);
        this.logger?.warn('Telegram API rate limit (429), отправка отложена', {
          queueId: queueItem.id,
          chatId: queueItem.chat_id,
          retryAfterSec
        });
        return;
      }

      if (isPermanentChatError(err)) {
        this.queueRepo.markFailed(queueItem.id, errMsg);
        this.occurrenceRepo.markFailed(queueItem.occurrence_id, errMsg);
        this.logger?.error('Постоянная ошибка Telegram API при отправке', {
          queueId: queueItem.id,
          chatId: queueItem.chat_id,
          error: errMsg
        });

        if (Number(queueItem.chat_id) < 0) {
          this.reminderService?.handleBotRemovedFromGroup(queueItem.chat_id);
        } else {
          this.reminderRepo.deactivateByContext('private', queueItem.chat_id);
        }
        return;
      }

      if (queueItem.attempts < this.maxAttempts) {
        const backoffSec = Math.min(300, 5 * 3 ** Math.max(0, queueItem.attempts - 1));
        const nextAttempt = new Date(Date.now() + backoffSec * 1000).toISOString();
        this.queueRepo.scheduleRetry(queueItem.id, nextAttempt, errMsg);
        this.logger?.warn('Временная ошибка отправки, запланирован повтор', {
          queueId: queueItem.id,
          attempt: queueItem.attempts,
          backoffSec,
          error: errMsg
        });
      } else {
        this.queueRepo.markFailed(queueItem.id, errMsg);
        this.occurrenceRepo.markFailed(queueItem.occurrence_id, errMsg);
        this.logger?.error('Превышено число попыток отправки напоминания', {
          queueId: queueItem.id,
          occurrenceId: queueItem.occurrence_id,
          error: errMsg
        });
      }
    }
  }
}
