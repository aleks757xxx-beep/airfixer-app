import { z } from "zod";

/**
 * Threads напрямую: вход (OAuth на threads.com), долгий ключ на 60 дней с продлением, публикация ролика.
 * Публикация как в Instagram: контейнер с video_url → ждём FINISHED → threads_publish.
 */

let GRAPH = "https://graph.threads.com";
/** Только для локальной проверки (заглушка Threads API). */
export function setThreadsApiUrl(url: string | undefined): void {
  if (url) GRAPH = url.replace(/\/$/, "");
}

/** ID приложения Threads (сценарий «Доступ к Threads API» в приложении Meta «PostFixer»; не секрет). */
export const THREADS_APP_ID_DEFAULT = "1659729995690076";
const THREADS_SCOPES = "threads_basic,threads_content_publish,threads_manage_insights";
/** Долгий ключ живёт 60 дней; продлеваем, когда ему больше недели. */
export const THREADS_TOKEN_TTL_MS = 60 * 86_400_000;

export class ThreadsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadsError";
  }
}

const ErrorBody = z.object({ error: z.object({ message: z.string(), error_user_msg: z.string().optional(), code: z.number().optional() }) });

function explain(msg: string): string {
  if (/session has expired|access token|OAuthException|Error validating/i.test(msg)) return "Threads: доступ устарел — нажмите «Подключить Threads» ещё раз";
  if (/rate limit|limit reached|posting limit/i.test(msg)) return "Threads: достигнут лимит публикаций на сутки — нажмите «Повторить» завтра";
  return `Threads: ${msg}`;
}

async function call<S extends z.ZodType>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  schema: S,
): Promise<z.infer<S>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const url = `${GRAPH}${path}`;
  const res =
    method === "GET"
      ? await fetch(`${url}?${qs}`)
      : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs.toString() });
  const raw: unknown = await res.json().catch(() => null);
  const err = ErrorBody.safeParse(raw);
  if (!res.ok || err.success) {
    if (!err.success && res.status >= 500) throw new Error(`Threads ответил ${res.status}`); // сбой — повторим
    throw new ThreadsError(explain(err.success ? (err.data.error.error_user_msg ?? err.data.error.message) : `ошибка ${res.status}`));
  }
  return schema.parse(raw);
}

export function threadsLoginUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, scope: THREADS_SCOPES, response_type: "code", state });
  return `https://threads.com/oauth/authorize?${q}`;
}

/** Код → короткий ключ (1 час) → долгий ключ (60 дней). */
export async function exchangeThreadsCode(
  appId: string,
  secret: string,
  redirectUri: string,
  code: string,
): Promise<{ token: string; userId: string; expiresAt: number }> {
  const short = await call(
    "POST",
    "/oauth/access_token",
    { client_id: appId, client_secret: secret, code: code.replace(/#_$/, ""), grant_type: "authorization_code", redirect_uri: redirectUri },
    z.object({ access_token: z.string(), user_id: z.union([z.string(), z.number()]) }),
  );
  const long = await call(
    "GET",
    "/access_token",
    { grant_type: "th_exchange_token", client_secret: secret, access_token: short.access_token },
    z.object({ access_token: z.string(), expires_in: z.number().optional() }),
  );
  return { token: long.access_token, userId: String(short.user_id), expiresAt: Date.now() + (long.expires_in ?? 5_184_000) * 1000 };
}

/** Продлить долгий ключ ещё на 60 дней (ключу должно быть больше суток). */
export async function refreshThreadsToken(token: string): Promise<{ token: string; expiresAt: number }> {
  const d = await call(
    "GET",
    "/refresh_access_token",
    { grant_type: "th_refresh_token", access_token: token },
    z.object({ access_token: z.string(), expires_in: z.number().optional() }),
  );
  return { token: d.access_token, expiresAt: Date.now() + (d.expires_in ?? 5_184_000) * 1000 };
}

export async function threadsMe(token: string): Promise<{ id: string; username: string }> {
  return call("GET", "/v1.0/me", { fields: "id,username", access_token: token }, z.object({ id: z.string(), username: z.string() }));
}

/** Шаг 1: контейнер с роликом (Threads сам скачивает файл по ссылке). */
export async function threadsCreateVideo(userId: string, token: string, videoUrl: string, text: string): Promise<string> {
  const d = await call(
    "POST",
    `/v1.0/${userId}/threads`,
    { media_type: "VIDEO", video_url: videoUrl, text: text || undefined, access_token: token },
    z.object({ id: z.string() }),
  );
  return d.id;
}

/** Шаг 2: готов ли контейнер. */
export async function threadsContainerStatus(containerId: string, token: string): Promise<{ status: string; message: string | null }> {
  const d = await call(
    "GET",
    `/v1.0/${containerId}`,
    { fields: "status,error_message", access_token: token },
    z.object({ status: z.string().optional(), error_message: z.string().optional() }),
  );
  return { status: d.status ?? "IN_PROGRESS", message: d.error_message ?? null };
}

/** Шаг 3: опубликовать; ссылка на пост. */
export async function threadsPublish(userId: string, token: string, containerId: string): Promise<{ id: string; link: string | null }> {
  const d = await call("POST", `/v1.0/${userId}/threads_publish`, { creation_id: containerId, access_token: token }, z.object({ id: z.string() }));
  const info = await call("GET", `/v1.0/${d.id}`, { fields: "permalink", access_token: token }, z.object({ permalink: z.string().optional() })).catch(() => ({
    permalink: undefined,
  }));
  return { id: d.id, link: info.permalink ?? null };
}

/** Цифры поста (нужно право threads_manage_insights). */
export async function threadsInsights(mediaId: string, token: string): Promise<Record<string, number>> {
  const d = await call(
    "GET",
    `/v1.0/${mediaId}/insights`,
    { metric: "views,likes,replies,reposts,quotes,shares", access_token: token },
    z.object({ data: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.number() })).optional(), total_value: z.object({ value: z.number() }).optional() })) }),
  );
  const v = new Map(d.data.map((m) => [m.name, m.total_value?.value ?? m.values?.[0]?.value ?? 0]));
  const n = (k: string) => v.get(k) ?? 0;
  return { views: n("views"), reactions: n("likes"), comments: n("replies"), shares: n("reposts") + n("quotes") + n("shares") };
}
