-- 0015: убрать таблицы, которые код никогда не использовал (черновик схемы 0001 и несостоявшийся мгновенный запуск Claude).
-- Порядок: сначала зависимые.
DROP TABLE IF EXISTS post_stats;
DROP TABLE IF EXISTS post_targets;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS channels;
DROP TABLE IF EXISTS best_times;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS agent_wakeups;
DROP TABLE IF EXISTS agent_tokens;
