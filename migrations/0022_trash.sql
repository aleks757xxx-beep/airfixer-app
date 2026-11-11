-- 0022: корзина — ненужные версии роликов (вручную или сами, когда новую версию поставили в публикацию); через 14 дней удаляются насовсем
ALTER TABLE media ADD COLUMN trashed_at INTEGER;
ALTER TABLE media ADD COLUMN trash_reason TEXT;
