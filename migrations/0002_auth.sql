-- Вход: подключение 2FA, защита от повторного кода, доверенные устройства

ALTER TABLE sessions ADD COLUMN pending_totp TEXT;      -- секрет 2FA на время подключения
ALTER TABLE auth_settings ADD COLUMN last_step INTEGER; -- последний принятый шаг кода (нельзя ввести тот же код дважды)

CREATE TABLE IF NOT EXISTS trusted_devices (
  id          TEXT PRIMARY KEY,               -- хэш токена устройства
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
