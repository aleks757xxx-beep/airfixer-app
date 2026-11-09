-- Пометка исходников, вошедших в запланированные ролики (решение владельца 09.11.2026)
ALTER TABLE media ADD COLUMN number INTEGER;          -- номер ролика в «Готовом» (одна нумерация со старыми 1–18), даётся при первом запланированном посте
ALTER TABLE post_media ADD COLUMN draft INTEGER;      -- 1 — пост Buffer в черновиках (не считается «запланирован»)
CREATE TABLE IF NOT EXISTS media_sources (
  id         TEXT PRIMARY KEY,
  media_id   TEXT NOT NULL,       -- смонтированный ролик
  folder     TEXT NOT NULL,       -- папка внутри «Исходников» (NFC), например «Чистка»
  orig       TEXT NOT NULL,       -- имя файла без наших пометок: IMG_1234.MOV
  file       TEXT NOT NULL,       -- как файл называется на диске сейчас
  from_s     REAL,                -- взятый кусок, секунды (NULL — файл целиком)
  to_s       REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_sources_media ON media_sources (media_id);
CREATE INDEX IF NOT EXISTS media_sources_file ON media_sources (folder, orig);
