import {
  RU_TIMEZONES,
  WEEKDAY_NAMES_RU,
  WORLD_TIMEZONES,
  getCurrentTimeInZone
} from '../../utils/date.utils.js';

export function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ Создать напоминание', callback_data: 'menu:create' }],
      [{ text: '📋 Мои напоминания', callback_data: 'menu:list' }],
      [
        { text: '⚙️ Настройки', callback_data: 'menu:settings' },
        { text: '❓ Помощь', callback_data: 'menu:help' }
      ]
    ]
  };
}

export function backToMainKeyboard() {
  return {
    inline_keyboard: [[{ text: '⬅️ В главное меню', callback_data: 'menu:main' }]]
  };
}

export function remindersListKeyboard(reminders) {
  const rows = reminders.map((rem) => {
    const statusIcon = rem.is_active ? '🟢' : '⏸';
    const shortTitle = rem.title.length > 34 ? `${rem.title.slice(0, 33)}…` : rem.title;
    return [{ text: `${statusIcon} ${shortTitle}`, callback_data: `rem:view:${rem.id}` }];
  });

  rows.push([
    { text: '➕ Создать', callback_data: 'menu:create' },
    { text: '⬅️ Назад', callback_data: 'menu:main' }
  ]);

  return { inline_keyboard: rows };
}

export function reminderManageKeyboard(reminder) {
  const toggleText = reminder.is_active ? '⏸ Приостановить' : '▶️ Возобновить';
  return {
    inline_keyboard: [
      [
        { text: '✏️ Редактировать', callback_data: `rem:edit:${reminder.id}` },
        { text: toggleText, callback_data: `rem:toggle:${reminder.id}` }
      ],
      [{ text: '🗑 Удалить', callback_data: `rem:del:${reminder.id}` }],
      [{ text: '⬅️ К списку', callback_data: 'menu:list' }]
    ]
  };
}

export function reminderDeleteConfirmKeyboard(reminderId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, удалить', callback_data: `rem:del_ok:${reminderId}` },
        { text: '❌ Отмена', callback_data: `rem:view:${reminderId}` }
      ]
    ]
  };
}

export function reminderEditFieldKeyboard(reminder) {
  const rows = [
    [
      { text: '📝 Заголовок', callback_data: `edit:f:title:${reminder.id}` },
      { text: '📄 Описание', callback_data: `edit:f:description:${reminder.id}` }
    ],
    [
      { text: '🖼 Фотография', callback_data: `edit:f:photo:${reminder.id}` },
      { text: '🔗 Кнопка со ссылкой', callback_data: `edit:f:link:${reminder.id}` }
    ],
    [
      {
        text: reminder.completion_enabled ? '✅ Выполнено: Вкл' : '☑️ Выполнено: Выкл',
        callback_data: `edit:f:completion:${reminder.id}`
      },
      { text: '👥 Упоминания', callback_data: `edit:f:mentions:${reminder.id}` }
    ],
    [
      { text: '🕒 Время', callback_data: `edit:f:time:${reminder.id}` },
      { text: '📅 Тип расписания', callback_data: `edit:f:sched:${reminder.id}` }
    ]
  ];

  if (reminder.schedule_type === 'weekly') {
    rows.push([{ text: '📆 Дни недели', callback_data: `edit:f:days:${reminder.id}` }]);
  } else if (reminder.schedule_type === 'once') {
    rows.push([{ text: '📆 Дата', callback_data: `edit:f:date:${reminder.id}` }]);
  }

  rows.push([
    { text: '🌍 Часовой пояс (Настройки)', callback_data: 'menu:settings' },
    { text: '⬅️ Назад', callback_data: `rem:view:${reminder.id}` }
  ]);

  return { inline_keyboard: rows };
}

export function settingsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🕒 Изменить часовой пояс', callback_data: 'set:tz' }],
      [{ text: 'ℹ️ О боте', callback_data: 'set:about' }],
      [{ text: '⬅️ В главное меню', callback_data: 'menu:main' }]
    ]
  };
}

export function timezoneSelectionKeyboard({
  prefix,
  pagePrefix = `${prefix}_page`,
  page = 'ru',
  backCb,
  cancelCb = null
}) {
  const rows = [];

  if (page === 'world') {
    for (let i = 0; i < WORLD_TIMEZONES.length; i += 2) {
      const pair = WORLD_TIMEZONES.slice(i, i + 2).map((item) => ({
        text: `${item.shortLabel} · ${getCurrentTimeInZone(item.zone)}`,
        callback_data: `${prefix}:${item.zone}`
      }));
      rows.push(pair);
    }
    rows.push([{ text: '🇷🇺 Города России (МСК-1 … МСК+9)', callback_data: `${pagePrefix}:ru` }]);
  } else {
    const msk = RU_TIMEZONES[0];
    rows.push([
      {
        text: `🕒 ${msk.shortLabel} · ${getCurrentTimeInZone(msk.zone)}`,
        callback_data: `${prefix}:${msk.zone}`
      }
    ]);

    const rest = RU_TIMEZONES.slice(1);
    for (let i = 0; i < rest.length; i += 2) {
      const pair = rest.slice(i, i + 2).map((item) => ({
        text: `${item.shortLabel} · ${getCurrentTimeInZone(item.zone)}`,
        callback_data: `${prefix}:${item.zone}`
      }));
      rows.push(pair);
    }
    rows.push([{ text: '🌍 Другие страны (СНГ, Европа, мир)', callback_data: `${pagePrefix}:world` }]);
  }

  const navRow = [];
  if (backCb) navRow.push({ text: '⬅️ Назад', callback_data: backCb });
  if (cancelCb) navRow.push({ text: '❌ Отмена', callback_data: cancelCb });
  if (navRow.length > 0) rows.push(navRow);

  return { inline_keyboard: rows };
}

export function timezoneCandidatesKeyboard({ candidates, prefix, backCb, cancelCb = null }) {
  const rows = candidates.map((item) => [
    {
      text: `🕒 ${item.label || `${item.city} · ${getCurrentTimeInZone(item.zone)}`}`,
      callback_data: `${prefix}:${item.zone}`
    }
  ]);

  const navRow = [];
  if (backCb) navRow.push({ text: '⬅️ К списку городов', callback_data: backCb });
  if (cancelCb) navRow.push({ text: '❌ Отмена', callback_data: cancelCb });
  if (navRow.length > 0) rows.push(navRow);

  return { inline_keyboard: rows };
}

export function scheduleTypeKeyboard({ prefix = 'wiz:st', backCb = null, cancelCb = 'wiz:cancel' }) {
  const rows = [
    [{ text: '📅 Ежедневно', callback_data: `${prefix}:daily` }],
    [{ text: '📆 Еженедельно', callback_data: `${prefix}:weekly` }],
    [{ text: '🎯 Одноразово', callback_data: `${prefix}:once` }]
  ];

  const nav = [];
  if (backCb) nav.push({ text: '⬅️ Назад', callback_data: backCb });
  if (cancelCb) nav.push({ text: '❌ Отмена', callback_data: cancelCb });
  if (nav.length > 0) rows.push(nav);

  return { inline_keyboard: rows };
}

export function weekdaysKeyboard(selectedDays = [], { togglePrefix = 'wiz:day', continueCb = 'wiz:days_ok', backCb = 'wiz:back', cancelCb = 'wiz:cancel' } = {}) {
  const selected = new Set(selectedDays.map(Number));
  const btn = (d) => ({
    text: `${selected.has(d) ? '✅ ' : ''}${WEEKDAY_NAMES_RU[d]}`,
    callback_data: `${togglePrefix}:${d}`
  });

  const rows = [
    [btn(1), btn(2), btn(3), btn(4)],
    [btn(5), btn(6), btn(7)],
    [{ text: '➡️ Продолжить', callback_data: continueCb }],
    [
      ...(backCb ? [{ text: '⬅️ Назад', callback_data: backCb }] : []),
      ...(cancelCb ? [{ text: '❌ Отмена', callback_data: cancelCb }] : [])
    ]
  ];

  return { inline_keyboard: rows.filter((r) => r.length > 0) };
}

export function stepControlsKeyboard({ continueCb = null, skipCb = null, clearCb = null, backCb = 'wiz:back', cancelCb = 'wiz:cancel' } = {}) {
  const rows = [];
  if (continueCb) rows.push([{ text: '➡️ Продолжить', callback_data: continueCb }]);
  if (skipCb) rows.push([{ text: '⏭ Пропустить', callback_data: skipCb }]);
  if (clearCb) rows.push([{ text: '🗑 Удалить текущее значение', callback_data: clearCb }]);

  const nav = [];
  if (backCb) nav.push({ text: '⬅️ Назад', callback_data: backCb });
  if (cancelCb) nav.push({ text: '❌ Отмена', callback_data: cancelCb });
  if (nav.length > 0) rows.push(nav);

  return { inline_keyboard: rows };
}

export function booleanChoiceKeyboard({ yesText, yesCb, noText, noCb, backCb = 'wiz:back', cancelCb = 'wiz:cancel' }) {
  const rows = [
    [
      { text: yesText, callback_data: yesCb },
      { text: noText, callback_data: noCb }
    ]
  ];

  const nav = [];
  if (backCb) nav.push({ text: '⬅️ Назад', callback_data: backCb });
  if (cancelCb) nav.push({ text: '❌ Отмена', callback_data: cancelCb });
  if (nav.length > 0) rows.push(nav);

  return { inline_keyboard: rows };
}

export function mentionsStepKeyboard({ knownUsers = [], selectedMentions = [], backCb = 'wiz:back', cancelCb = 'wiz:cancel' }) {
  const rows = [];

  for (let i = 0; i < knownUsers.length; i += 2) {
    const chunk = knownUsers.slice(i, i + 2).map((u, idx) => {
      const realIdx = i + idx;
      const isSelected = selectedMentions.some(
        (m) => Number(m.telegramId) === Number(u.user_telegram_id)
      );
      const label = u.username ? `@${u.username}` : u.first_name;
      return {
        text: `${isSelected ? '✅ ' : ''}${label}`.slice(0, 30),
        callback_data: `wiz:m_tog:${realIdx}`
      };
    });
    rows.push(chunk);
  }

  if (selectedMentions.length > 0) {
    rows.push([{ text: '🧹 Очистить список упоминаний', callback_data: 'wiz:m_clear' }]);
  }

  rows.push([{ text: '➡️ Продолжить', callback_data: 'wiz:m_done' }]);
  rows.push([
    ...(backCb ? [{ text: '⬅️ Назад', callback_data: backCb }] : []),
    ...(cancelCb ? [{ text: '❌ Отмена', callback_data: cancelCb }] : [])
  ]);

  return { inline_keyboard: rows.filter((r) => r.length > 0) };
}

export function previewConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Подтвердить и создать', callback_data: 'wiz:confirm' }],
      [
        { text: '⬅️ Назад', callback_data: 'wiz:back' },
        { text: '❌ Отмена', callback_data: 'wiz:cancel' }
      ]
    ]
  };
}
