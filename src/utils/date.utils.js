import { DateTime, IANAZone } from 'luxon';

export const WEEKDAY_NAMES_RU = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс'
};

export const WEEKDAY_FULL_RU = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
  7: 'Воскресенье'
};

export const RU_TIMEZONES = [
  { zone: 'Europe/Moscow', shortLabel: 'Москва (МСК)', city: 'Москва' },
  { zone: 'Europe/Kaliningrad', shortLabel: 'Калининград (-1)', city: 'Калининград' },
  { zone: 'Europe/Samara', shortLabel: 'Самара (+1)', city: 'Самара' },
  { zone: 'Asia/Yekaterinburg', shortLabel: 'Екатеринбург (+2)', city: 'Екатеринбург' },
  { zone: 'Asia/Omsk', shortLabel: 'Омск (+3)', city: 'Омск' },
  { zone: 'Asia/Novosibirsk', shortLabel: 'Новосибирск (+4)', city: 'Новосибирск' },
  { zone: 'Asia/Irkutsk', shortLabel: 'Иркутск (+5)', city: 'Иркутск' },
  { zone: 'Asia/Yakutsk', shortLabel: 'Якутск (+6)', city: 'Якутск' },
  { zone: 'Asia/Vladivostok', shortLabel: 'Владивосток (+7)', city: 'Владивосток' },
  { zone: 'Asia/Magadan', shortLabel: 'Магадан (+8)', city: 'Магадан' },
  { zone: 'Asia/Kamchatka', shortLabel: 'Камчатка (+9)', city: 'Камчатка' }
];

export const WORLD_TIMEZONES = [
  { zone: 'Europe/Minsk', shortLabel: 'Минск', city: 'Минск' },
  { zone: 'Europe/Kyiv', shortLabel: 'Киев', city: 'Киев' },
  { zone: 'Asia/Almaty', shortLabel: 'Алматы / Астана', city: 'Алматы' },
  { zone: 'Asia/Tashkent', shortLabel: 'Ташкент', city: 'Ташкент' },
  { zone: 'Asia/Tbilisi', shortLabel: 'Тбилиси', city: 'Тбилиси' },
  { zone: 'Asia/Yerevan', shortLabel: 'Ереван', city: 'Ереван' },
  { zone: 'Asia/Baku', shortLabel: 'Баку', city: 'Баку' },
  { zone: 'Asia/Bishkek', shortLabel: 'Бишкек', city: 'Бишкек' },
  { zone: 'Europe/Amsterdam', shortLabel: 'Амстердам', city: 'Амстердам' },
  { zone: 'Europe/Berlin', shortLabel: 'Берлин', city: 'Берлин' },
  { zone: 'Europe/London', shortLabel: 'Лондон', city: 'Лондон' },
  { zone: 'Europe/Istanbul', shortLabel: 'Стамбул', city: 'Стамбул' },
  { zone: 'Asia/Dubai', shortLabel: 'Дубай', city: 'Дубай' },
  { zone: 'America/New_York', shortLabel: 'Нью-Йорк', city: 'Нью-Йорк' },
  { zone: 'Asia/Tokyo', shortLabel: 'Токио', city: 'Токио' }
];

export const POPULAR_TIMEZONES = [
  ...RU_TIMEZONES.map((z) => ({ zone: z.zone, label: `${z.city} (${z.zone})` })),
  ...WORLD_TIMEZONES.map((z) => ({ zone: z.zone, label: `${z.city} (${z.zone})` }))
];

const ZONE_CITY_LOOKUP = new Map([
  ...RU_TIMEZONES.map((z) => [z.zone, z.city]),
  ...WORLD_TIMEZONES.map((z) => [z.zone, z.city]),
  ['Asia/Krasnoyarsk', 'Красноярск'],
  ['Asia/Tomsk', 'Томск'],
  ['Asia/Barnaul', 'Барнаул'],
  ['Asia/Novokuznetsk', 'Новокузнецк'],
  ['Asia/Chita', 'Чита'],
  ['Asia/Sakhalin', 'Южно-Сахалинск'],
  ['Asia/Srednekolymsk', 'Среднеколымск'],
  ['Asia/Anadyr', 'Анадырь'],
  ['Europe/Saratov', 'Саратов'],
  ['Europe/Ulyanovsk', 'Ульяновск'],
  ['Europe/Astrakhan', 'Астрахань'],
  ['Europe/Volgograd', 'Волгоград'],
  ['Europe/Kirov', 'Киров'],
  ['Europe/Paris', 'Париж'],
  ['Europe/Warsaw', 'Варшава']
]);

export function isValidTimezone(timezone) {
  if (typeof timezone !== 'string') return false;
  const trimmed = timezone.trim();
  if (!trimmed || trimmed.includes(' ')) return false;
  if (!trimmed.includes('/') && trimmed !== 'UTC') return false;
  return IANAZone.isValidZone(trimmed);
}

export function getCurrentTimeInZone(timezone, nowUtc = DateTime.utc()) {
  if (!isValidTimezone(timezone)) return '--:--';
  return nowUtc.setZone(timezone).toFormat('HH:mm');
}

export function formatMskOffsetLabel(timezone, nowUtc = DateTime.utc()) {
  if (!isValidTimezone(timezone)) return '';
  const target = nowUtc.setZone(timezone);
  const msk = nowUtc.setZone('Europe/Moscow');
  const diffHours = (target.offset - msk.offset) / 60;
  if (diffHours === 0) return 'МСК';
  const sign = diffHours > 0 ? '+' : '';
  return `МСК${sign}${diffHours}`;
}

export function getTimezoneCityName(timezone) {
  if (ZONE_CITY_LOOKUP.has(timezone)) {
    return ZONE_CITY_LOOKUP.get(timezone);
  }
  const parts = String(timezone).split('/');
  return parts[parts.length - 1].replaceAll('_', ' ');
}

export function formatTimezoneHuman(timezone, { withCurrentTime = true, nowUtc = DateTime.utc() } = {}) {
  if (!isValidTimezone(timezone)) return String(timezone || 'не настроен');
  const city = getTimezoneCityName(timezone);
  const mskLabel = formatMskOffsetLabel(timezone, nowUtc);
  if (!withCurrentTime) {
    return `${city} (${mskLabel})`;
  }
  const currentTime = getCurrentTimeInZone(timezone, nowUtc);
  return `${city} (${mskLabel}, сейчас ${currentTime})`;
}

export function parseTimeParts(timeStr) {
  if (typeof timeStr !== 'string') {
    throw new Error('Время должно быть строкой формата ЧЧ:ММ');
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeStr.trim());
  if (!match) {
    throw new Error(`Некорректное время: "${timeStr}". Ожидается формат ЧЧ:ММ`);
  }
  return {
    hour: Number.parseInt(match[1], 10),
    minute: Number.parseInt(match[2], 10)
  };
}

export function parseDateParts(dateStr) {
  if (typeof dateStr !== 'string') {
    throw new Error('Дата должна быть строкой формата ГГГГ-ММ-ДД');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`Некорректная дата: "${dateStr}". Ожидается формат ГГГГ-ММ-ДД`);
  }
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10)
  };
}

/**
 * Вычисляет следующее время срабатывания (в UTC ISO) с учётом часового пояса IANA и переходов DST.
 */
export function computeNextRunAt({
  scheduleType,
  scheduleData,
  timezone,
  fromUtc = DateTime.utc(),
  inclusive = false
}) {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Некорректный часовой пояс: ${timezone}`);
  }

  const fromDt = (fromUtc instanceof DateTime ? fromUtc : DateTime.fromISO(fromUtc, { zone: 'utc' }))
    .setZone(timezone);

  const { hour, minute } = parseTimeParts(scheduleData.time);

  if (scheduleType === 'once') {
    const { year, month, day } = parseDateParts(scheduleData.date);
    const target = DateTime.fromObject(
      { year, month, day, hour, minute, second: 0, millisecond: 0 },
      { zone: timezone }
    );
    if (!target.isValid) {
      throw new Error(`Некорректная дата или время: ${scheduleData.date} ${scheduleData.time}`);
    }
    return target.toUTC().toISO();
  }

  if (scheduleType === 'daily') {
    let candidate = fromDt.set({ hour, minute, second: 0, millisecond: 0 });
    const isPast = inclusive ? candidate < fromDt : candidate <= fromDt;
    if (isPast) {
      candidate = fromDt.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
    }
    return candidate.toUTC().toISO();
  }

  if (scheduleType === 'weekly') {
    const days = [...new Set((scheduleData.days || []).map(Number))]
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b);

    if (days.length === 0) {
      throw new Error('Для еженедельного напоминания должен быть выбран хотя бы один день недели');
    }

    for (let offset = 0; offset <= 7; offset += 1) {
      const dayBase = fromDt.plus({ days: offset });
      if (!days.includes(dayBase.weekday)) continue;

      const candidate = dayBase.set({ hour, minute, second: 0, millisecond: 0 });
      const matches = inclusive ? candidate >= fromDt : candidate > fromDt;
      if (matches) {
        return candidate.toUTC().toISO();
      }
    }
  }

  throw new Error(`Неподдерживаемый тип расписания: ${scheduleType}`);
}

function collectBaseMissedSlots({
  scheduleType,
  scheduleData,
  timezone,
  currentNextRunAtIso,
  nowUtc,
  maxMissed
}) {
  const now = nowUtc instanceof DateTime ? nowUtc.toUTC() : DateTime.fromISO(nowUtc, { zone: 'utc' });
  const currentSlot = DateTime.fromISO(currentNextRunAtIso, { zone: 'utc' });

  const daysGap = now.diff(currentSlot, 'days').days;
  const collected = [];
  let totalMissed = 0;

  if (daysGap <= 60) {
    let cursor = currentSlot;
    while (cursor.isValid && cursor <= now) {
      collected.push(cursor.toISO());
      totalMissed += 1;
      const nextIso = computeNextRunAt({
        scheduleType,
        scheduleData,
        timezone,
        fromUtc: cursor,
        inclusive: false
      });
      cursor = DateTime.fromISO(nextIso, { zone: 'utc' });
    }
  } else {
    const lookbackDays = scheduleType === 'weekly' ? maxMissed * 7 + 7 : maxMissed + 2;
    const cursorUtc = now.minus({ days: lookbackDays });
    const nextIso = computeNextRunAt({
      scheduleType,
      scheduleData,
      timezone,
      fromUtc: cursorUtc,
      inclusive: true
    });
    let cursor = DateTime.fromISO(nextIso, { zone: 'utc' });
    while (cursor.isValid && cursor <= now) {
      collected.push(cursor.toISO());
      cursor = DateTime.fromISO(
        computeNextRunAt({
          scheduleType,
          scheduleData,
          timezone,
          fromUtc: cursor,
          inclusive: false
        }),
        { zone: 'utc' }
      );
    }
    totalMissed = Math.max(collected.length, Math.floor(daysGap));
  }

  return { collected, totalMissed };
}

function computeRepeatWindowSlots({
  scheduleType,
  scheduleData,
  timezone,
  windowStartIso,
  seriesId,
  seriesEndsAtIso,
  now,
  maxMissed
}) {
  const intervalMinutes = Number(scheduleData.repeat.intervalMinutes);
  const intervalMs = intervalMinutes * 60 * 1000;
  const startMs = DateTime.fromISO(windowStartIso, { zone: 'utc' }).toMillis();
  const nowMs = now.toMillis();
  const endsAt = seriesEndsAtIso ? DateTime.fromISO(seriesEndsAtIso, { zone: 'utc' }) : null;
  const endsMs = endsAt && endsAt.isValid ? endsAt.toMillis() : null;

  const missedSlots = [];
  let totalMissed = 0;

  if (endsMs === null || startMs <= endsMs) {
    const capMs = endsMs !== null ? Math.min(nowMs, endsMs) : nowMs;
    if (capMs >= startMs) {
      const stepsPassed = Math.floor((capMs - startMs) / intervalMs);
      totalMissed = stepsPassed + 1;
      const keepCount = Math.min(totalMissed, maxMissed);
      for (let i = keepCount - 1; i >= 0; i -= 1) {
        const slotMs = startMs + (stepsPassed - i) * intervalMs;
        missedSlots.push(DateTime.fromMillis(slotMs, { zone: 'utc' }).toISO());
      }
    }
  }

  const nextStep = Math.floor((nowMs - startMs) / intervalMs) + 1;
  const nextMs = startMs + nextStep * intervalMs;
  const windowFinished = endsMs !== null && nextMs > endsMs;

  if (windowFinished) {
    const nextRunAt =
      scheduleType === 'once'
        ? null
        : computeNextRunAt({
            scheduleType,
            scheduleData,
            timezone,
            fromUtc: now,
            inclusive: false
          });
    return {
      missedSlots,
      totalMissed,
      occurrenceSeriesId: seriesId,
      nextRunAt,
      nextSeriesId: null,
      nextSeriesEndsAt: null
    };
  }

  return {
    missedSlots,
    totalMissed,
    occurrenceSeriesId: seriesId,
    nextRunAt: DateTime.fromMillis(nextMs, { zone: 'utc' }).toISO(),
    nextSeriesId: seriesId,
    nextSeriesEndsAt: seriesEndsAtIso
  };
}

/**
 * Вычисляет пропущенные слоты (с ограничением maxMissed) и следующее будущее время запуска.
 * Поддерживает подрежим повторов внутри окна (scheduleData.repeat) поверх once / daily / weekly.
 */
export function computeMissedAndNext({
  scheduleType,
  scheduleData,
  timezone,
  currentNextRunAtIso,
  seriesId = null,
  seriesEndsAtIso = null,
  seriesIdFactory = () => `s_${Date.now()}`,
  nowUtc = DateTime.utc(),
  maxMissed = 3
}) {
  const now = nowUtc instanceof DateTime ? nowUtc.toUTC() : DateTime.fromISO(nowUtc, { zone: 'utc' });
  const currentSlot = DateTime.fromISO(currentNextRunAtIso, { zone: 'utc' });

  if (!currentSlot.isValid || currentSlot > now) {
    return {
      missedSlots: [],
      totalMissed: 0,
      occurrenceSeriesId: seriesId,
      nextRunAt: currentNextRunAtIso,
      nextSeriesId: seriesId,
      nextSeriesEndsAt: seriesEndsAtIso
    };
  }

  const repeat = scheduleData?.repeat;
  if (repeat && Number(repeat.intervalMinutes) > 0) {
    // 1. Уже внутри активной серии повторов
    if (seriesId) {
      return computeRepeatWindowSlots({
        scheduleType,
        scheduleData,
        timezone,
        windowStartIso: currentSlot.toISO(),
        seriesId,
        seriesEndsAtIso,
        now,
        maxMissed
      });
    }

    // 2. Наступил базовый запуск (once / daily / weekly) -> открываем новую серию повторов
    let windowStartIso = currentSlot.toISO();
    if (scheduleType !== 'once') {
      const { collected } = collectBaseMissedSlots({
        scheduleType,
        scheduleData,
        timezone,
        currentNextRunAtIso,
        nowUtc: now,
        maxMissed: 1
      });
      if (collected.length > 0) {
        windowStartIso = collected[collected.length - 1];
      }
    }

    const newSeriesId = seriesIdFactory();
    const durMin = repeat.durationMinutes ? Number(repeat.durationMinutes) : null;
    const newSeriesEndsAt = durMin
      ? DateTime.fromISO(windowStartIso, { zone: 'utc' }).plus({ minutes: durMin }).toISO()
      : null;

    return computeRepeatWindowSlots({
      scheduleType,
      scheduleData,
      timezone,
      windowStartIso,
      seriesId: newSeriesId,
      seriesEndsAtIso: newSeriesEndsAt,
      now,
      maxMissed
    });
  }

  if (scheduleType === 'once') {
    return {
      missedSlots: [currentSlot.toISO()],
      totalMissed: 1,
      occurrenceSeriesId: null,
      nextRunAt: null,
      nextSeriesId: null,
      nextSeriesEndsAt: null
    };
  }

  const { collected, totalMissed } = collectBaseMissedSlots({
    scheduleType,
    scheduleData,
    timezone,
    currentNextRunAtIso,
    nowUtc: now,
    maxMissed
  });

  const missedSlots = collected.slice(-maxMissed);
  const nextRunAt = computeNextRunAt({
    scheduleType,
    scheduleData,
    timezone,
    fromUtc: now,
    inclusive: false
  });

  return {
    missedSlots,
    totalMissed,
    occurrenceSeriesId: null,
    nextRunAt,
    nextSeriesId: null,
    nextSeriesEndsAt: null
  };
}

export function formatUtcInTimezone(utcIso, timezone, format = 'dd.MM.yyyy HH:mm') {
  if (!utcIso) return '—';
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) return '—';
  return dt.toFormat(format);
}

export function formatTimezoneOffset(timezone) {
  return formatTimezoneHuman(timezone, { withCurrentTime: true });
}

export function formatIntervalMinutesRu(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m % 60 === 0) {
    const h = m / 60;
    if (h === 1) return '1 час';
    if (h >= 2 && h <= 4) return `${h} часа`;
    return `${h} часов`;
  }
  return `${m} мин`;
}

export function formatScheduleSummary(scheduleType, scheduleData, timezone) {
  const time = scheduleData?.time || '00:00';
  const tzHuman = formatTimezoneHuman(timezone, { withCurrentTime: false });
  const repeat = scheduleData?.repeat;
  const repeatSuffix = repeat
    ? `; повтор каждые ${formatIntervalMinutesRu(repeat.intervalMinutes)} (${
        repeat.durationMinutes
          ? `в течение ${formatIntervalMinutesRu(repeat.durationMinutes)}`
          : 'пока не выполнят'
      })`
    : '';

  if (scheduleType === 'daily') {
    return `Ежедневно в ${time}${repeatSuffix} (${tzHuman})`;
  }
  if (scheduleType === 'weekly') {
    const days = [...new Set((scheduleData?.days || []).map(Number))]
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_NAMES_RU[d] || d)
      .join(', ');
    return `Еженедельно (${days}) в ${time}${repeatSuffix} (${tzHuman})`;
  }
  if (scheduleType === 'once') {
    const formattedDate = scheduleData?.date
      ? DateTime.fromISO(scheduleData.date).toFormat('dd.MM.yyyy')
      : '—';
    return `Одноразово: ${formattedDate} в ${time}${repeatSuffix} (${tzHuman})`;
  }
  return 'Неизвестное расписание';
}
