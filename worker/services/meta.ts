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
/** Портфолио AirFixer в Meta Business (не секрет). */
export const META_BUSINESS_ID_DEFAULT = "800079823197659";
/** Instagram портфолио AirFixer без своей Страницы (ID из Meta Business Suite; не секрет). */
export const META_IG_KNOWN_IDS: readonly string[] = ["17841468340186400"]; // airfixertbls
export const META_IG_CONFIG_ID_DEFAULT = "1113099151566981"; // «Instagram API (единый вход)», создана 08.11.2026

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

/**
 * Аккаунты Instagram, к которым владелец дал доступ при едином входе.
 * 1) /me/assigned_instagram_accounts; 2) если нельзя — debug_token: granular_scopes.target_ids (id аккаунтов Instagram).
 * Возвращает и найденные аккаунты, и ошибки (для журнала).
 */
export async function assignedInstagramAccounts(
  token: string,
  appId: string,
  appSecret: string,
): Promise<{ accounts: Array<{ id: string; username: string }>; errors: string[] }> {
  const errors: string[] = [];
  try {
    const d = await graph(
      "GET",
      "/me/assigned_instagram_accounts",
      { fields: "id,username", limit: 50, access_token: token },
      z.object({ data: z.array(z.object({ id: z.string(), username: z.string().optional() })) }),
    );
    if (d.data.length) return { accounts: d.data.map((a) => ({ id: a.id, username: a.username ?? `Instagram ${a.id}` })), errors };
    errors.push("assigned_instagram_accounts: пусто");
  } catch (e: unknown) {
    errors.push(`assigned_instagram_accounts: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const dbg = await graph(
      "GET",
      "/debug_token",
      { input_token: token, access_token: `${appId}|${appSecret}` },
      z.object({
        data: z.object({
          granular_scopes: z.array(z.object({ scope: z.string(), target_ids: z.array(z.string()).optional() })).optional(),
        }),
      }),
    );
    const ids = new Set<string>();
    const businesses = new Set<string>();
    for (const g of dbg.data.granular_scopes ?? []) {
      if (g.scope.startsWith("instagram_")) for (const id of g.target_ids ?? []) ids.add(id);
      if (g.scope === "business_management") for (const id of g.target_ids ?? []) businesses.add(id);
    }
    errors.push(`scopes: ${JSON.stringify(dbg.data.granular_scopes ?? []).slice(0, 300)}`);
    // Кто владелец ключа (системный пользователь портфолио) и его Instagram
    const List = z.object({ data: z.array(z.object({ id: z.string(), username: z.string().optional(), name: z.string().optional() })) });
    const me = await graph("GET", "/me", { fields: "id,name", access_token: token }, z.object({ id: z.string(), name: z.string().optional() })).catch((e: unknown) => {
      errors.push(`me: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (me) {
      errors.push(`me: ${me.name ?? "?"}=${me.id}`);
      for (const path of [`/${me.id}/assigned_instagram_accounts`, "/me/instagram_accounts"]) {
        try {
          const r = await graph("GET", path, { fields: "id,username", limit: 50, access_token: token }, List);
          errors.push(`${path.replace(me.id, "me")}: ${r.data.map((x) => `${x.username ?? "?"}=${x.id}`).join(",") || "пусто"}`);
          for (const x of r.data) ids.add(x.id);
        } catch (e: unknown) {
          errors.push(`${path.replace(me.id, "me")}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    try {
      const r = await graph("GET", "/me/businesses", { fields: "id,name", limit: 50, access_token: token }, List);
      errors.push(`businesses: ${r.data.map((x) => `${x.name ?? "?"}=${x.id}`).join(",") || "пусто"}`);
      for (const x of r.data) businesses.add(x.id);
    } catch (e: unknown) {
      errors.push(`businesses: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!businesses.size) businesses.add(META_BUSINESS_ID_DEFAULT);
    // Известные Instagram портфолио AirFixer: проверяем, открывает ли их ключ напрямую
    for (const id of META_IG_KNOWN_IDS) ids.add(id);
    // Instagram из портфолио, к которым у ключа есть доступ
    for (const biz of businesses) {
      for (const edge of ["instagram_business_accounts", "owned_instagram_accounts", "client_instagram_assets"]) {
        try {
          const r = await graph(
            "GET",
            `/${biz}/${edge}`,
            { fields: "id,username", limit: 50, access_token: token },
            z.object({ data: z.array(z.object({ id: z.string(), username: z.string().optional() })) }),
          );
          errors.push(`${edge}: ${r.data.map((x) => `${x.username ?? "?"}=${x.id}`).join(",") || "пусто"}`);
          for (const x of r.data) ids.add(x.id);
        } catch (e: unknown) {
          errors.push(`${edge}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    const accounts: Array<{ id: string; username: string }> = [];
    for (const id of ids) {
      const u = await graph("GET", `/${id}`, { fields: "id,username", access_token: token }, z.object({ id: z.string(), username: z.string().optional() })).catch(
        (e: unknown) => {
          errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        },
      );
      if (u) accounts.push({ id: u.id, username: u.username ?? `Instagram ${u.id}` });
    }
    if (!accounts.length) errors.push(`debug_token: доступ к ${ids.size} аккаунт(ам)`);
    return { accounts, errors };
  } catch (e: unknown) {
    errors.push(`debug_token: ${e instanceof Error ? e.message : String(e)}`);
    return { accounts: [], errors };
  }
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
