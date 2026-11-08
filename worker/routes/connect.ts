import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { audit } from "../middleware/auth";
import { randomToken } from "../lib/crypto";
import { BufferError } from "../services/buffer";
import {
  META_APP_ID_DEFAULT,
  META_IG_CONFIG_ID_DEFAULT,
  MetaError,
  assignedInstagramAccounts,
  exchangeBusinessCode,
  exchangeCode,
  listPages,
  metaLoginUrl,
} from "../services/meta";
import { accountToChannel, disconnectAccount, listAccounts, saveInstagramLogin, saveMetaAccounts, saveTelegramChannel, saveYoutubeChannel, setSlots } from "../services/direct";
import { TelegramError, chatByAddress, getMe, recentChannels } from "../services/telegram";
import { listChannels } from "../services/publish";
import { YoutubeError, exchangeGoogleCode, googleLoginUrl, myChannels } from "../services/youtube";
import { migrated } from "./media";

const STATE_TTL_MS = 10 * 60_000;
const redirectUri = (url: string) => `https://${new URL(url).host}/api/v2/connect/meta/callback`;
/** Единый вход возвращается на тот же зарегистрированный адрес, что и вход Facebook; различаем по state. */
const igRedirectUri = redirectUri;
const igConfigId = (env: { META_IG_CONFIG_ID?: string }) => env.META_IG_CONFIG_ID?.trim() || META_IG_CONFIG_ID_DEFAULT;
const igConfigured = (env: { META_IG_CONFIG_ID?: string; META_APP_SECRET?: string; TOKEN_KEY?: string }) =>
  !!(igConfigId(env) && env.META_APP_SECRET && env.TOKEN_KEY);
const appId = (env: { META_APP_ID?: string }) => env.META_APP_ID?.trim() || META_APP_ID_DEFAULT;
/** Google (YouTube): свой адрес возврата. */
const ytRedirectUri = (url: string) => `https://${new URL(url).host}/api/v2/connect/youtube/callback`;
const googleClientId = (env: { GOOGLE_CLIENT_ID?: string }) => env.GOOGLE_CLIENT_ID?.trim() || GOOGLE_CLIENT_ID_DEFAULT;
const ytConfigured = (env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; TOKEN_KEY?: string }) =>
  !!(googleClientId(env) && env.GOOGLE_CLIENT_SECRET?.trim() && env.TOKEN_KEY);
/** ID клиента OAuth в Google Cloud (не секрет; проект PostFixer). */
const GOOGLE_CLIENT_ID_DEFAULT = "310148509374-32vop8u1otmntakf7tgl0upnfmd16hcg.apps.googleusercontent.com";

async function newState(db: D1Database, provider: string): Promise<string> {
  const state = randomToken(24);
  await db.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(Date.now() - STATE_TTL_MS).run();
  await db.prepare("INSERT INTO oauth_states (state, provider, created_at) VALUES (?, ?, ?)").bind(state, provider, Date.now()).run();
  return state;
}

const SlotsSchema = z.array(
  z.object({ day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(24), paused: z.boolean() }),
).max(7);

/** Подключения соцсетей напрямую (только после входа). */
export const connect = new Hono<AppBindings>()
  .use("*", migrated)
  .get("/accounts", async (c) => {
    const accounts = await listAccounts(c.env.DB);
    return c.json({
      items: accounts.map((a) => ({ ...accountToChannel(a), replaces: a.replaces })),
      meta: { configured: !!(c.env.META_APP_SECRET && c.env.TOKEN_KEY) },
      telegram: {
        configured: !!c.env.TG_BOT_TOKEN?.trim(),
        bot: c.env.TG_BOT_TOKEN?.trim() ? await getMe(c.env.TG_BOT_TOKEN.trim()).then((m) => m.username).catch(() => null) : null,
      },
      instagram: { configured: igConfigured(c.env) },
      youtube: { configured: ytConfigured(c.env) },
    });
  })
  // Кнопка «Подключить YouTube» → вход Google
  .get("/youtube/start", async (c) => {
    if (!ytConfigured(c.env)) return c.redirect("/#/connections?connect_error=" + encodeURIComponent("YouTube напрямую ещё не настроен (GOOGLE_CLIENT_SECRET)"));
    return c.redirect(googleLoginUrl(googleClientId(c.env), ytRedirectUri(c.req.url), await newState(c.env.DB, "youtube")));
  })
  // Кнопка «Подключить Instagram без страницы» → вход в Instagram
  .get("/instagram/start", async (c) => {
    if (!igConfigured(c.env)) return c.redirect("/#/connections?connect_error=" + encodeURIComponent("Единый вход Instagram ещё не настроен"));
    const state = randomToken(24);
    await c.env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(Date.now() - STATE_TTL_MS).run();
    await c.env.DB.prepare("INSERT INTO oauth_states (state, provider, created_at) VALUES (?, 'instagram', ?)").bind(state, Date.now()).run();
    return c.redirect(metaLoginUrl(appId(c.env), igRedirectUri(c.req.url), state, igConfigId(c.env)));
  })
  // Telegram: по адресу канала (@name) или найти каналы, куда бота недавно добавили админом
  .post("/telegram", async (c) => {
    const token = c.env.TG_BOT_TOKEN?.trim();
    if (!token) return c.json({ error: "Не задан ключ бота TG_BOT_TOKEN в Cloudflare" }, 503);
    const body = z.object({ address: z.string().max(200).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const address = body.success ? (body.data.address ?? "").trim() : "";
    try {
      const chats = address ? [await chatByAddress(token, address)] : await recentChannels(token);
      if (chats.length === 0) {
        return c.json({ error: "Бот не нашёл каналов. Добавьте бота админом в канал (право «Публикация сообщений») или впишите адрес канала, например @airfixer" }, 404);
      }
      for (const chat of chats) await saveTelegramChannel(c.env.DB, chat);
      await audit(c.env.DB, "direct connect telegram", chats.map((x) => x.title ?? x.id).join(", "));
      return c.json({ ok: true as const, names: chats.map((x) => x.title ?? x.username ?? String(x.id)) });
    } catch (e: unknown) {
      return c.json({ error: e instanceof TelegramError ? e.message : "Нет связи с Telegram — попробуйте ещё раз" }, 502);
    }
  })
  // Кнопка «Подключить Instagram и Facebook» → вход в Facebook
  .get("/meta/start", async (c) => {
    if (!c.env.META_APP_SECRET || !c.env.TOKEN_KEY) return c.redirect("/#/connections?connect_error=" + encodeURIComponent("Не заданы META_APP_SECRET / TOKEN_KEY"));
    const state = randomToken(24);
    await c.env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(Date.now() - STATE_TTL_MS).run();
    await c.env.DB.prepare("INSERT INTO oauth_states (state, provider, created_at) VALUES (?, 'meta', ?)").bind(state, Date.now()).run();
    return c.redirect(metaLoginUrl(appId(c.env), redirectUri(c.req.url), state));
  })
  .delete("/accounts/:id", async (c) => {
    await disconnectAccount(c.env.DB, c.req.param("id"));
    await audit(c.env.DB, "direct disconnect", c.req.param("id"));
    return c.json({ ok: true as const });
  })
  .put("/accounts/:id/slots", async (c) => {
    const p = SlotsSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверное расписание" }, 400);
    await setSlots(c.env.DB, c.req.param("id"), p.data);
    return c.json({ ok: true as const });
  });

/**
 * Возврат из Facebook. Cookie входа сюда не приходит (переход с чужого сайта, SameSite=Strict),
 * поэтому проверяем одноразовый state, выданный кнопкой после входа.
 */
export const connectCallback = new Hono<AppBindings>().use("*", migrated);

async function instagramCallback(c: Context<AppBindings>): Promise<Response> {
  const back = (q: string) => c.redirect(`/#/connections?${q}`);
  const code = c.req.query("code");
  if (!code) return back("connect_error=" + encodeURIComponent(c.req.query("error_description") ?? "Вход в Instagram отменён"));
  if (!igConfigured(c.env)) return back("connect_error=" + encodeURIComponent("Единый вход Instagram ещё не настроен"));
  try {
    const token = await exchangeBusinessCode(appId(c.env), c.env.META_APP_SECRET ?? "", igRedirectUri(c.req.url), code);
    const found = await assignedInstagramAccounts(token, appId(c.env), c.env.META_APP_SECRET ?? "");
    if (found.errors.length) await audit(c.env.DB, "instagram connect debug", found.errors.join(" | ").slice(0, 3000));
    const accounts = found.accounts;
    if (accounts.length === 0) return back("connect_error=" + encodeURIComponent("Не удалось найти Instagram после входа — Claude смотрит журнал"));
    const key = c.env.BUFFER_API_KEY?.trim();
    const bufferChannels = key ? await listChannels(key, c.env.DB).catch(() => []) : [];
    const saved: string[] = [];
    for (const a of accounts) if (await saveInstagramLogin(c.env, { userId: a.id, username: a.username, token }, bufferChannels)) saved.push(a.username);
    const names = saved.join(", ") || "уже подключены";
    await audit(c.env.DB, "direct connect instagram", names);
    return back(`connected=instagram&name=${encodeURIComponent(names)}`);
  } catch (e: unknown) {
    const msg = e instanceof MetaError || e instanceof BufferError ? e.message : "Ошибка подключения";
    await audit(c.env.DB, "instagram connect error", msg.slice(0, 300));
    return back("connect_error=" + encodeURIComponent(msg));
  }
}

connectCallback.get("/meta/callback", async (c) => {
  const back = (q: string) => c.redirect(`/#/connections?${q}`);
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code");
  const row = await c.env.DB.prepare("SELECT created_at, provider FROM oauth_states WHERE state = ?").bind(state).first<{ created_at: number; provider: string }>();
  await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!row || Date.now() - row.created_at > STATE_TTL_MS) return back("connect_error=" + encodeURIComponent("Ссылка входа устарела — нажмите «Подключить» ещё раз"));
  if (row.provider === "instagram") return instagramCallback(c);
  if (!code) return back("connect_error=" + encodeURIComponent(c.req.query("error_description") ?? "Вход в Facebook отменён"));
  if (!c.env.META_APP_SECRET) return back("connect_error=" + encodeURIComponent("Не задан META_APP_SECRET"));
  try {
    const userToken = await exchangeCode(appId(c.env), c.env.META_APP_SECRET, redirectUri(c.req.url), code);
    const pages = await listPages(userToken);
    if (pages.length === 0) return back("connect_error=" + encodeURIComponent("Facebook не дал доступ ни к одной странице — при входе отметьте страницу AirFixer"));
    const key = c.env.BUFFER_API_KEY?.trim();
    const bufferChannels = key ? await listChannels(key, c.env.DB).catch(() => []) : [];
    const n = await saveMetaAccounts(c.env, pages, bufferChannels);
    const igCount = pages.filter((p) => p.instagram_business_account).length;
    await audit(c.env.DB, "direct connect meta", `${pages.length} стр., ${igCount} IG`);
    return back(`connected=meta&n=${n}&ig=${igCount}`);
  } catch (e: unknown) {
    const msg = e instanceof MetaError || e instanceof BufferError ? e.message : "Ошибка подключения";
    await audit(c.env.DB, "instagram connect error", msg.slice(0, 300));
    return back("connect_error=" + encodeURIComponent(msg));
  }
});

/** Возврат из Google: ключ обновления → канал YouTube владельца. */
connectCallback.get("/youtube/callback", async (c) => {
  const back = (q: string) => c.redirect(`/#/connections?${q}`);
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code");
  const row = await c.env.DB.prepare("SELECT created_at, provider FROM oauth_states WHERE state = ?").bind(state).first<{ created_at: number; provider: string }>();
  await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!row || row.provider !== "youtube" || Date.now() - row.created_at > STATE_TTL_MS) {
    return back("connect_error=" + encodeURIComponent("Ссылка входа устарела — нажмите «Подключить YouTube» ещё раз"));
  }
  if (!code) return back("connect_error=" + encodeURIComponent(c.req.query("error") === "access_denied" ? "Вход в Google отменён" : "Google не дал доступ"));
  const secret = c.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) return back("connect_error=" + encodeURIComponent("Не задан GOOGLE_CLIENT_SECRET"));
  try {
    const t = await exchangeGoogleCode(googleClientId(c.env), secret, ytRedirectUri(c.req.url), code);
    if (!t.refreshToken) return back("connect_error=" + encodeURIComponent("Google не выдал постоянный доступ — нажмите «Подключить YouTube» ещё раз"));
    const channels = await myChannels(t.accessToken);
    if (channels.length === 0) return back("connect_error=" + encodeURIComponent("У этого Google-аккаунта нет канала YouTube — войдите аккаунтом канала AirFixer"));
    const key = c.env.BUFFER_API_KEY?.trim();
    const bufferChannels = key ? await listChannels(key, c.env.DB).catch(() => []) : [];
    for (const ch of channels) await saveYoutubeChannel(c.env, { id: ch.id, title: ch.title, refreshToken: t.refreshToken }, bufferChannels);
    const names = channels.map((ch) => ch.title).join(", ");
    await audit(c.env.DB, "direct connect youtube", names);
    return back(`connected=youtube&name=${encodeURIComponent(names)}`);
  } catch (e: unknown) {
    const msg = e instanceof YoutubeError || e instanceof BufferError ? e.message : "Ошибка подключения YouTube";
    console.error("youtube connect", e);
    await audit(c.env.DB, "youtube connect error", msg.slice(0, 300));
    return back("connect_error=" + encodeURIComponent(msg));
  }
});

/** Для Claude (по токену): ссылка входа Meta, чтобы подключить аккаунт по просьбе владельца из его браузера. */
export const connectAgent = new Hono<AppBindings>().get("/:provider/url", async (c) => {
  const provider = c.req.param("provider");
  if (provider === "youtube") {
    if (!ytConfigured(c.env)) return c.json({ error: "YouTube напрямую ещё не настроен (GOOGLE_CLIENT_SECRET)" }, 503);
    await audit(c.env.DB, "connect url (claude)", provider);
    return c.json({ url: googleLoginUrl(googleClientId(c.env), ytRedirectUri(c.req.url), await newState(c.env.DB, "youtube")) });
  }
  if (provider !== "meta" && provider !== "instagram") return c.json({ error: "Неизвестная соцсеть" }, 404);
  if (provider === "instagram" && !igConfigured(c.env)) return c.json({ error: "Единый вход Instagram ещё не настроен" }, 503);
  const state = randomToken(24);
  await c.env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(Date.now() - STATE_TTL_MS).run();
  await c.env.DB.prepare("INSERT INTO oauth_states (state, provider, created_at) VALUES (?, ?, ?)").bind(state, provider, Date.now()).run();
  const url = metaLoginUrl(appId(c.env), redirectUri(c.req.url), state, provider === "instagram" ? igConfigId(c.env) : undefined);
  await audit(c.env.DB, "connect url (claude)", provider);
  return c.json({ url });
});
