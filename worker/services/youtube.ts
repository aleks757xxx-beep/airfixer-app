import { z } from "zod";

/**
 * YouTube напрямую (без Buffer): вход Google (OAuth), канал владельца, загрузка ролика частями.
 * Загрузка «возобновляемая»: каждую минуту cron досылает следующий кусок, состояние спрашиваем у YouTube
 * (Content-Range: bytes * / размер), поэтому сбой или перезапуск ничего не ломают.
 */

let OAUTH = "https://oauth2.googleapis.com";
let API = "https://www.googleapis.com";
/** Только для локальной проверки (заглушка Google). */
export function setGoogleApiUrl(url: string | undefined): void {
  if (!url) return;
  OAUTH = url.replace(/\/$/, "");
  API = OAUTH;
}

/** ID клиента OAuth в Google Cloud (проект postfixer; не секрет). */
export const GOOGLE_CLIENT_ID_DEFAULT = "310148509374-32vop8u1otmntakf7tgl0upnfmd16hcg.apps.googleusercontent.com";
export const googleClientId = (env: { GOOGLE_CLIENT_ID?: string }) => env.GOOGLE_CLIENT_ID?.trim() || GOOGLE_CLIENT_ID_DEFAULT;

export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
/** Кусок загрузки: кратно 256 КБ, как требует YouTube. */
export const YT_CHUNK = 64 * 1024 * 1024;

export class YoutubeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubeError";
  }
}

const ApiError = z.object({ error: z.union([z.string(), z.object({ message: z.string().optional(), errors: z.array(z.object({ reason: z.string().optional() })).optional() })]) });
const ErrDesc = z.object({ error_description: z.string().optional() });

/** Понятные сообщения вместо английских ошибок Google. */
function explain(raw: unknown, status: number): string {
  const e = ApiError.safeParse(raw);
  const reason = e.success && typeof e.data.error === "object" ? (e.data.error.errors?.[0]?.reason ?? "") : "";
  const msg = e.success ? (typeof e.data.error === "string" ? e.data.error : (e.data.error.message ?? "")) : "";
  const desc = ErrDesc.safeParse(raw);
  if (/invalid_grant/.test(msg) || status === 401) return "YouTube: доступ отозван или устарел — нажмите «Подключить YouTube» ещё раз";
  if (/quotaExceeded|uploadLimitExceeded/.test(reason)) return "YouTube: на сегодня достигнут лимит загрузок — выйдет завтра, нажмите «Повторить»";
  if (/youtubeSignupRequired/.test(reason)) return "YouTube: у этого Google-аккаунта нет канала";
  if (/invalidTitle/.test(reason)) return "YouTube: недопустимое название ролика";
  if (/invalidDescription/.test(reason)) return "YouTube: недопустимое описание";
  return `YouTube: ${msg || (desc.success ? desc.data.error_description : "") || `ошибка ${status}`}`;
}

async function json<S extends z.ZodType>(res: Response, schema: S): Promise<z.infer<S>> {
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status >= 500) throw new Error(`Google ответил ${res.status}`); // сбой у Google — повторим
    throw new YoutubeError(explain(raw, res.status));
  }
  return schema.parse(raw);
}

export function googleLoginUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline", // нужен ключ обновления — вход один раз
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeGoogleCode(
  clientId: string,
  secret: string,
  redirectUri: string,
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const d = await json(res, z.object({ access_token: z.string(), refresh_token: z.string().optional() }));
  return { accessToken: d.access_token, refreshToken: d.refresh_token ?? null };
}

export async function refreshGoogleToken(clientId: string, secret: string, refreshToken: string): Promise<string> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: secret, grant_type: "refresh_token" }),
  });
  return (await json(res, z.object({ access_token: z.string() }))).access_token;
}

export async function myChannels(accessToken: string): Promise<Array<{ id: string; title: string }>> {
  const res = await fetch(`${API}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const d = await json(res, z.object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }) })).optional() }));
  return (d.items ?? []).map((c) => ({ id: c.id, title: c.snippet.title }));
}

/** YouTube не принимает «<» и «>» в названии и описании. */
const clean = (s: string) => s.replace(/[<>]/g, "");

/** Название: своё (до 100 знаков) или первая строка подписи. */
export function youtubeTitle(title: string | null, text: string): string {
  const t = clean(title?.trim() || text.split("\n").find((l) => l.trim())?.trim() || "AirFixer");
  return t.length > 100 ? `${t.slice(0, 99).trimEnd()}…` : t;
}

/** Начать загрузку: вернёт адрес, куда слать файл (действует неделю). */
export async function startUpload(
  accessToken: string,
  meta: { title: string; description: string; size: number; contentType: string },
): Promise<string> {
  const res = await fetch(`${API}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(meta.size),
      "X-Upload-Content-Type": meta.contentType,
    },
    body: JSON.stringify({
      snippet: { title: meta.title, description: clean(meta.description).slice(0, 5000), categoryId: "26" }, // 26 — «Хобби и стиль» (как в Buffer)
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true },
    }),
  });
  if (!res.ok) await json(res, z.unknown());
  const loc = res.headers.get("Location");
  if (!loc) throw new Error("YouTube не дал адрес загрузки");
  return loc;
}

export type UploadState = { done: true; videoId: string } | { done: false; received: number };

function parseDone(raw: unknown): { done: true; videoId: string } {
  const d = z.object({ id: z.string() }).parse(raw);
  return { done: true, videoId: d.id };
}

/** Сколько байт YouTube уже получил (или ролик уже загружен целиком). */
export async function uploadState(uploadUrl: string, size: number): Promise<UploadState> {
  const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes */${size}` }, body: "" });
  if (res.status === 200 || res.status === 201) return parseDone(await res.json());
  if (res.status === 308) {
    const r = res.headers.get("Range"); // bytes=0-12345
    const m = r ? /bytes=0-(\d+)/.exec(r) : null;
    return { done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) throw new YoutubeError("YouTube: загрузка устарела — нажмите «Повторить»");
  if (res.status >= 500) throw new Error(`Google ответил ${res.status}`);
  throw new YoutubeError(explain(await res.json().catch(() => null), res.status));
}

/** Отправить кусок файла [start, start+len). */
export async function uploadChunk(uploadUrl: string, body: ReadableStream, start: number, len: number, size: number): Promise<UploadState> {
  const fixed = new FixedLengthStream(len);
  const pipe = body.pipeTo(fixed.writable);
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes ${start}-${start + len - 1}/${size}` },
    body: fixed.readable,
  });
  await pipe.catch(() => undefined);
  if (res.status === 200 || res.status === 201) return parseDone(await res.json());
  if (res.status === 308) {
    const r = res.headers.get("Range");
    const m = r ? /bytes=0-(\d+)/.exec(r) : null;
    return { done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) throw new YoutubeError("YouTube: загрузка устарела — нажмите «Повторить»");
  if (res.status >= 500) throw new Error(`Google ответил ${res.status}`);
  throw new YoutubeError(explain(await res.json().catch(() => null), res.status));
}

export const youtubeLink = (videoId: string) => `https://youtu.be/${videoId}`;

/** Цифры ролика: просмотры, лайки, комментарии. */
export async function videoStatistics(accessToken: string, videoId: string): Promise<Record<string, number>> {
  const res = await fetch(`${API}/youtube/v3/videos?part=statistics&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const d = await json(
    res,
    z.object({ items: z.array(z.object({ statistics: z.object({ viewCount: z.string().optional(), likeCount: z.string().optional(), commentCount: z.string().optional() }) })).optional() }),
  );
  const s = d.items?.[0]?.statistics;
  if (!s) throw new YoutubeError("YouTube: ролик не найден (удалён или скрыт)");
  return { views: Number(s.viewCount ?? 0), reactions: Number(s.likeCount ?? 0), comments: Number(s.commentCount ?? 0) };
}
