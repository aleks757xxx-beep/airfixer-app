-- Какой ролик библиотеки стоит в посте Buffer (для превью в календаре и предупреждений)
CREATE TABLE IF NOT EXISTS post_media (
  buffer_post_id TEXT PRIMARY KEY,
  media_id       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  author         TEXT NOT NULL CHECK (author IN ('owner', 'claude')),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS post_media_media ON post_media (media_id);
