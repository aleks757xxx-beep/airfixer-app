# PostFixer — приложение для постинга AirFixer

Cloudflare Worker (Hono + TypeScript) + интерфейс React/Vite/Tailwind (Material Design 3, только тёмная тема). Ролики в R2 (`airfixer-video`), данные в D1 (`postfixer`).

Публикация **напрямую**: Instagram и Facebook (Meta Graph), Threads, YouTube (Data API, загрузка частями), Telegram-канал (бот). **Через Buffer**: TikTok, Google Бизнес.

- Адрес: https://app.airfixer.ge (служебный *.workers.dev выключен)
- Деплой: автоматически при пуше в `main` (Workers Builds). Перед деплоем wrangler сам собирает интерфейс (`npm run build:web`).
- База: таблицы создаются/обновляются сами при первом запросе (`worker/lib/migrate.ts`, файлы `migrations/*.sql`). Новая миграция — новый файл + строка в `MIGRATIONS`; старые не менять.

## Секреты (Cloudflare → Settings → Variables and Secrets, тип Secret)
`APP_PASSWORD`, `UPLOAD_TOKEN`, `TOKEN_KEY` (шифрование токенов соцсетей и ключа кода, base64 32 байта), `BUFFER_API_KEY`, `META_APP_SECRET`, `THREADS_APP_SECRET`, `GOOGLE_CLIENT_SECRET`, `TG_BOT_TOKEN`.
ID приложений (Meta, Threads, Google) — не секреты, лежат в коде.

## Структура
- `worker/` — сервер: `index.ts` (маршруты и cron), `middleware/` (вход, заголовки безопасности, CSRF), `routes/`, `services/` (по соцсетям: `meta.ts`, `threads.ts`, `youtube.ts`, `telegram.ts`, `buffer.ts`/`publish.ts`; прямая очередь — `direct.ts`; история и статистика — `history.ts`), `lib/`.
- `web/` — интерфейс: `features/` (экраны), `components/m3/` (компоненты M3), `api/` (запросы + React Query).
- `shared/` — Zod-схемы, общие для сервера и интерфейса.
- `scripts/icons.mjs` — пересобрать значки (`web/components/m3/icons.ts`) из `@material-symbols/svg-400` по списку `scripts/icons-list.txt`.

## Cron
- Каждую минуту: прямые посты, у которых подошло время (загрузка YouTube — по 64 МБ за раз), цифры опубликованных постов, уведомления (посты, работа Claude); в :07 каждого часа — посты Buffer.
- Раз в сутки (03:00 UTC): уборка хранилища, продление ключей Threads, проверка всех подключений, копия истории Buffer, чистка журнала (год) и кэша.

## Уведомления
Бот `TG_BOT_TOKEN` (@fixerairbot) пишет владельцу в личный чат (ID чата — `app_settings.notify_chat_id`, задаёт Claude: `PUT /api/v2/ingest/agent/notify-chat`). Виды: пост не вышел, пост вышел, подключение сломалось (раз в сутки), Claude выполнил задание / монтаж готов. Включаются и выключаются в «Настройках». Отправленное отмечается (`direct_posts.notified_status`, `notify_log`) — повторов нет.

## Повтор роликов
У ролика в «Библиотеке» галочка «Можно повторять» (`media.repostable`). Список «Можно повторить» (`GET /publish/reposts`): в соцсеть, где ролика не было, — сразу; где был — через 90 дней (`worker/services/reposts.ts`). Сверху — ролики с лучшим результатом относительно обычного для канала. «Повторить» открывает окно поста с прошлой подписью. Сам ничего не публикует.

## Проверка перед отправкой
- `npm run check` — типы (строгий TS, без неиспользуемого кода) + сборка интерфейса.
- `npm test` — автотесты (~20 с): локальный Worker с чистой базой + заглушки всех соцсетей (`tests/harness.mjs`, `tests/mocks.mjs`, `tests/app.test.mjs`): безопасность, вход, автозагрузка, публикация в Instagram/Facebook/Telegram/YouTube/Threads, статистика, история, вставки, лучшее время, повтор роликов, перебор пароля.
- **Выкладка проверяется сама:** в Workers Builds `wrangler deploy` запускает `scripts/build.mjs` → типы + сборка + тесты. Упал хоть один тест — выкладки нет, на сайте остаётся прежняя версия. Новая функция — новый тест в `tests/app.test.mjs`.

## Вход
Пароль (`APP_PASSWORD`) + 6 цифр из «Паролей» Apple. Вход без срока — до «Выйти на всех устройствах» (раздел «Настройки»); на доверенном устройстве код больше не спрашивается. 8 неверных попыток с одного IP → пауза 15 минут. Необязательно — Face ID / Touch ID (ключи входа).

**Потерял телефон с кодами:** Cloudflare → Storage & Databases → D1 → `postfixer` → Console → выполнить
`DELETE FROM auth_settings; DELETE FROM trusted_devices; DELETE FROM sessions;` → при следующем входе приложение предложит подключить код заново.
