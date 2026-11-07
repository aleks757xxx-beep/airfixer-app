/** Работа с хранилищем R2: публичная раздача роликов для Buffer и уборка. */

const ORPHAN_GRACE_MS = 24 * 3600 * 1000;

function isBody(o: R2Object | R2ObjectBody): o is R2ObjectBody {
  return "body" in o;
}

/** GET/HEAD /media/<key> — с поддержкой Range (соцсети скачивают видео кусками). */
export async function serveMedia(request: Request, bucket: R2Bucket, key: string): Promise<Response> {
  if (!key.startsWith("videos/") || key.includes("..")) return new Response("Not found", { status: 404 });
  const obj = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  if (obj === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");
  headers.set("x-content-type-options", "nosniff");
  if (!isBody(obj)) return new Response(null, { status: 304, headers });

  let status = 200;
  const r = obj.range;
  if (r && request.headers.has("range")) {
    let start = 0;
    let len = obj.size;
    if ("suffix" in r && r.suffix !== undefined) {
      start = obj.size - r.suffix;
      len = r.suffix;
    } else {
      start = "offset" in r && r.offset !== undefined ? r.offset : 0;
      len = "length" in r && r.length !== undefined ? r.length : obj.size - start;
    }
    headers.set("content-range", `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set("content-length", String(len));
    status = 206;
  } else {
    headers.set("content-length", String(obj.size));
  }
  return new Response(request.method === "HEAD" ? null : obj.body, { status, headers });
}

/**
 * Уборка хранилища (cron раз в сутки): удалить файлы, которых нет в библиотеке
 * (удалённые из библиотеки или «сироты» старше суток). Ролики из библиотеки не трогаем.
 */
export async function cleanupOrphans(bucket: R2Bucket, db: D1Database): Promise<number> {
  const live = await db.prepare("SELECT r2_key FROM media WHERE deleted_at IS NULL").all<{ r2_key: string }>();
  const keep = new Set(live.results.map((r) => r.r2_key));
  const limit = Date.now() - ORPHAN_GRACE_MS;
  let cursor: string | undefined;
  let removed = 0;
  do {
    const list = await bucket.list({ prefix: "videos/", ...(cursor ? { cursor } : {}) });
    const orphans = list.objects.filter((o) => !keep.has(o.key) && o.uploaded.getTime() < limit).map((o) => o.key);
    if (orphans.length) {
      await bucket.delete(orphans);
      removed += orphans.length;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return removed;
}
