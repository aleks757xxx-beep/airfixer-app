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
- Каждую минуту: прямые посты, у которых подошло время (загрузка YouTube — по 64 МБ за раз), и цифры опубликованных постов.
- Раз в сутки (03:00 UTC): уборка хранилища, продление ключей Threads, копия истории Buffer, чистка журнала (год) и кэша.

## Проверка перед отправкой
`npm run check` — типы (строгий TS, без неиспользуемого кода) + сборка интерфейса.
`tests/security.cjs` — проверка безопасности на локальной копии (`wrangler dev --port 8799 --test-scheduled`).

## Вход
Пароль (`APP_PASSWORD`) + 6 цифр из «Паролей» Apple. Вход без срока — до «Выйти на всех устройствах» (раздел «Настройки»); на доверенном устройстве код больше не спрашивается. 8 неверных попыток с одного IP → пауза 15 минут. Необязательно — Face ID / Touch ID (ключи входа).

**Потерял телефон с кодами:** Cloudflare → Storage & Databases → D1 → `postfixer` → Console → выполнить
`DELETE FROM auth_settings; DELETE FROM trusted_devices; DELETE FROM sessions;` → при следующем входе приложение предложит подключить код заново.
