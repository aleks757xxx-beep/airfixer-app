-- 0016: уведомления владельцу в Telegram (о вышедших и не вышедших постах, подключениях, работе Claude)
ALTER TABLE direct_posts ADD COLUMN notified_status TEXT;   -- о каком статусе поста уже сообщили
UPDATE direct_posts SET notified_status = status WHERE status IN ('sent', 'error');
CREATE TABLE IF NOT EXISTS notify_log (
  key TEXT PRIMARY KEY,                                     -- что уже отправлено (пост Buffer, задание, заказ, подключение)
  at  INTEGER NOT NULL
);
-- старое уже сделано — не присылать
INSERT OR IGNORE INTO notify_log (key, at) SELECT 'task:' || id || ':' || note_at, 0 FROM media WHERE note_status = 'done' AND note_at IS NOT NULL;
INSERT OR IGNORE INTO notify_log (key, at) SELECT 'order:' || id, 0 FROM edit_events WHERE author = 'claude' AND kind = 'draft';
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('notify_since', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
