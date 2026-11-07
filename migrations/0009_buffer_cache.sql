-- Кэш ответов Buffer (лимит API: 100 запросов / 15 мин, 250 / сутки)
CREATE TABLE IF NOT EXISTS buffer_cache (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at    INTEGER NOT NULL
);
