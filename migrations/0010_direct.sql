-- Прямая публикация (без Buffer): подключённые аккаунты Instagram/Facebook/YouTube, своя очередь
CREATE TABLE IF NOT EXISTS direct_accounts (
  id               TEXT PRIMARY KEY,     -- 'ig:<id>' | 'fb:<pageId>' | 'yt:<channelId>'
  service          TEXT NOT NULL CHECK (service IN ('instagram', 'facebook', 'youtube')),
  name             TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  page_id          TEXT,                 -- Instagram: страница Facebook, к которой привязан
  token_enc        TEXT NOT NULL,        -- токен, зашифрован AES-GCM (TOKEN_KEY)
  token_expires_at INTEGER,
  replaces         TEXT,                 -- id канала Buffer, который заменяет
  slots            TEXT,                 -- JSON [{day, times[]}], как расписание Buffer
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_posts (
  id            TEXT PRIMARY KEY,        -- 'dp_<uuid>'
  account_id    TEXT NOT NULL,
  media_id      TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  title         TEXT,
  first_comment TEXT,
  thumb_ms      INTEGER,
  due_at        INTEGER,                 -- NULL = черновик
  status        TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'processing', 'sent', 'error')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  container_id  TEXT,                    -- Instagram: контейнер; Facebook: video_id
  external_id   TEXT,                    -- id опубликованного поста
  external_link TEXT,
  error         TEXT,
  author        TEXT NOT NULL CHECK (author IN ('owner', 'claude')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  sent_at       INTEGER
);
CREATE INDEX IF NOT EXISTS direct_posts_due ON direct_posts (status, due_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
