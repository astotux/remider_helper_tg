# Telegram Reminder Bot

Надёжный Telegram-бот на Node.js для создания, редактирования, планирования и отслеживания напоминаний в личных сообщениях и групповых чатах.

---

## Основные возможности

- **Два независимых сценария работы:**
  - **Личные сообщения:** персональные напоминания пользователя.
  - **Группы и супергруппы:** общие напоминания для чата; управление (создание, редактирование, пауза, удаление, смена часового пояса) доступно только текущим администраторам и создателю группы с живой проверкой прав через Telegram Bot API.
- **Три типа расписания:**
  - **Ежедневное** (например, каждый день в `09:00`).
  - **Еженедельное** с выбором нескольких дней недели через Inline-кнопки (например, Пн, Ср, Пт в `18:30`).
  - **Одноразовое** (конкретная дата и время с автоматической архивацией после отправки).
- **Независимые часовые пояса (IANA + DST):**
  - Отдельный часовой пояс для каждого пользователя в личке и для каждой группы.
  - Время запуска хранится в UTC, расчёты учитывают переходы на летнее/зимнее время (через Luxon) и не зависят от часового пояса VPS.
  - При смене часового пояса все активные напоминания контекста автоматически пересчитываются.
- **Богатое содержимое напоминания:**
  - Заголовок (обязательный) и описание с поддержкой и предварительной валидацией Telegram HTML (`<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="...">`, `<tg-spoiler>`, `<blockquote>`).
  - Прикрепление фотографии (с повторным использованием Telegram `file_id`).
  - Необязательная Inline-кнопка со ссылкой (с проверкой схемы `http://` / `https://`).
  - Необязательные упоминания пользователей (`@username`, известные участники группы, ссылки `tg://user?id=...`).
  - Необязательная кнопка **«✅ Выполнено»** с сохранением отметок в SQLite, защитой от дубликатов, возможностью снять отметку и отображением списка выполнивших в группе внутри сворачиваемой цитаты `<blockquote expandable>`.
- **Надёжный планировщик и очередь отправки:**
  - Все расписания, срабатывания, отметки и очередь хранятся в SQLite (WAL-режим).
  - Автоматическое восстановление после перезапуска и обработка пропущенных напоминаний с защитой от массового спама после долгого простоя.
  - Последовательная отправка в один чат с интервалом **2 секунды**, обработка Telegram rate limits (`429 retry_after`) и временных сбоев.

---

## Используемые технологии

- **Node.js** (>= 20, ES Modules)
- **Telegraf** (`^4.16.3`) — взаимодействие с Telegram Bot API (изолировано за адаптером `TelegrafGateway`)
- **SQLite (`better-sqlite3`)** (`^13.2.0`) — база данных с WAL-режимом, внешними ключами и миграциями
- **Luxon** (`^3.7.2`) — расчёты дат, времени и часовых поясов IANA с поддержкой DST
- **dotenv** (`^18.0.10`) — конфигурация через `.env`

---

## Требования к серверу (VPS)

- ОС: Linux (Ubuntu 22.04+ / Debian 12+ и аналоги)
- **Node.js** версии `20.x` или выше (рекомендуется `22.x` / `24.x`)
- `npm` и базовые build-инструменты (на случай сборки нативного модуля `better-sqlite3`, если отсутствует prebuild для архитектуры сервера: `build-essential python3`)
- Доступ в интернет к `api.telegram.org`

---

## Создание Telegram-бота через BotFather

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram и отправьте команду `/newbot`.
2. Укажите отображаемое имя бота и его `@username` (должен оканчиваться на `bot`).
3. Скопируйте выданный **токен** (`BOT_TOKEN`).
4. (Опционально) Для удобной работы в группах проверьте команды через `/setcommands`:
   ```text
   start - Главное меню
   menu - Открыть меню напоминаний
   cancel - Отменить текущее действие
   help - Справка
   ```
5. Если бот будет использоваться в группах, добавьте его в нужную группу. Назначать бота администратором группы необязательно (метод `getChatMember` работает и для обычного бота в группе), но убедитесь, что боту разрешено отправлять сообщения и медиа.

---

## Установка и настройка `.env`

1. Клонируйте проект и перейдите в директорию:
   ```bash
   git clone <URL_РЕПОЗИТОРИЯ> reminder-bot
   cd reminder-bot
   ```

2. Установите зависимости:
   ```bash
   npm install
   ```

3. Создайте файл `.env` на основе `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Заполните `.env`:
   ```env
   BOT_TOKEN=123456789:ABCDEF...
   DATABASE_PATH=./data/bot.sqlite
   LOG_LEVEL=info
   LOG_DIR=./logs
   LOG_MAX_SIZE_BYTES=5242880
   LOG_MAX_FILES=5
   SCHEDULER_POLL_INTERVAL_MS=5000
   QUEUE_POLL_INTERVAL_MS=1000
   CHAT_MESSAGE_INTERVAL_MS=2000
   MAX_MISSED_OCCURRENCES_PER_REMINDER=3
   MAX_DELIVERY_ATTEMPTS=5
   ```

---

## Локальный запуск и тестирование

Применить миграции базы данных вручную (при запуске бота миграции также применяются автоматически):

```bash
npm run migrate
```

Запустить автоматические тесты:

```bash
npm test
```

Запустить бота локально:

```bash
npm start
```

Для разработки с автоматическим перезапуском при изменении файлов:

```bash
npm run dev
```

---

## Развёртывание на VPS

### Вариант 1: Запуск через `systemd` (рекомендуется для Linux VPS)

Создайте unit-файл `/etc/systemd/system/reminder-bot.service`:

```ini
[Unit]
Description=Telegram Reminder Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/reminder-bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Ограничение времени на graceful shutdown
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

Активируйте и запустите сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable reminder-bot
sudo systemctl start reminder-bot
sudo systemctl status reminder-bot
```

Просмотр логов сервиса:

```bash
journalctl -u reminder-bot -f
```

### Вариант 2: Запуск через `PM2`

```bash
npm install -g pm2
pm2 start src/index.js --name reminder-bot
pm2 save
pm2 startup
```

Просмотр состояния и логов:

```bash
pm2 status
pm2 logs reminder-bot
```

---

## Структура проекта

```text
src/
├── bot/
│   ├── bot.js                        # Инициализация Telegraf и связывание модулей
│   ├── telegram.adapter.js           # Изолированный шлюз к Telegram API и helpers
│   ├── handlers/
│   │   ├── start.handler.js          # /start, /menu, /cancel, /help, события чата
│   │   ├── reminder.handler.js       # Просмотр, управление, пауза, удаление
│   │   ├── settings.handler.js       # Настройки контекста и часового пояса
│   │   └── callback.handler.js       # Маршрутизация callback_query и сообщений
│   ├── keyboards/
│   │   └── menus.keyboard.js         # Inline-клавиатуры интерфейса
│   ├── middlewares/
│   │   └── context.middleware.js     # Регистрация пользователей/чатов, изоляция контекста
│   └── scenes/
│       └── wizard.flow.js            # Пошаговый FSM создания и редактирования
│
├── database/
│   ├── db.js                         # Подключение SQLite (WAL, foreign_keys, busy_timeout)
│   ├── migrate.js                    # Раннер миграций
│   ├── migrations/
│   │   └── 001_initial.js            # Начальная схема таблиц и индексов
│   └── repositories/
│       ├── user.repository.js
│       ├── chat.repository.js
│       ├── reminder.repository.js
│       ├── occurrence.repository.js
│       ├── queue.repository.js
│       ├── completion.repository.js
│       └── session.repository.js
│
├── services/
│   ├── timezone.service.js           # Управление часовыми поясами и пересчёт расписаний
│   ├── permission.service.js         # Проверка прав администратора через Telegram API
│   ├── reminder.service.js           # Бизнес-логика создания, редактирования, паузы/удаления
│   ├── delivery.service.js           # Формирование и отправка/обновление сообщений
│   ├── completion.service.js         # Учёт отметок «✅ Выполнено»
│   └── scheduler.service.js          # Поиск наступивших и пропущенных напоминаний
│
├── queues/
│   └── delivery.queue.js             # Устойчивая очередь отправки (интервал 2с/чат, retry)
│
├── utils/
│   ├── date.utils.js                 # Вычисление дат, IANA-зон и DST через Luxon
│   ├── validation.utils.js           # Валидация заголовков, HTML, URL, дат и времени
│   └── logger.js                     # Логгер с ротацией файлов
│
├── config/
│   └── config.js                     # Загрузка конфигурации из .env
│
└── index.js                          # Точка входа и graceful shutdown

tests/                                # Автоматизированные тесты (node --test)
data/                                 # Директория SQLite-базы
logs/                                 # Директория ротируемых логов
```

---

## Резервное копирование SQLite

Так как база данных работает в режиме **WAL** (`bot.sqlite`, `bot.sqlite-wal`, `bot.sqlite-shm`), для создания консистентного бэкапа работающего бота используйте встроенную команду SQLite `.backup`:

```bash
sqlite3 ./data/bot.sqlite ".backup './data/backup-$(date +%F-%H%M).sqlite'"
```

Или остановите бота (`systemctl stop reminder-bot` / `pm2 stop reminder-bot`) и скопируйте файл `./data/bot.sqlite` целиком.

---

## Обновление проекта на сервере

```bash
cd /opt/reminder-bot
git pull
npm install --omit=dev
npm run migrate
sudo systemctl restart reminder-bot   # или: pm2 restart reminder-bot
```
