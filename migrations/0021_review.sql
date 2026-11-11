-- 0021: «Работа с видео» — заметки к ролику (точка/отрезок, тип), раунды правок с ответами Claude, звук ролика
CREATE TABLE IF NOT EXISTS review_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  voice TEXT,
  reply TEXT,
  replied_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_review_rounds_media ON review_rounds(media_id);
CREATE TABLE IF NOT EXISTS review_notes (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  round_id INTEGER,
  kind TEXT NOT NULL,
  t_from REAL,
  t_to REAL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  reply TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_notes_media ON review_notes(media_id, status);
ALTER TABLE media ADD COLUMN voice TEXT;
