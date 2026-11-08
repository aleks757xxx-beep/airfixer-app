-- Claude берётся за задания сам (решение владельца 08.11.2026): PostFixer запускает задачу Claude по сигналу.
-- Временные ключи для запуска (12 ч): Claude получает ключ в тексте запуска, постоянный UPLOAD_TOKEN ему не нужен.
CREATE TABLE IF NOT EXISTS agent_tokens (
  id         TEXT PRIMARY KEY,   -- sha256 ключа
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Очередь сигналов: что нового для Claude (сводится в один запуск)
CREATE TABLE IF NOT EXISTS agent_wakeups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fired_at   INTEGER             -- NULL — ещё не отправлен
);
