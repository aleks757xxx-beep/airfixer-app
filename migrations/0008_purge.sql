-- Удалённые в приложении ролики: когда Claude стёр файл из «Готового» на Mac
ALTER TABLE media ADD COLUMN purged_at INTEGER;
