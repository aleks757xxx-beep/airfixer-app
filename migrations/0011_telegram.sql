-- Telegram (и на будущее Threads): расширить список сетей прямой публикации.
-- В SQLite ограничение CHECK не меняется — пересоздаём таблицу с теми же данными.
CREATE TABLE direct_accounts_new (
  id               TEXT PRIMARY KEY,     -- 'ig:<id>' | 'fb:<pageId>' | 'yt:<channelId>' | 'tg:<chatId>' | 'th:<id>'
  service          TEXT NOT NULL CHECK (service IN ('instagram', 'facebook', 'youtube', 'telegram', 'threads')),
  name             TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  page_id          TEXT,                 -- Instagram: страница Facebook; Telegram: @адрес канала (для ссылок)
  token_enc        TEXT NOT NULL,        -- токен, зашифрован AES-GCM (TOKEN_KEY); Telegram: '' (бот — секрет TG_BOT_TOKEN)
  token_expires_at INTEGER,
  replaces         TEXT,
  slots            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
INSERT INTO direct_accounts_new SELECT id, service, name, external_id, page_id, token_enc, token_expires_at, replaces, slots, created_at, updated_at FROM direct_accounts;
DROP TABLE direct_accounts;
ALTER TABLE direct_accounts_new RENAME TO direct_accounts;

-- Лёгкие копии роликов: «имя.tg.mp4» из «Готового» (до 50 МБ — ограничение ботов Telegram)
CREATE TABLE IF NOT EXISTS media_variants (
  base       TEXT NOT NULL,              -- имя ролика без расширения, строчными
  kind       TEXT NOT NULL,              -- 'tg'
  media_id   TEXT,                       -- ролик в библиотеке (NULL, пока сам ролик не загрузился)
  r2_key     TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (base, kind)
);
CREATE INDEX IF NOT EXISTS media_variants_media ON media_variants (media_id);
