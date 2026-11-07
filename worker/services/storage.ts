/** Работа с хранилищем R2: публичная раздача роликов для Buffer и очистка старых. */

const KEEP_DAYS = 30;

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

/** Удалить ролики старше KEEP_DAYS дней (cron раз в сутки). */
export async function cleanupOldVideos(bucket: R2Bucket): Promise<number> {
  const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  let cursor: string | undefined;
  let removed = 0;
  do {
    const list = await bucket.list({ prefix: "videos/", ...(cursor ? { cursor } : {}) });
    const old = list.objects.filter((o) => o.uploaded.getTime() < limit).map((o) => o.key);
    if (old.length) {
      await bucket.delete(old);
      removed += old.length;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return removed;
}
