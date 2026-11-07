-- Настройки приложения (ключ → значение), например ссылка на чат с Claude
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  INTEGER
);
