import { Hono, type Context } from "hono";
import type { AppBindings } from "../env";
import {
  ALLOWED_VIDEO_EXT,
  MAX_UPLOAD_BYTES,
  type MediaItem,
  type MediaList,
  type MediaSource,
  type UploadResult,
} from "../../shared/schemas";
import { audit } from "../middleware/auth";
import { safeEqual } from "../lib/crypto";

const FREE_R2_BYTES = 10 * 1024 ** 3; // 10 ГБ бесплатно

interface MediaRow {
  id: string;
  r2_key: string;
  name: string;
  size: number;
  mime: string | null;
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
});

function extOf(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  const ext = m?.[1]?.toLowerCase() ?? null;
  return ext && (ALLOWED_VIDEO_EXT as ReadonlyArray<string>).includes(ext) ? ext : null;
}
const mimeFor = (ext: string) => (ext === "mov" ? "video/quicktime" : "video/mp4");

function cleanName(raw: string): string {
  return raw.normalize("NFC").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160) || "video.mp4";
}

type Ctx = Context<AppBindings>;

/** Общая загрузка: проверки, дубликаты, запись в R2 и D1. */
async function storeVideo(c: Ctx, rawName: string, source: MediaSource): Promise<Response> {
  const name = cleanName(rawName);
  const ext = extOf(name);
  if (!ext) return c.json({ error: "Можно загружать только видео .mp4, .mov, .m4v" }, 400);
  const size = Number(c.req.header("Content-Length") ?? "0");
  if (!Number.isFinite(size) || size <= 0) return c.json({ error: "Пустой файл" }, 400);
  if (size > MAX_UPLOAD_BYTES) return c.json({ error: "Файл больше 95 МБ — сожмите ролик" }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "Пустой файл" }, 400);

  const dup = await c.env.DB.prepare(
    "SELECT id, r2_key, name, size, mime, source, created_at FROM media WHERE name = ? AND size = ? AND deleted_at IS NULL",
  )
    .bind(name, size)
    .first<MediaRow>();
  if (dup) {
    await body.cancel();
    const r: UploadResult = { item: toItem(dup), duplicate: true };
    return c.json(r);
  }

  const id = crypto.randomUUID();
  const key = `videos/${id}.${ext}`; // случайное имя — не подобрать
  const mime = mimeFor(ext);
  await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: mime } });
  const row: MediaRow = { id, r2_key: key, name, size, mime, source, created_at: Date.now() };
  await c.env.DB.prepare("INSERT INTO media (id, r2_key, name, size, mime, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.r2_key, row.name, row.size, row.mime, row.source, row.created_at)
    .run();
  await audit(c.env.DB, `media ${source}`, name);
  const r: UploadResult = { item: toItem(row), duplicate: false };
  return c.json(r);
}

/** Библиотека (только после входа). */
export const media = new Hono<AppBindings>()
  .get("/", async (c) => {
    const rows = await c.env.DB.prepare(
      "SELECT id, r2_key, name, size, mime, source, created_at FROM media WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500",
    ).all<MediaRow>();
    const items = rows.results.map((r) => toItem(r));
    const body: MediaList = {
      items,
      totalBytes: items.reduce((s, i) => s + i.size, 0),
      limitBytes: FREE_R2_BYTES,
    };
    return c.json(body);
  })

  .post("/upload", (c) => storeVideo(c, c.req.query("name") ?? "", "upload"))

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

/**
 * Автозагрузка из папки «Готовое» на Mac (по токену UPLOAD_TOKEN, без входа).
 * Имя файла — в заголовке X-File-Name (base64 UTF-8).
 */
export const ingest = new Hono<AppBindings>().post("/", async (c) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const expected = c.env.UPLOAD_TOKEN?.trim();
  if (!expected || !token || !(await safeEqual(token, expected))) return c.json({ error: "bad token" }, 401);
  let name = "video.mp4";
  try {
    const b = c.req.header("X-File-Name");
    if (b) name = new TextDecoder().decode(Uint8Array.from(atob(b.trim()), (ch) => ch.charCodeAt(0)));
  } catch {
    return c.json({ error: "bad file name" }, 400);
  }
  return storeVideo(c, name, "gotovoe");
});
