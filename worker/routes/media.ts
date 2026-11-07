import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import {
  ALLOWED_VIDEO_EXT,
  PART_SIZE,
  NoteInputSchema,
  TaskReplySchema,
  UploadCompleteInputSchema,
  UploadStartInputSchema,
  type MediaItem,
  type MediaList,
  type MediaSource,
  type NoteStatus,
  type TaskList,
  type UploadPart,
  type UploadResult,
  type UploadStart,
} from "../../shared/schemas";
import { audit } from "../middleware/auth";
import { safeEqual } from "../lib/crypto";
import { ensureMigrated } from "../lib/migrate";

const FREE_R2_BYTES = 10 * 1024 ** 3; // 10 ГБ бесплатно
const UPLOAD_TTL_MS = 24 * 3600 * 1000; // незавершённая загрузка живёт сутки

interface MediaRow {
  id: string;
  r2_key: string;
  name: string;
  size: number;
  mime: string | null;
  source: MediaSource;
  created_at: number;
  note: string | null;
  note_status: NoteStatus | null;
  note_reply: string | null;
  note_at: number | null;
}
interface UploadRow {
  id: string;
  r2_key: string;
  r2_upload_id: string;
  name: string;
  size: number;
  mime: string;
  source: MediaSource;
  created_at: number;
}

/** url — путь на этом же сайте; полный адрес для Buffer собирается при публикации. */
const toItem = (r: MediaRow): MediaItem => ({
  id: r.id,
  name: r.name,
  size: r.size,
  mime: r.mime,
  source: r.source,
  createdAt: r.created_at,
  url: `/media/${r.r2_key}`,
  note: r.note,
  noteStatus: r.note_status,
  noteReply: r.note_reply,
  noteAt: r.note_at,
});
const MEDIA_COLS = "id, r2_key, name, size, mime, source, created_at, note, note_status, note_reply, note_at";

function extOf(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  const ext = m?.[1]?.toLowerCase() ?? null;
  return ext && (ALLOWED_VIDEO_EXT as ReadonlyArray<string>).includes(ext) ? ext : null;
}
const mimeFor = (ext: string) => (ext === "mov" ? "video/quicktime" : "video/mp4");
const cleanName = (raw: string) => raw.normalize("NFC").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160) || "video.mp4";

type Ctx = Context<AppBindings>;
const partsCount = (size: number) => Math.max(1, Math.ceil(size / PART_SIZE));

/** Начать загрузку частями. Если такой ролик уже есть (имя + размер) — вернуть его. */
async function start(c: Ctx, source: MediaSource): Promise<Response> {
  const parsed = UploadStartInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Неверные данные файла (или файл больше 5 ГБ)" }, 400);
  const name = cleanName(parsed.data.name);
  const ext = extOf(name);
  if (!ext) return c.json({ error: "Можно загружать только видео .mp4, .mov, .m4v" }, 400);
  const size = parsed.data.size;

  const dup = await c.env.DB.prepare(
    `SELECT ${MEDIA_COLS} FROM media WHERE name = ? AND size = ? AND deleted_at IS NULL`,
  )
    .bind(name, size)
    .first<MediaRow>();
  if (dup) {
    const r: UploadStart = { duplicate: true, item: toItem(dup) };
    return c.json(r);
  }

  const id = crypto.randomUUID();
  const key = `videos/${id}.${ext}`; // случайное имя — не подобрать
  const mime = mimeFor(ext);
  const mp = await c.env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare(
    "INSERT INTO uploads (id, r2_key, r2_upload_id, name, size, mime, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, key, mp.uploadId, name, size, mime, source, Date.now())
    .run();
  const r: UploadStart = { duplicate: false, uploadId: id, partSize: PART_SIZE, parts: partsCount(size) };
  return c.json(r);
}

async function getUpload(c: Ctx, source: MediaSource): Promise<UploadRow | null> {
  const row = await c.env.DB.prepare(
    "SELECT id, r2_key, r2_upload_id, name, size, mime, source, created_at FROM uploads WHERE id = ? AND source = ?",
  )
    .bind(c.req.param("uploadId") ?? "", source)
    .first<UploadRow>();
  if (!row || row.created_at < Date.now() - UPLOAD_TTL_MS) return null;
  return row;
}

/** Одна часть (до 50 МБ). Номера частей с 1. */
async function part(c: Ctx, source: MediaSource): Promise<Response> {
  const up = await getUpload(c, source);
  if (!up) return c.json({ error: "Загрузка не найдена или устарела — начните заново" }, 404);
  const n = Number(c.req.param("n"));
  const total = partsCount(up.size);
  if (!Number.isInteger(n) || n < 1 || n > total) return c.json({ error: "Неверный номер части" }, 400);
  const len = Number(c.req.header("Content-Length") ?? "0");
  const expected = n < total ? PART_SIZE : up.size - PART_SIZE * (total - 1);
  if (len !== expected) return c.json({ error: `Часть ${n}: ожидалось ${expected} байт, пришло ${len}` }, 400);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "Пустая часть" }, 400);
  const mp = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
  const uploaded = await mp.uploadPart(n, body);
  const r: UploadPart = { partNumber: uploaded.partNumber, etag: uploaded.etag };
  return c.json(r);
}

/** Собрать части в один файл и добавить ролик в библиотеку. */
async function complete(c: Ctx, source: MediaSource): Promise<Response> {
  const up = await getUpload(c, source);
  if (!up) return c.json({ error: "Загрузка не найдена или устарела — начните заново" }, 404);
  const parsed = UploadCompleteInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Неверный список частей" }, 400);
  const parts = [...parsed.data.parts].sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== partsCount(up.size)) return c.json({ error: "Загружены не все части" }, 400);

  const mp = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
  const obj = await mp.complete(parts);
  if (obj.size !== up.size) {
    await c.env.BUCKET.delete(up.r2_key);
    return c.json({ error: "Размер файла не совпал — загрузите заново" }, 400);
  }
  const row: MediaRow = { id: up.id, r2_key: up.r2_key, name: up.name, size: up.size, mime: up.mime, source: up.source, created_at: Date.now(), note: null, note_status: null, note_reply: null, note_at: null };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO media (id, r2_key, name, size, mime, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      row.id,
      row.r2_key,
      row.name,
      row.size,
      row.mime,
      row.source,
      row.created_at,
    ),
    c.env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(up.id),
  ]);
  await audit(c.env.DB, `media ${source}`, up.name);
  const r: UploadResult = { item: toItem(row), duplicate: false };
  return c.json(r);
}

async function mediaById(db: D1Database, id: string): Promise<MediaRow | null> {
  return db.prepare(`SELECT ${MEDIA_COLS} FROM media WHERE id = ? AND deleted_at IS NULL`).bind(id).first<MediaRow>();
}

const migrated: MiddlewareHandler<AppBindings> = async (c, next) => {
  await ensureMigrated(c.env.DB);
  await next();
};

/** Библиотека (только после входа). */
export const media = new Hono<AppBindings>()
  .use("*", migrated)
  .get("/", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT ${MEDIA_COLS} FROM media WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
    ).all<MediaRow>();
    const items = rows.results.map((r) => toItem(r));
    const body: MediaList = { items, totalBytes: items.reduce((s, i) => s + i.size, 0), limitBytes: FREE_R2_BYTES };
    return c.json(body);
  })
  .post("/uploads", (c) => start(c, "upload"))
  .put("/uploads/:uploadId/parts/:n", (c) => part(c, "upload"))
  .post("/uploads/:uploadId/complete", (c) => complete(c, "upload"))
  .put("/:id/note", async (c) => {
    const parsed = NoteInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Задание слишком длинное (до 2000 символов)" }, 400);
    const id = c.req.param("id");
    const note = parsed.data.note.trim();
    const res = await c.env.DB.prepare(
      "UPDATE media SET note = ?, note_status = ?, note_reply = NULL, note_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
      .bind(note || null, note ? "new" : null, note ? Date.now() : null, id)
      .run();
    if (!res.meta.changes) return c.json({ error: "Ролик не найден" }, 404);
    const row = await mediaById(c.env.DB, id);
    return row ? c.json({ item: toItem(row) }) : c.json({ error: "Ролик не найден" }, 404);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare("SELECT r2_key, name FROM media WHERE id = ? AND deleted_at IS NULL")
      .bind(id)
      .first<{ r2_key: string; name: string }>();
    if (!row) return c.json({ error: "Ролик не найден" }, 404);
    await c.env.BUCKET.delete(row.r2_key);
    await c.env.DB.prepare("UPDATE media SET deleted_at = ? WHERE id = ?").bind(Date.now(), id).run();
    await audit(c.env.DB, "media delete", row.name);
    return c.json({ ok: true as const });
  });

/** Проверка токена автозагрузки (UPLOAD_TOKEN). */
const uploadToken: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const expected = c.env.UPLOAD_TOKEN?.trim();
  if (!expected || !token || !(await safeEqual(token, expected))) return c.json({ error: "bad token" }, 401);
  await next();
};

/** Автозагрузка из папки «Готовое» на Mac (по токену, без входа). Те же шаги: start → parts → complete. */
export const ingest = new Hono<AppBindings>()
  .use("*", uploadToken)
  .use("*", migrated)
  // Для Claude: вся библиотека (найти ролик по id/имени)
  .get("/media", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT ${MEDIA_COLS} FROM media WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
    ).all<MediaRow>();
    const body: TaskList = { items: rows.results.map((r) => toItem(r)) };
    return c.json(body);
  })
  // Задания для Claude: список новых и ответ на задание
  .get("/tasks", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT ${MEDIA_COLS} FROM media WHERE deleted_at IS NULL AND note_status = 'new' ORDER BY note_at`,
    ).all<MediaRow>();
    const body: TaskList = { items: rows.results.map((r) => toItem(r)) };
    return c.json(body);
  })
  .post("/tasks/:id", async (c) => {
    const parsed = TaskReplySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Нужен ответ (до 2000 символов)" }, 400);
    const id = c.req.param("id");
    const res = await c.env.DB.prepare(
      "UPDATE media SET note_status = 'done', note_reply = ?, note_at = ? WHERE id = ? AND deleted_at IS NULL AND note IS NOT NULL",
    )
      .bind(parsed.data.reply.trim(), Date.now(), id)
      .run();
    if (!res.meta.changes) return c.json({ error: "Задание не найдено" }, 404);
    const row = await mediaById(c.env.DB, id);
    return row ? c.json({ item: toItem(row) }) : c.json({ error: "Задание не найдено" }, 404);
  })
  .post("/", (c) => start(c, "gotovoe"))
  .put("/:uploadId/parts/:n", (c) => part(c, "gotovoe"))
  .post("/:uploadId/complete", (c) => complete(c, "gotovoe"));

/** Уборка незавершённых загрузок старше суток (cron). */
export async function cleanupStaleUploads(db: D1Database, bucket: R2Bucket): Promise<number> {
  const old = await db
    .prepare("SELECT id, r2_key, r2_upload_id FROM uploads WHERE created_at < ?")
    .bind(Date.now() - UPLOAD_TTL_MS)
    .all<{ id: string; r2_key: string; r2_upload_id: string }>();
  for (const u of old.results) {
    try {
      await bucket.resumeMultipartUpload(u.r2_key, u.r2_upload_id).abort();
    } catch {
      /* уже нет */
    }
    await db.prepare("DELETE FROM uploads WHERE id = ?").bind(u.id).run();
  }
  return old.results.length;
}
