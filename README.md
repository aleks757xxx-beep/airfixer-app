# PostFixer — приложение для постинга AirFixer

Cloudflare Worker (Hono + TypeScript) + интерфейс React/Vite/Tailwind. Ролики в R2 (`airfixer-video`), данные в D1 (`postfixer`), публикация через Buffer API.

- Адрес: https://app.airfixer.ge
- Секреты (Settings → Runtime variables and secrets, тип **Secret**): `APP_PASSWORD`, `BUFFER_API_KEY`, `UPLOAD_TOKEN`.
- Деплой: автоматически при пуше в `main` (Workers Builds). Перед деплоем wrangler сам собирает интерфейс (`npm run build:web`).
- База: таблицы создаются/обновляются сами при первом запросе (`worker/lib/migrate.ts`, файлы `migrations/*.sql`). Новая миграция — новый файл + строка в `MIGRATIONS`; старые не менять.

## Структура
- `worker/` — сервер: `index.ts` (маршруты), `middleware/` (заголовки безопасности, CSRF), `routes/`, `lib/`.
- `web/` — интерфейс: `features/` (экраны), `components/`, `api/` (запросы + React Query).
- `shared/` — Zod-схемы, общие для сервера и интерфейса.

## Проверка перед отправкой
`npm run check` — типы (строгий TS) + сборка интерфейса.

## Вход
Пароль (`APP_PASSWORD`) + 6 цифр из Google Authenticator. Вход без срока — до «Выйти» (решение владельца); на устройстве, где ввели код, код больше не спрашивается. 8 неверных попыток с одного IP → пауза 15 минут. «Выйти на всех устройствах» — в разделе «Состояние».

**Потерял телефон с кодами:** Cloudflare → Storage & Databases → D1 → `postfixer` → Console → выполнить
`DELETE FROM auth_settings; DELETE FROM trusted_devices; DELETE FROM sessions;` → при следующем входе приложение предложит подключить код заново.
