-- Вход по Face ID / Touch ID («ключи входа», WebAuthn). Решение владельца 08.11.2026.
CREATE TABLE IF NOT EXISTS passkeys (
  id           TEXT PRIMARY KEY,     -- id ключа (base64url)
  public_key   TEXT NOT NULL,        -- открытый ключ (base64url)
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                 -- JSON
  device       TEXT,                 -- где создан (для списка)
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
-- Одноразовые «вызовы» для создания ключа и входа (живут 5 минут)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  kind       TEXT NOT NULL,          -- 'register' | 'login'
  created_at INTEGER NOT NULL
);
