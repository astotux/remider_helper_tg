import { DateTime } from 'luxon';
import { computeMissedAndNext } from '../utils/date.utils.js';

export class SchedulerService {
  constructor({
    db,
    reminderRepo,
    occurrenceRepo,
    queueRepo,
    deliveryQueue,
    config,
    logger = null
  }) {
    this.db = db;
    this.reminderRepo = reminderRepo;
    this.occurrenceRepo = occurrenceRepo;
    this.queueRepo = queueRepo;
    this.deliveryQueue = deliveryQueue;
    this.config = config;
    this.logger = logger;

    this.pollIntervalMs = config.schedulerPollIntervalMs || 5000;
    this.maxMissedPerReminder = config.maxMissedOccurrencesPerReminder || 3;
    this.timer = null;
    this.isRunning = false;
    this.isTicking = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const recovered = this.queueRepo.recoverStaleProcessing();
    if (recovered.alreadySent > 0 || recovered.resetCount > 0) {
      this.logger?.info('Восстановлена очередь после предыдущего запуска', recovered);
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);

    this.logger?.info('Планировщик напоминаний запущен', {
      pollIntervalMs: this.pollIntervalMs,
      maxMissedPerReminder: this.maxMissedPerReminder
    });
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(nowUtc = DateTime.utc()) {
    if (this.isTicking) return 0;
    this.isTicking = true;

    try {
      const nowIso = nowUtc.toUTC().toISO();
      const dueReminders = this.reminderRepo.findDueReminders(nowIso, 100);
      if (dueReminders.length === 0) return 0;

      let enqueuedTotal = 0;

      const processBatch = this.db.transaction(() => {
        for (const staleReminder of dueReminders) {
          const reminder = this.reminderRepo.findById(staleReminder.id);
          if (!reminder || !reminder.is_active || reminder.is_archived || !reminder.next_run_at) {
            continue;
          }
          if (reminder.next_run_at > nowIso) {
            continue;
          }

          const { missedSlots, totalMissed, nextRunAt } = computeMissedAndNext({
            scheduleType: reminder.schedule_type,
            scheduleData: reminder.schedule_data,
            timezone: reminder.timezone,
            currentNextRunAtIso: reminder.next_run_at,
            nowUtc,
            maxMissed: this.maxMissedPerReminder
          });

          if (totalMissed > missedSlots.length) {
            this.logger?.warn(
              'Обнаружено много пропущенных срабатываний после простоя, отправка ограничена',
              {
                reminderId: reminder.id,
                totalMissed,
                enqueued: missedSlots.length
              }
            );
          }

          for (const slotIso of missedSlots) {
            const { occurrence } = this.occurrenceRepo.createOrGet({
              reminderId: reminder.id,
              chatId: reminder.context_id,
              scheduledAt: slotIso,
              status: 'queued'
            });

            if (occurrence && occurrence.status !== 'sent' && occurrence.status !== 'cancelled') {
              this.queueRepo.enqueue({
                occurrenceId: occurrence.id,
                chatId: reminder.context_id,
                nextAttemptAt: nowIso
              });
              enqueuedTotal += 1;
            }
          }

          this.reminderRepo.update(reminder.id, {
            nextRunAt: reminder.schedule_type === 'once' ? null : nextRunAt
          });
        }
      });

      processBatch();

      if (enqueuedTotal > 0) {
        this.logger?.info(`Планировщик поставил в очередь срабатываний: ${enqueuedTotal}`);
        this.deliveryQueue?.wakeUp(0);
      }

      return enqueuedTotal;
    } catch (err) {
      this.logger?.error('Ошибка в тике планировщика', err);
      return 0;
    } finally {
      this.isTicking = false;
    }
  }
}
