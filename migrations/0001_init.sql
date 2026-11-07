-- PostFixer: начальная схема (D1 / SQLite)
-- Повторный запуск безопасен: только CREATE ... IF NOT EXISTS

CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,               -- UUID
  r2_key      TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  mime        TEXT,
  source      TEXT NOT NULL CHECK (source IN ('upload', 'gotovoe')),
  created_at  INTEGER NOT NULL,               -- unix ms
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS media_created ON media (created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  media_id    TEXT REFERENCES media (id),
  due_at      INTEGER,                        -- NULL = черновик без даты
  status      TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'partial')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_due ON posts (due_at);

CREATE TABLE IF NOT EXISTS post_targets (
  id              TEXT PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  channel_id      TEXT NOT NULL,
  service         TEXT NOT NULL,
  text            TEXT NOT NULL DEFAULT '',
  title           TEXT,                       -- YouTube
  buffer_post_id  TEXT,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  error           TEXT,
  published_at    INTEGER
);
CREATE INDEX IF NOT EXISTS post_targets_post ON post_targets (post_id);
CREATE INDEX IF NOT EXISTS post_targets_buffer ON post_targets (buffer_post_id);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,               -- id канала в Buffer
  service     TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar      TEXT,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_stats (
  target_id   TEXT NOT NULL REFERENCES post_targets (id) ON DELETE CASCADE,
  fetched_at  INTEGER NOT NULL,
  views       INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
  PRIMARY KEY (target_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS best_times (
  channel_id  TEXT NOT NULL,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  hour        INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  score       REAL NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, weekday, hour)
);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Вход: сессии на сервере, 2FA, лимит попыток, журнал
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,               -- хэш токена сессии
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  mfa_ok      INTEGER NOT NULL DEFAULT 0,
  user_agent  TEXT,
  last_seen   INTEGER
);

CREATE TABLE IF NOT EXISTS auth_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  totp_secret_enc  TEXT,                      -- зашифрован ключом из секрета
  totp_enabled_at  INTEGER
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip  TEXT NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, at);

CREATE TABLE IF NOT EXISTS audit_log (
  at       INTEGER NOT NULL,
  action   TEXT NOT NULL,
  details  TEXT
);
