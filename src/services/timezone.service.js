import { DateTime } from 'luxon';
import {
  RU_TIMEZONES,
  WORLD_TIMEZONES,
  computeNextRunAt,
  isValidTimezone
} from '../utils/date.utils.js';

const MSK_OFFSET_TO_ZONE = {
  '-1': 'Europe/Kaliningrad',
  0: 'Europe/Moscow',
  1: 'Europe/Samara',
  2: 'Asia/Yekaterinburg',
  3: 'Asia/Omsk',
  4: 'Asia/Novosibirsk',
  5: 'Asia/Irkutsk',
  6: 'Asia/Yakutsk',
  7: 'Asia/Vladivostok',
  8: 'Asia/Magadan',
  9: 'Asia/Kamchatka'
};

// Словарь крупных городов РФ, СНГ и мира (ключ нормализован: нижний регистр, ё -> е)
const CITY_ALIASES = {
  // МСК-1 (UTC+2)
  калининград: 'Europe/Kaliningrad',
  советск: 'Europe/Kaliningrad',
  балтийск: 'Europe/Kaliningrad',

  // МСК (UTC+3)
  москва: 'Europe/Moscow',
  мск: 'Europe/Moscow',
  'санкт петербург': 'Europe/Moscow',
  питер: 'Europe/Moscow',
  спб: 'Europe/Moscow',
  казань: 'Europe/Moscow',
  'нижний новгород': 'Europe/Moscow',
  воронеж: 'Europe/Moscow',
  'ростов на дону': 'Europe/Moscow',
  ростов: 'Europe/Moscow',
  краснодар: 'Europe/Moscow',
  сочи: 'Europe/Moscow',
  волгоград: 'Europe/Moscow',
  ставрополь: 'Europe/Moscow',
  махачкала: 'Europe/Moscow',
  грозный: 'Europe/Moscow',
  нальчик: 'Europe/Moscow',
  владикавказ: 'Europe/Moscow',
  белгород: 'Europe/Moscow',
  курск: 'Europe/Moscow',
  орел: 'Europe/Moscow',
  брянск: 'Europe/Moscow',
  смоленск: 'Europe/Moscow',
  тула: 'Europe/Moscow',
  калуга: 'Europe/Moscow',
  рязань: 'Europe/Moscow',
  тверь: 'Europe/Moscow',
  ярославль: 'Europe/Moscow',
  кострома: 'Europe/Moscow',
  иваново: 'Europe/Moscow',
  владимир: 'Europe/Moscow',
  тамбов: 'Europe/Moscow',
  липецк: 'Europe/Moscow',
  пенза: 'Europe/Moscow',
  саранск: 'Europe/Moscow',
  чебоксары: 'Europe/Moscow',
  'йошкар ола': 'Europe/Moscow',
  киров: 'Europe/Moscow',
  вологда: 'Europe/Moscow',
  череповец: 'Europe/Moscow',
  архангельск: 'Europe/Moscow',
  мурманск: 'Europe/Moscow',
  петрозаводск: 'Europe/Moscow',
  псков: 'Europe/Moscow',
  'великий новгород': 'Europe/Moscow',
  симферополь: 'Europe/Moscow',
  севастополь: 'Europe/Moscow',
  таганрог: 'Europe/Moscow',
  новороссийск: 'Europe/Moscow',
  анапа: 'Europe/Moscow',
  'набережные челны': 'Europe/Moscow',
  нижнекамск: 'Europe/Moscow',
  альметьевск: 'Europe/Moscow',

  // МСК+1 (UTC+4)
  самара: 'Europe/Samara',
  тольятти: 'Europe/Samara',
  ижевск: 'Europe/Samara',
  ульяновск: 'Europe/Samara',
  саратов: 'Europe/Samara',
  астрахань: 'Europe/Samara',
  энгельс: 'Europe/Samara',
  сызрань: 'Europe/Samara',
  балаково: 'Europe/Samara',

  // МСК+2 (UTC+5)
  екатеринбург: 'Asia/Yekaterinburg',
  екб: 'Asia/Yekaterinburg',
  челябинск: 'Asia/Yekaterinburg',
  уфа: 'Asia/Yekaterinburg',
  пермь: 'Asia/Yekaterinburg',
  тюмень: 'Asia/Yekaterinburg',
  магнитогорск: 'Asia/Yekaterinburg',
  сургут: 'Asia/Yekaterinburg',
  нижневартовск: 'Asia/Yekaterinburg',
  курган: 'Asia/Yekaterinburg',
  оренбург: 'Asia/Yekaterinburg',
  орск: 'Asia/Yekaterinburg',
  'нижний тагил': 'Asia/Yekaterinburg',
  стерлитамак: 'Asia/Yekaterinburg',
  салехард: 'Asia/Yekaterinburg',
  'ханты мансийск': 'Asia/Yekaterinburg',
  'новый уренгой': 'Asia/Yekaterinburg',
  ноябрьск: 'Asia/Yekaterinburg',

  // МСК+3 (UTC+6)
  омск: 'Asia/Omsk',

  // МСК+4 (UTC+7)
  новосибирск: 'Asia/Novosibirsk',
  нск: 'Asia/Novosibirsk',
  красноярск: 'Asia/Krasnoyarsk',
  барнаул: 'Asia/Barnaul',
  томск: 'Asia/Tomsk',
  кемерово: 'Asia/Novokuznetsk',
  новокузнецк: 'Asia/Novokuznetsk',
  абакан: 'Asia/Krasnoyarsk',
  кызыл: 'Asia/Krasnoyarsk',
  норильск: 'Asia/Krasnoyarsk',
  бийск: 'Asia/Barnaul',
  прокопьевск: 'Asia/Novokuznetsk',

  // МСК+5 (UTC+8)
  иркутск: 'Asia/Irkutsk',
  'улан удэ': 'Asia/Irkutsk',
  братск: 'Asia/Irkutsk',
  ангарск: 'Asia/Irkutsk',

  // МСК+6 (UTC+9)
  якутск: 'Asia/Yakutsk',
  чита: 'Asia/Chita',
  благовещенск: 'Asia/Yakutsk',

  // МСК+7 (UTC+10)
  владивосток: 'Asia/Vladivostok',
  хабаровск: 'Asia/Vladivostok',
  'комсомольск на амуре': 'Asia/Vladivostok',
  уссурийск: 'Asia/Vladivostok',
  находка: 'Asia/Vladivostok',
  артем: 'Asia/Vladivostok',

  // МСК+8 (UTC+11)
  магадан: 'Asia/Magadan',
  'южно сахалинск': 'Asia/Sakhalin',
  сахалин: 'Asia/Sakhalin',

  // МСК+9 (UTC+12)
  камчатка: 'Asia/Kamchatka',
  'петропавловск камчатский': 'Asia/Kamchatka',
  анадырь: 'Asia/Anadyr',

  // СНГ и ближнее зарубежье
  минск: 'Europe/Minsk',
  брест: 'Europe/Minsk',
  гомель: 'Europe/Minsk',
  гродно: 'Europe/Minsk',
  витебск: 'Europe/Minsk',
  киев: 'Europe/Kyiv',
  львов: 'Europe/Kyiv',
  одесса: 'Europe/Kyiv',
  харьков: 'Europe/Kyiv',
  алматы: 'Asia/Almaty',
  астана: 'Asia/Almaty',
  шымкент: 'Asia/Almaty',
  караганда: 'Asia/Almaty',
  ташкент: 'Asia/Tashkent',
  самарканд: 'Asia/Tashkent',
  тбилиси: 'Asia/Tbilisi',
  батуми: 'Asia/Tbilisi',
  ереван: 'Asia/Yerevan',
  баку: 'Asia/Baku',
  бишкек: 'Asia/Bishkek',
  душанбе: 'Asia/Dushanbe',
  кишинев: 'Europe/Chisinau',

  // Европа, Азия, Америка
  амстердам: 'Europe/Amsterdam',
  берлин: 'Europe/Berlin',
  мюнхен: 'Europe/Berlin',
  франкфурт: 'Europe/Berlin',
  лондон: 'Europe/London',
  париж: 'Europe/Paris',
  варшава: 'Europe/Warsaw',
  прага: 'Europe/Prague',
  вена: 'Europe/Vienna',
  рим: 'Europe/Rome',
  мадрид: 'Europe/Madrid',
  барселона: 'Europe/Madrid',
  стамбул: 'Europe/Istanbul',
  анталья: 'Europe/Istanbul',
  анкара: 'Europe/Istanbul',
  дубай: 'Asia/Dubai',
  абудаби: 'Asia/Dubai',
  'тель авив': 'Asia/Jerusalem',
  бангкок: 'Asia/Bangkok',
  пхукет: 'Asia/Bangkok',
  бали: 'Asia/Makassar',
  сингапур: 'Asia/Singapore',
  токио: 'Asia/Tokyo',
  сеул: 'Asia/Seoul',
  пекин: 'Asia/Shanghai',
  шанхай: 'Asia/Shanghai',
  'нью йорк': 'America/New_York',
  майами: 'America/New_York',
  чикаго: 'America/Chicago',
  'лос анджелес': 'America/Los_Angeles',
  торонто: 'America/Toronto'
};

function normalizeCityKey(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ');
}

let cachedZonesByLower = null;

function getZonesLookup() {
  if (cachedZonesByLower) return cachedZonesByLower;
  cachedZonesByLower = new Map();
  if (typeof Intl.supportedValuesOf === 'function') {
    for (const z of Intl.supportedValuesOf('timeZone')) {
      cachedZonesByLower.set(z.toLowerCase(), z);
    }
  }
  return cachedZonesByLower;
}

export class TimezoneService {
  constructor({ db, userRepo, chatRepo, reminderRepo, logger = null }) {
    this.db = db;
    this.userRepo = userRepo;
    this.chatRepo = chatRepo;
    this.reminderRepo = reminderRepo;
    this.logger = logger;
  }

  /**
   * Распознаёт IANA-зону, город РФ/мира или смещение от Москвы (МСК+2, +2, -1).
   */
  resolveTimezoneInput(rawInput) {
    if (typeof rawInput !== 'string') return null;
    const trimmed = rawInput.trim();
    if (!trimmed) return null;

    if (isValidTimezone(trimmed)) {
      return trimmed;
    }

    const lower = trimmed.toLowerCase();
    const lookup = getZonesLookup();
    if (lookup.has(lower)) {
      return lookup.get(lower);
    }

    const cityKey = normalizeCityKey(trimmed);
    if (CITY_ALIASES[cityKey]) {
      return CITY_ALIASES[cityKey];
    }

    // Разбор смещения от Москвы: "мск", "мск+2", "мск -1", "+2", "-1", "msk+4"
    const mskOnly = /^(?:мск|msk)(?:\s*[+-]\s*0)?$/i.exec(trimmed);
    if (mskOnly) {
      return 'Europe/Moscow';
    }

    const offsetMatch = /^(?:(?:мск|msk)\s*)?([+-])\s*(\d{1,2})$/i.exec(trimmed);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '-' ? -1 : 1;
      const hours = Number.parseInt(offsetMatch[2], 10) * sign;
      if (Object.hasOwn(MSK_OFFSET_TO_ZONE, String(hours))) {
        return MSK_OFFSET_TO_ZONE[String(hours)];
      }
    }

    return null;
  }

  /**
   * Подбирает похожие города по началу или вхождению строки (для подсказки пользователю).
   */
  suggestCities(rawInput, limit = 4) {
    const key = normalizeCityKey(rawInput);
    if (key.length < 2) return [];

    const seenZones = new Set();
    const matches = [];
    for (const [city, zone] of Object.entries(CITY_ALIASES)) {
      if (seenZones.has(zone)) continue;
      if (city.startsWith(key) || city.includes(key)) {
        seenZones.add(zone);
        const displayName = city
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        matches.push({ city: displayName, zone });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  /**
   * Находит часовые пояса, в которых сейчас время совпадает с введённым пользователем (ЧЧ:ММ).
   */
  findZonesByLocalTime(rawTime, nowUtc = DateTime.utc()) {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(rawTime || '').trim());
    if (!match) return null;

    const userMinutes =
      Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);

    const candidates = [...RU_TIMEZONES, ...WORLD_TIMEZONES];
    const matched = [];

    for (const item of candidates) {
      const dt = nowUtc.setZone(item.zone);
      const zoneMinutes = dt.hour * 60 + dt.minute;
      let diff = Math.abs(zoneMinutes - userMinutes);
      diff = Math.min(diff, 1440 - diff);
      if (diff <= 15) {
        matched.push({
          zone: item.zone,
          label: `${item.city} (${dt.toFormat('HH:mm')})`
        });
      }
    }

    return matched;
  }

  /**
   * Универсальный поиск часового пояса: точный (город / ±МСК / IANA), по текущему времени или по частичному совпадению города.
   */
  smartLookup(rawInput) {
    const exact = this.resolveTimezoneInput(rawInput);
    if (exact) {
      return { type: 'exact', timezone: exact };
    }

    const timeMatches = this.findZonesByLocalTime(rawInput);
    if (timeMatches && timeMatches.length > 0) {
      return { type: 'time_matches', candidates: timeMatches.slice(0, 6) };
    }

    const suggestions = this.suggestCities(rawInput, 5);
    if (suggestions.length > 0) {
      return { type: 'suggestions', candidates: suggestions };
    }

    return { type: 'none' };
  }

  getContextTimezone(contextType, contextId) {
    if (contextType === 'private') {
      const user = this.userRepo.findByTelegramId(contextId);
      return user?.timezone || null;
    }
    if (contextType === 'group') {
      const chat = this.chatRepo.findByTelegramId(contextId);
      return chat?.timezone || null;
    }
    return null;
  }

  /**
   * Сохраняет часовой пояс контекста и пересчитывает next_run_at для всех активных напоминаний.
   */
  setContextTimezone(contextType, contextId, timezoneInput) {
    const resolved = this.resolveTimezoneInput(timezoneInput);
    if (!resolved || !isValidTimezone(resolved)) {
      throw new Error(
        'Не удалось определить часовой пояс. Выберите город кнопкой, напишите город (например: Пермь, Сочи, Берлин) или разницу с Москвой (например: +2 или МСК-1).'
      );
    }

    const nowUtc = DateTime.utc();
    let recalculatedCount = 0;

    const tx = this.db.transaction(() => {
      if (contextType === 'private') {
        this.userRepo.upsert({ telegramId: contextId });
        this.userRepo.setTimezone(contextId, resolved);
      } else if (contextType === 'group') {
        this.chatRepo.upsert({ telegramId: contextId });
        this.chatRepo.setTimezone(contextId, resolved);
      } else {
        throw new Error(`Неизвестный тип контекста: ${contextType}`);
      }

      const reminders = this.reminderRepo.listByContext(contextType, contextId, {
        includeArchived: false
      });

      for (const reminder of reminders) {
        let newNextRunAt = reminder.next_run_at;
        if (reminder.is_active) {
          newNextRunAt = computeNextRunAt({
            scheduleType: reminder.schedule_type,
            scheduleData: reminder.schedule_data,
            timezone: resolved,
            fromUtc: nowUtc,
            inclusive: false
          });
        }
        this.reminderRepo.update(reminder.id, {
          timezone: resolved,
          nextRunAt: newNextRunAt
        });
        recalculatedCount += 1;
      }
    });

    tx();
    this.logger?.info('Обновлён часовой пояс контекста', {
      contextType,
      contextId,
      timezone: resolved,
      recalculatedCount
    });

    return { timezone: resolved, recalculatedCount };
  }
}
