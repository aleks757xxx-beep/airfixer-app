import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { audit } from "../middleware/auth";
import { randomToken } from "../lib/crypto";
import { BufferError } from "../services/buffer";
import { META_APP_ID_DEFAULT, MetaError, exchangeCode, listPages, metaLoginUrl } from "../services/meta";
import { accountToChannel, disconnectAccount, listAccounts, saveMetaAccounts, saveTelegramChannel, setSlots } from "../services/direct";
import { TelegramError, chatByAddress, recentChannels } from "../services/telegram";
import { listChannels } from "../services/publish";
import { migrated } from "./media";

const STATE_TTL_MS = 10 * 60_000;
const redirectUri = (url: string) => `https://${new URL(url).host}/api/v2/connect/meta/callback`;
const appId = (env: { META_APP_ID?: string }) => env.META_APP_ID?.trim() || META_APP_ID_DEFAULT;

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
      telegram: { configured: !!c.env.TG_BOT_TOKEN?.trim() },
    });
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
    if (!c.env.META_APP_SECRET || !c.env.TOKEN_KEY) return c.redirect("/#/status?connect_error=" + encodeURIComponent("Не заданы META_APP_SECRET / TOKEN_KEY"));
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
export const connectCallback = new Hono<AppBindings>().use("*", migrated).get("/meta/callback", async (c) => {
  const back = (q: string) => c.redirect(`/#/status?${q}`);
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code");
  const row = await c.env.DB.prepare("SELECT created_at FROM oauth_states WHERE state = ? AND provider = 'meta'").bind(state).first<{ created_at: number }>();
  await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!row || Date.now() - row.created_at > STATE_TTL_MS) return back("connect_error=" + encodeURIComponent("Ссылка входа устарела — нажмите «Подключить» ещё раз"));
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
    return back("connect_error=" + encodeURIComponent(msg));
  }
});
