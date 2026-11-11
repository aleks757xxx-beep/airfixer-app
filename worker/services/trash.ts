/**
 * Корзина (решение владельца 11.11.2026): старые версии роликов, которые не вышли, не нужны в библиотеке.
 * - В корзину: вручную («🗑 В корзину») или сами — когда другую версию того же ролика поставили в публикацию.
 * - Через 14 дней — насовсем: файл в R2 и карточка; файл в «Готовом» стирает Claude (как обычное удаление).
 * - Номер ролика и пометки исходников при этом не теряются (строка в базе остаётся с deleted_at).
 */
export const TRASH_DAYS = 14;
export const TRASH_MS = TRASH_DAYS * 86_400_000;

/** «19 Мойка в клубе v9.mp4» и «19 Мойка в клубе.mp4» — один ролик; «Монтаж #3 v2 Тема» и «Монтаж #3 v1 Тема» — тоже. */
export function versionBase(name: string): string {
  let s = name.normalize("NFC").toLowerCase().trim();
  s = s.replace(/\.(mp4|mov|m4v)$/i, "").replace(/\.tg$/i, "");
  s = s.replace(/\s*\(заказ #(\d+) v\d+\)$/i, " (заказ #$1)");
  s = s.replace(/^монтаж #(\d+) v\d+ /i, "монтаж #$1 ");
  s = s.replace(/\s+v\d+$/i, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Ролики, которые уже стоят в публикации или вышли (в т.ч. мимо PostFixer). */
async function usedIds(db: D1Database): Promise<Set<string>> {
  const r = await db
    .prepare(
      `SELECT media_id FROM direct_posts WHERE status != 'draft' AND media_id IS NOT NULL
       UNION SELECT media_id FROM post_media WHERE COALESCE(draft, 0) = 0
       UNION SELECT id FROM media WHERE published_outside = 1`,
    )
    .all<{ media_id: string }>();
  return new Set(r.results.map((x) => x.media_id));
}

/** Есть ли у ролика запланированный (ещё не вышедший) прямой пост. */
export async function hasScheduled(db: D1Database, id: string): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM direct_posts WHERE media_id = ? AND status IN ('scheduled','processing') LIMIT 1").bind(id).first<{ x: number }>();
  return !!r;
}

/** Старые версии, которые не выходили, — в корзину, если более новую версию того же ролика поставили в публикацию. */
export async function autoTrash(db: D1Database): Promise<string[]> {
  const rows = (
    await db.prepare("SELECT id, name, created_at, trash_reason FROM media WHERE deleted_at IS NULL AND trashed_at IS NULL").all<{ id: string; name: string; created_at: number; trash_reason: string | null }>()
  ).results;
  const used = await usedIds(db);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = versionBase(r.name);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const trash: string[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const posted = list.filter((r) => used.has(r.id));
    if (!posted.length) continue;
    const newest = Math.max(...posted.map((r) => r.created_at));
    for (const r of list) if (!used.has(r.id) && r.created_at < newest && r.trash_reason !== "kept") trash.push(r.id);
  }
  const now = Date.now();
  for (const id of trash) await db.prepare("UPDATE media SET trashed_at = ?, trash_reason = 'old_version' WHERE id = ? AND trashed_at IS NULL").bind(now, id).run();
  return trash;
}

/** Удалить насовсем: файл и копия для Telegram в R2, карточка помечается удалённой (Claude потом стирает файл в «Готовом»). */
export async function hardDelete(db: D1Database, bucket: R2Bucket, id: string): Promise<{ name: string } | null> {
  const row = await db.prepare("SELECT r2_key, name FROM media WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ r2_key: string; name: string }>();
  if (!row) return null;
  await bucket.delete(row.r2_key);
  const variants = await db.prepare("SELECT r2_key FROM media_variants WHERE media_id = ?").bind(id).all<{ r2_key: string }>();
  for (const v of variants.results) await bucket.delete(v.r2_key);
  await db.batch([db.prepare("UPDATE media SET deleted_at = ? WHERE id = ?").bind(Date.now(), id), db.prepare("DELETE FROM media_variants WHERE media_id = ?").bind(id)]);
  return { name: row.name };
}

/** Ночью: всё, что лежит в корзине дольше 14 дней, — насовсем. */
export async function purgeTrash(db: D1Database, bucket: R2Bucket): Promise<string[]> {
  const old = (await db.prepare("SELECT id FROM media WHERE deleted_at IS NULL AND trashed_at IS NOT NULL AND trashed_at < ?").bind(Date.now() - TRASH_MS).all<{ id: string }>()).results;
  const done: string[] = [];
  for (const r of old) {
    const d = await hardDelete(db, bucket, r.id);
    if (d) done.push(d.name);
  }
  return done;
}
