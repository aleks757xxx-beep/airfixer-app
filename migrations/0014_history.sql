-- 0014: история постов Buffer (копия до отключения каналов), вставки в PostFixer, цифры прямых постов
CREATE TABLE IF NOT EXISTS buffer_archive (
  id          TEXT PRIMARY KEY,            -- id поста в Buffer
  channel_id  TEXT NOT NULL,               -- канал Buffer
  service     TEXT NOT NULL,
  due_at      INTEGER,                     -- unix ms
  post        TEXT NOT NULL,               -- JSON: пост со статистикой (StatPost)
  archived_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS buffer_archive_due ON buffer_archive (due_at);

CREATE TABLE IF NOT EXISTS snippets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE direct_posts ADD COLUMN metrics TEXT;              -- JSON: [{type,name,value,unit}]
ALTER TABLE direct_posts ADD COLUMN metrics_updated_at INTEGER;
