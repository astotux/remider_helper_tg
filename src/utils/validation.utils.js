import { DateTime } from 'luxon';

const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'a',
  'tg-spoiler',
  'blockquote'
]);

export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function validateTitle(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Заголовок должен быть текстом.' };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Заголовок не может быть пустым.' };
  }
  if (trimmed.length > 200) {
    return { valid: false, error: 'Заголовок слишком длинный (максимум 200 символов).' };
  }
  return { valid: true, value: trimmed };
}

export function validateUrl(input, { allowTelegramScheme = false } = {}) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'URL должен быть строкой.' };
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) {
    return { valid: false, error: 'Некорректный формат URL.' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Укажите корректный URL, начинающийся с https:// или http://.' };
  }

  const allowedProtocols = allowTelegramScheme ? ['http:', 'https:', 'tg:'] : ['http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, error: 'Разрешены только ссылки со схемой https:// или http://.' };
  }

  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
    return { valid: false, error: 'URL должен содержать доменное имя.' };
  }

  return { valid: true, value: parsed.toString() };
}

export function validateButtonTitle(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Название кнопки должно быть текстом.' };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, error: 'Название кнопки не может быть пустым.' };
  }
  if (trimmed.length > 64) {
    return { valid: false, error: 'Название кнопки слишком длинное (максимум 64 символа).' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Проверяет корректность HTML-разметки для Telegram Bot API parse_mode=HTML.
 */
export function validateTelegramHtml(html, maxLength = 3000) {
  if (typeof html !== 'string') {
    return { valid: false, error: 'Описание должно быть текстом.' };
  }
  const trimmed = html.trim();
  if (!trimmed) {
    return { valid: false, error: 'Описание не может быть пустым.' };
  }
  if (trimmed.length > maxLength) {
    return { valid: false, error: `Описание слишком длинное (максимум ${maxLength} символов).` };
  }

  const stack = [];
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];

    if (ch === '>') {
      return {
        valid: false,
        error: 'Обнаружен лишний символ ">". Для обычного текста используйте &gt;.'
      };
    }

    if (ch === '<') {
      const closeIdx = trimmed.indexOf('>', i + 1);
      if (closeIdx === -1) {
        return {
          valid: false,
          error: 'Незакрытый HTML-тег "<". Для обычного символа "<" используйте &lt;.'
        };
      }

      const rawTag = trimmed.slice(i + 1, closeIdx);
      if (rawTag.includes('<')) {
        return {
          valid: false,
          error: 'Некорректный вложенный символ "<" внутри тега.'
        };
      }

      const isClosing = rawTag.startsWith('/');
      const body = (isClosing ? rawTag.slice(1) : rawTag).trim();
      if (!body) {
        return { valid: false, error: 'Пустой HTML-тег <> недопустим.' };
      }

      const spaceMatch = /\s/.exec(body);
      const tagName = (spaceMatch ? body.slice(0, spaceMatch.index) : body).toLowerCase();
      const attrPart = spaceMatch ? body.slice(spaceMatch.index + 1).trim() : '';

      if (!ALLOWED_TAGS.has(tagName)) {
        return {
          valid: false,
          error: `Неподдерживаемый тег <${tagName}>. Разрешены: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="...">, <tg-spoiler>, <blockquote>.`
        };
      }

      if (isClosing) {
        if (attrPart) {
          return { valid: false, error: `Закрывающий тег </${tagName}> не должен содержать атрибуты.` };
        }
        if (stack.length === 0) {
          return { valid: false, error: `Лишний закрывающий тег </${tagName}>.` };
        }
        const expected = stack.pop();
        if (expected !== tagName) {
          return {
            valid: false,
            error: `Нарушен порядок закрытия тегов: ожидался </${expected}>, получен </${tagName}>.`
          };
        }
      } else {
        if (tagName === 'a') {
          const hrefMatch = /^href\s*=\s*(?:"([^"]*)"|'([^']*)')$/i.exec(attrPart);
          if (!hrefMatch) {
            return {
              valid: false,
              error: 'Тег <a> должен содержать корректный атрибут href="https://...".'
            };
          }
          const hrefValue = hrefMatch[1] ?? hrefMatch[2] ?? '';
          const urlCheck = validateUrl(hrefValue, { allowTelegramScheme: true });
          if (!urlCheck.valid) {
            return { valid: false, error: `Некорректная ссылка в <a href>: ${urlCheck.error}` };
          }
        } else if (tagName === 'blockquote') {
          if (attrPart && attrPart.toLowerCase() !== 'expandable') {
            return {
              valid: false,
              error: 'Тег <blockquote> поддерживает только атрибут expandable или без атрибутов.'
            };
          }
        } else if (tagName === 'code' || tagName === 'pre') {
          if (attrPart && !/^class\s*=\s*(?:"language-[a-zA-Z0-9_+-]+"|'language-[a-zA-Z0-9_+-]+')$/i.test(attrPart)) {
            return {
              valid: false,
              error: `Тег <${tagName}> поддерживает только class="language-..." или без атрибутов.`
            };
          }
        } else if (attrPart) {
          return {
            valid: false,
            error: `Тег <${tagName}> не поддерживает атрибуты.`
          };
        }

        stack.push(tagName);
      }

      i = closeIdx + 1;
      continue;
    }

    i += 1;
  }

  if (stack.length > 0) {
    return {
      valid: false,
      error: `Не закрыт тег <${stack[stack.length - 1]}>.`
    };
  }

  return { valid: true, value: trimmed };
}

export function parseTimeInput(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Введите время в формате ЧЧ:ММ, например 09:30.' };
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(input.trim());
  if (!match) {
    return { valid: false, error: 'Некорректное время. Используйте формат ЧЧ:ММ (например, 09:00 или 18:45).' };
  }
  const hour = match[1].padStart(2, '0');
  const minute = match[2];
  return { valid: true, value: `${hour}:${minute}` };
}

export function parseDateInput(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Введите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.' };
  }
  const trimmed = input.trim();
  let dt;

  const ruMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (ruMatch) {
    dt = DateTime.fromObject({
      day: Number.parseInt(ruMatch[1], 10),
      month: Number.parseInt(ruMatch[2], 10),
      year: Number.parseInt(ruMatch[3], 10)
    });
  } else if (isoMatch) {
    dt = DateTime.fromObject({
      year: Number.parseInt(isoMatch[1], 10),
      month: Number.parseInt(isoMatch[2], 10),
      day: Number.parseInt(isoMatch[3], 10)
    });
  } else {
    return { valid: false, error: 'Некорректный формат даты. Пример: 25.12.2026 или 2026-12-25.' };
  }

  if (!dt.isValid) {
    return { valid: false, error: 'Такой даты не существует в календаре.' };
  }

  return { valid: true, value: dt.toFormat('yyyy-MM-dd') };
}
