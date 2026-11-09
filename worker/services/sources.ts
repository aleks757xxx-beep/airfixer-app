import type { SourceRenames } from "../../shared/schemas";
import { baseOf } from "../routes/media";

/**
 * Пометка исходников (решение владельца 09.11.2026).
 * Когда смонтированный ролик впервые запланирован (любой пост, кроме черновика), он получает номер в «Готовом»
 * (одна нумерация со старыми 1–18), а его исходники — пометку в начале имени:
 *   «#19 IMG_1234.MOV», кусок — «#19 (0:12–0:20) IMG_1234.MOV», в двух роликах — «#19 #23 IMG_1234.MOV».
 * Ролик в «Готовом»: «Монтаж #1 v1 Тема.mp4» → «19 Тема (заказ #1 v1).mp4».
 * Сняли все посты ролика до выхода — пометки уходят (номер ролика остаётся). Старые ролики 1–18 не трогаем.
 * Переименовывает Claude на Mac: GET /sources/renames → mv → POST /sources/renamed.
 */

/** Убрать наши пометки из имени: «#19 (0:12–0:20) #23 IMG_1.MOV» → «IMG_1.MOV». */
export const stripMarks = (name: string) => name.replace(/^(?:#\d+(?: \([^)]*\))? )+/, "");

const clock = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Имя ролика в «Готовом» с номером. */
export function numberedName(name: string, n: number): string {
  if (new RegExp(`^${n}[ .]`).test(name)) return name;
  const m = /^Монтаж #(\d+) v(\d+) (.+?)(\.[a-z0-9]+)$/i.exec(name);
  if (m) return `${n} ${m[3]} (заказ #${m[1]} v${m[2]})${m[4]}`;
  return `${n} ${name}`;
}

/** Ролики, у которых есть запланированный/вышедший пост (не черновик). */
async function scheduled(db: D1Database): Promise<Map<string, number>> {
  const r = await db
    .prepare(
      `SELECT media_id, MIN(at) AS at FROM (
         SELECT media_id, created_at AS at FROM direct_posts WHERE status != 'draft'
         UNION ALL SELECT media_id, created_at AS at FROM post_media WHERE COALESCE(draft, 0) = 0
         UNION ALL SELECT id AS media_id, created_at AS at FROM media WHERE published_outside = 1
       ) GROUP BY media_id`,
    )
    .all<{ media_id: string; at: number }>();
  return new Map(r.results.map((x) => [x.media_id, x.at]));
}

/** Дать номера запланированным монтажам без номера — по порядку, в котором их запланировали. */
async function assignNumbers(db: D1Database, plan: Map<string, number>, gotovoeMax: number): Promise<void> {
  const montages = (
    await db.prepare("SELECT DISTINCT s.media_id AS id, m.number, m.name FROM media_sources s JOIN media m ON m.id = s.media_id").all<{ id: string; number: number | null; name: string }>()
  ).results;
  const todo = montages.filter((m) => m.number === null && plan.has(m.id)).sort((a, b) => (plan.get(a.id) ?? 0) - (plan.get(b.id) ?? 0));
  if (!todo.length) return;
  const lead = (name: string) => Number(/^(\d+)[ .]/.exec(name)?.[1] ?? 0);
  const taken = new Set((await db.prepare("SELECT number FROM media WHERE number IS NOT NULL").all<{ number: number }>()).results.map((x) => x.number));
  const left: typeof todo = [];
  for (const m of todo) {
    // ролик уже назван с номером («19 Мойка в клубе.mp4») — этот номер и берём, если он свободен
    const n = lead(m.name);
    if (n > 0 && !taken.has(n)) {
      await db.prepare("UPDATE media SET number = ? WHERE id = ? AND number IS NULL").bind(n, m.id).run();
      taken.add(n);
    } else left.push(m);
  }
  if (!left.length) return;
  const names = (await db.prepare("SELECT name FROM media WHERE source = 'gotovoe'").all<{ name: string }>()).results;
  let next = Math.max(0, ...taken, ...names.map((x) => lead(x.name)), gotovoeMax) + 1;
  for (const m of left) await db.prepare("UPDATE media SET number = ? WHERE id = ? AND number IS NULL").bind(next++, m.id).run();
}

interface SourceRow {
  media_id: string;
  folder: string;
  orig: string;
  file: string;
  from_s: number | null;
  to_s: number | null;
}

export async function sourceRenames(db: D1Database, gotovoeMax = 0): Promise<SourceRenames> {
  const plan = await scheduled(db);
  await assignNumbers(db, plan, gotovoeMax);
  const nums = new Map(
    (await db.prepare("SELECT id, number FROM media WHERE number IS NOT NULL").all<{ id: string; number: number }>()).results.map((m) => [m.id, m.number]),
  );
  const rows = (await db.prepare("SELECT media_id, folder, orig, file, from_s, to_s FROM media_sources").all<SourceRow>()).results;
  const byFile = new Map<string, SourceRow[]>();
  for (const r of rows) {
    const k = `${r.folder}\u0000${r.orig}`;
    byFile.set(k, [...(byFile.get(k) ?? []), r]);
  }
  const sources: SourceRenames["sources"] = [];
  for (const list of byFile.values()) {
    const first = list[0];
    if (!first) continue;
    const marks: Array<{ n: number; text: string }> = [];
    for (const mediaId of new Set(list.map((r) => r.media_id))) {
      const n = nums.get(mediaId);
      if (n === undefined || !plan.has(mediaId)) continue;
      const parts = list.filter((r) => r.media_id === mediaId);
      const whole = parts.some((r) => r.from_s === null || r.to_s === null);
      const ranges = whole
        ? ""
        : ` (${parts
            .sort((a, b) => (a.from_s ?? 0) - (b.from_s ?? 0))
            .map((r) => `${clock(r.from_s ?? 0)}–${clock(r.to_s ?? 0)}`)
            .join(", ")})`;
      marks.push({ n, text: `#${n}${ranges}` });
    }
    marks.sort((a, b) => a.n - b.n);
    const to = marks.length ? `${marks.map((m) => m.text).join(" ")} ${first.orig}` : first.orig;
    if (to !== first.file) sources.push({ folder: first.folder, from: first.file, to });
  }
  const media = (
    await db.prepare("SELECT id, name, number FROM media WHERE number IS NOT NULL AND source = 'gotovoe' AND deleted_at IS NULL").all<{ id: string; name: string; number: number }>()
  ).results;
  const gotovoe = media
    .filter((m) => plan.has(m.id))
    .map((m) => ({ mediaId: m.id, number: m.number, from: m.name, to: numberedName(m.name, m.number) }))
    .filter((m) => m.from !== m.to);
  return { sources, gotovoe };
}

/** Claude переименовал файл на диске. */
export async function markRenamed(db: D1Database, folder: string, from: string, to: string): Promise<number> {
  const r = await db.prepare("UPDATE media_sources SET file = ? WHERE folder = ? AND file = ?").bind(to.normalize("NFC"), folder.normalize("NFC"), from.normalize("NFC")).run();
  return r.meta.changes ?? 0;
}

/** Какие исходники вошли в ролик (заменяет прежний список этого ролика). */
export async function setSources(
  db: D1Database,
  mediaId: string,
  items: ReadonlyArray<{ folder: string; file: string; from?: number; to?: number }>,
): Promise<void> {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM media_sources WHERE media_id = ?").bind(mediaId)];
  for (const it of items) {
    const folder = it.folder.normalize("NFC");
    const file = it.file.normalize("NFC");
    const orig = stripMarks(file);
    const known = await db.prepare("SELECT file FROM media_sources WHERE folder = ? AND orig = ? AND media_id != ? LIMIT 1").bind(folder, orig, mediaId).first<{ file: string }>();
    stmts.push(
      db
        .prepare("INSERT INTO media_sources (id, media_id, folder, orig, file, from_s, to_s, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), mediaId, folder, orig, known?.file ?? file, it.from ?? null, it.to ?? null, now),
    );
  }
  await db.batch(stmts);
}

/** Ролик в «Готовом» переименован: имя в библиотеке и у лёгкой копии для Telegram (иначе автозагрузка примет его за новый). */
export async function renameMedia(db: D1Database, id: string, name: string): Promise<boolean> {
  const m = await db.prepare("SELECT name FROM media WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ name: string }>();
  if (!m) return false;
  const stem = name.replace(/\.[a-z0-9]+$/i, "");
  await db.batch([
    db.prepare("UPDATE media SET name = ? WHERE id = ?").bind(name, id),
    db
      .prepare("UPDATE media_variants SET base = ?, name = ? || substr(name, instr(lower(name), '.tg.')) WHERE media_id = ?")
      .bind(baseOf(name), stem, id),
  ]);
  return true;
}

/** Ролик вышел мимо PostFixer: задать его номер в «Готовом» (например, 18) — его исходники будут помечены. */
export async function markPublishedOutside(db: D1Database, id: string, number: number): Promise<boolean> {
  const taken = await db.prepare("SELECT id FROM media WHERE number = ? AND id != ?").bind(number, id).first();
  if (taken) throw new Error(`Номер ${number} уже у другого ролика`);
  const r = await db.prepare("UPDATE media SET number = ?, published_outside = 1 WHERE id = ?").bind(number, id).run();
  return (r.meta.changes ?? 0) > 0;
}
