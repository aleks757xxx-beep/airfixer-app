import { z } from "zod";

/** Meta Graph API: вход (OAuth), страницы и Instagram, публикация Reels, статистика. */

const GRAPH_VERSION = "v23.0";
let GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
let RUPLOAD = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
/** Только для локальной проверки (заглушка Graph API). */
export function setGraphUrl(url: string | undefined): void {
  if (url) {
    GRAPH = url.replace(/\/$/, "");
    RUPLOAD = `${GRAPH}/rupload`;
  }
}

export class MetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaError";
  }
}

const GraphError = z.object({ error: z.object({ message: z.string(), code: z.number().optional(), error_user_msg: z.string().optional() }) });

async function graph<S extends z.ZodType>(
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
      ? await fetch(`${url}?${qs.toString()}`)
      : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs.toString() });
  const raw: unknown = await res.json().catch(() => null);
  const err = GraphError.safeParse(raw);
  if (!res.ok || err.success) {
    const e = err.success ? err.data.error : null;
    throw new MetaError(e?.error_user_msg || e?.message || `Meta ответил ${res.status}`);
  }
  return schema.parse(raw);
}

/** Права, которые просим у владельца при подключении. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
].join(",");

/** Приложение Meta «PostFixer» (не секрет).
 *  Конфигурация входа (config_id 3012047265809430) не используется: с ней Facebook отвечает
 *  «Sorry, something went wrong» — право pages_manage_engagement тянет недоступное pages_read_user_content.
 *  Поэтому права передаются напрямую списком META_SCOPES (без pages_manage_engagement). */
export const META_APP_ID_DEFAULT = "2206384923628133";
/**
 * «Единый вход» Instagram (для новых приложений Meta вход через сам Instagram недоступен):
 * вход через Facebook для компаний с конфигурацией, где выбирается аккаунт Instagram — страница Facebook не нужна.
 * Ключ — бессрочный маркер системного пользователя компании. ID конфигурации не секрет; пусто — кнопка выключена.
 */
export const META_IG_CONFIG_ID_DEFAULT = "";

/** Вход через Facebook для компаний: права задаются конфигурацией (config_id). */
export function metaLoginUrl(appId: string, redirectUri: string, state: string, configId?: string): string {
  const base = { client_id: appId, redirect_uri: redirectUri, state, response_type: "code" };
  const qs = new URLSearchParams(configId ? { ...base, config_id: configId } : { ...base, scope: META_SCOPES });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs.toString()}`;
}

const Token = z.object({ access_token: z.string(), expires_in: z.number().optional() });

/** Код → долгоживущий токен пользователя (≈60 дней); токены страниц из него — бессрочные. */
export async function exchangeCode(appId: string, appSecret: string, redirectUri: string, code: string): Promise<string> {
  const short = await graph("GET", "/oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }, Token);
  const long = await graph(
    "GET",
    "/oauth/access_token",
    { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token },
    Token,
  );
  return long.access_token;
}

const Pages = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      access_token: z.string(),
      instagram_business_account: z.object({ id: z.string(), username: z.string().optional() }).optional(),
    }),
  ),
});
export type MetaPage = z.infer<typeof Pages>["data"][number];

/** Страницы Facebook владельца и привязанные к ним Instagram. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const d = await graph("GET", "/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: 50, access_token: userToken }, Pages);
  return d.data;
}

// ---- Instagram Reels ----
export interface IgReel {
  videoUrl: string;
  caption: string;
  thumbMs?: number;
}
/** Шаг 1: создать контейнер Reels (Instagram сам скачивает ролик по ссылке). */
export async function igCreateContainer(igId: string, token: string, r: IgReel): Promise<string> {
  const d = await graph(
    "POST",
    `/${igId}/media`,
    { media_type: "REELS", video_url: r.videoUrl, caption: r.caption, share_to_feed: true, thumb_offset: r.thumbMs, access_token: token },
    z.object({ id: z.string() }),
  );
  return d.id;
}
/** Шаг 2: готов ли контейнер (обработка ролика занимает от секунд до минут). */
export async function igContainerStatus(containerId: string, token: string): Promise<{ status: string; message: string | null }> {
  const d = await graph(
    "GET",
    `/${containerId}`,
    { fields: "status_code,status", access_token: token },
    z.object({ status_code: z.string().optional(), status: z.string().optional() }),
  );
  return { status: d.status_code ?? "IN_PROGRESS", message: d.status ?? null };
}
/** Шаг 3: опубликовать. Возвращает id и ссылку. */
export async function igPublish(igId: string, token: string, containerId: string): Promise<{ id: string; link: string | null }> {
  const d = await graph("POST", `/${igId}/media_publish`, { creation_id: containerId, access_token: token }, z.object({ id: z.string() }));
  const info = await graph("GET", `/${d.id}`, { fields: "permalink", access_token: token }, z.object({ permalink: z.string().optional() })).catch(() => ({
    permalink: undefined,
  }));
  return { id: d.id, link: info.permalink ?? null };
}
export async function igComment(mediaId: string, token: string, message: string): Promise<void> {
  await graph("POST", `/${mediaId}/comments`, { message, access_token: token }, z.object({ id: z.string() }));
}

/** Код единого входа → маркер системного пользователя (бессрочный, без обмена на долгоживущий). */
export async function exchangeBusinessCode(appId: string, appSecret: string, redirectUri: string, code: string): Promise<string> {
  const t = await graph("GET", "/oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }, Token);
  return t.access_token;
}

/** Аккаунты Instagram, к которым владелец дал доступ при едином входе. */
export async function assignedInstagramAccounts(token: string): Promise<Array<{ id: string; username: string }>> {
  const d = await graph(
    "GET",
    "/me/assigned_instagram_accounts",
    { fields: "id,username", limit: 50, access_token: token },
    z.object({ data: z.array(z.object({ id: z.string(), username: z.string().optional() })) }),
  );
  return d.data.map((a) => ({ id: a.id, username: a.username ?? `Instagram ${a.id}` }));
}

// ---- Facebook Reels (страница) ----
/** Загрузка Reels на страницу: start → загрузка по ссылке → finish (публикация). */
export async function fbPublishReel(pageId: string, token: string, videoUrl: string, description: string): Promise<string> {
  const start = await graph("POST", `/${pageId}/video_reels`, { upload_phase: "start", access_token: token }, z.object({ video_id: z.string() }));
  const up = await fetch(`${RUPLOAD}/${start.video_id}`, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_url: videoUrl } });
  const upJson: unknown = await up.json().catch(() => null);
  const upErr = GraphError.safeParse(upJson);
  if (!up.ok || upErr.success) throw new MetaError(upErr.success ? upErr.data.error.message : `Загрузка в Facebook: ${up.status}`);
  await graph(
    "POST",
    `/${pageId}/video_reels`,
    { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description, access_token: token },
    z.object({ success: z.boolean().optional() }),
  );
  return start.video_id;
}
/** Статус ролика Facebook: обработан ли и вышел ли. */
export async function fbVideoStatus(videoId: string, token: string): Promise<{ done: boolean; error: string | null; link: string | null }> {
  const d = await graph(
    "GET",
    `/${videoId}`,
    { fields: "status,permalink_url", access_token: token },
    z.object({
      status: z
        .object({
          video_status: z.string().optional(),
          publishing_phase: z.object({ status: z.string().optional() }).optional(),
          processing_phase: z.object({ status: z.string().optional(), error: z.object({ message: z.string() }).optional() }).optional(),
        })
        .optional(),
      permalink_url: z.string().optional(),
    }),
  );
  const st = d.status;
  const err = st?.processing_phase?.error?.message ?? (st?.video_status === "error" ? "Facebook не смог обработать ролик" : null);
  const done = st?.publishing_phase?.status === "complete" || st?.video_status === "ready";
  const link = d.permalink_url ? (d.permalink_url.startsWith("http") ? d.permalink_url : `https://www.facebook.com${d.permalink_url}`) : null;
  return { done, error: err, link };
}

// ---- Статистика ----
const Insights = z.object({ data: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.number() })).optional(), total_value: z.object({ value: z.number() }).optional() })) });
/** Цифры Reels в Instagram: просмотры, охват, лайки, комментарии, сохранения, репосты. */
export async function igReelInsights(mediaId: string, token: string): Promise<Record<string, number>> {
  const d = await graph("GET", `/${mediaId}/insights`, { metric: "views,reach,likes,comments,saved,shares", access_token: token }, Insights);
  const out: Record<string, number> = {};
  for (const m of d.data) out[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
  return out;
}
