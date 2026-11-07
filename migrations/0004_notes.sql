-- Задание для Claude у ролика: текст владельца, статус и ответ Claude
ALTER TABLE media ADD COLUMN note TEXT;
ALTER TABLE media ADD COLUMN note_status TEXT;   -- 'new' | 'done' | NULL
ALTER TABLE media ADD COLUMN note_reply TEXT;
ALTER TABLE media ADD COLUMN note_at INTEGER;
