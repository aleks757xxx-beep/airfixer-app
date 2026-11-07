-- Заказы монтажа: владелец заказывает ролик, Claude монтирует на Mac, черновики и правки — в истории заказа
CREATE TABLE IF NOT EXISTS edit_orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,   -- номер заказа (#1, #2…)
  status       TEXT NOT NULL CHECK (status IN ('new', 'in_work', 'draft', 'revise', 'accepted', 'cancelled')),
  shoot_date   TEXT,                                -- дата съёмки YYYY-MM-DD
  folder       TEXT,                                -- папка в «Исходниках»
  brief        TEXT NOT NULL,                       -- что снято и сценарий
  duration_sec INTEGER,
  style        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS edit_orders_status ON edit_orders (status, updated_at);

CREATE TABLE IF NOT EXISTS edit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES edit_orders (id),
  kind       TEXT NOT NULL CHECK (kind IN ('created', 'in_work', 'comment', 'draft', 'revise', 'accepted', 'cancelled')),
  author     TEXT NOT NULL CHECK (author IN ('owner', 'claude')),
  text       TEXT,
  media_id   TEXT,                                  -- черновик ролика (media.id)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS edit_events_order ON edit_events (order_id, id);
