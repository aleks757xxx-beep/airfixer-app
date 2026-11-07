# AirFixer — приложение для постинга

Cloudflare Worker: загрузка роликов в R2 (`airfixer-video`) и планирование постов в Buffer (Facebook, Instagram, TikTok, YouTube).

- Адрес: https://app.airfixer.ge (вход: любой логин + пароль `APP_PASSWORD`)
- Секреты в Cloudflare: `BUFFER_API_KEY`, `APP_PASSWORD`
- Деплой: автоматически при пуше в `main` (Workers Builds)

Подключено к Cloudflare Workers Builds: 2026-11-07.
