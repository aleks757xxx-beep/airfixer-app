-- Ролик вышел мимо PostFixer (например, старый 18-й): его исходники помечены, даже если постов в базе нет
ALTER TABLE media ADD COLUMN published_outside INTEGER;
