/** Привязки и секреты Worker (wrangler.jsonc + Settings → Runtime variables and secrets). */
export interface Env {
  ASSETS: Fetcher;
  BUCKET: R2Bucket;
  DB: D1Database;
  APP_PASSWORD?: string;
  BUFFER_API_KEY?: string;
  UPLOAD_TOKEN?: string;
  /** Только для локальной проверки: адрес заглушки Buffer */
  BUFFER_API_URL?: string;
  /** Приложение Meta (Instagram/Facebook напрямую) */
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  /** Ключ шифрования токенов соцсетей (base64, 32 байта) */
  TOKEN_KEY?: string;
  /** Только для локальной проверки: адрес заглушки Graph API */
  META_GRAPH_URL?: string;
  /** Бот Telegram для публикации в канал (секрет от @BotFather) */
  TG_BOT_TOKEN?: string;
  /** Только для локальной проверки (заглушка Bot API) */
  TG_API_URL?: string;
}

export type AppBindings = { Bindings: Env };
