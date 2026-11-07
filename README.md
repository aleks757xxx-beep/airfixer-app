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
