-- Загрузка больших роликов частями (R2 multipart): незавершённые загрузки

CREATE TABLE IF NOT EXISTS uploads (
  id            TEXT PRIMARY KEY,            -- наш id загрузки
  r2_key        TEXT NOT NULL,
  r2_upload_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  mime          TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('upload', 'gotovoe')),
  created_at    INTEGER NOT NULL
);
