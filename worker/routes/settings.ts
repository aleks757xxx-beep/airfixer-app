import { Hono } from "hono";
import type { AppBindings } from "../env";
import { DEFAULT_CLAUDE_URL, DEFAULT_TG_BUTTON, NotifyInputSchema, SettingsInputSchema, type Settings } from "../../shared/schemas";
import { notify, notifyConfig } from "../services/notify";
import { ensureMigrated } from "../lib/migrate";
import { audit } from "../middleware/auth";
import { backupFileName, exportBackup } from "../services/backup";

const KEYS = { claudeUrl: "claude_url", tgButtonText: "tg_button_text", tgButtonUrl: "tg_button_url" } as const;

export async function readSettings(db: D1Database): Promise<Settings> {
  const rows = await db.prepare("SELECT key, value FROM app_settings WHERE key IN ('claude_url', 'tg_button_text', 'tg_button_url')").all<{ key: string; value: string | null }>();
  const v = new Map(rows.results.map((r) => [r.key, r.value]));
  return {
    claudeUrl: v.get(KEYS.claudeUrl) || DEFAULT_CLAUDE_URL,
    tgButtonText: v.get(KEYS.tgButtonText) ?? DEFAULT_TG_BUTTON.text,
    tgButtonUrl: v.get(KEYS.tgButtonUrl) ?? DEFAULT_TG_BUTTON.url,
  };
}

/** Настройки приложения (только после входа). */
export const settings = new Hono<AppBindings>()
  .use("*", async (c, next) => {
    await ensureMigrated(c.env.DB);
    await next();
  })
  .get("/", async (c) => {
    const cfg = await notifyConfig(c.env);
    const body: Settings = {
      ...(await readSettings(c.env.DB)),
      notify: { connected: !!cfg.chatId && !!c.env.TG_BOT_TOKEN?.trim(), off: Object.entries(cfg.kinds).filter(([, on]) => !on).map(([k]) => k) },
    };
    return c.json(body);
  })
  // Резервная копия данных (без секретов) — скачать файлом
  .get("/backup", async (c) => {
    const b = await exportBackup(c.env.DB);
    await audit(c.env.DB, "backup download");
    return new Response(JSON.stringify(b), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${backupFileName(b.exportedAt)}"`, "cache-control": "no-store" },
    });
  })
  // Какие уведомления присылать
  .put("/notify", async (c) => {
    const p = NotifyInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Неверные настройки уведомлений" }, 400);
    const put = (key: string, value: string) =>
      c.env.DB.prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(key, value, Date.now());
    const stmts = [];
    if (p.data.off) stmts.push(put("notify_off", JSON.stringify(p.data.off)));
    if (p.data.chatId) stmts.push(put("notify_chat_id", p.data.chatId));
    if (stmts.length) await c.env.DB.batch(stmts);
    if (p.data.chatId) await audit(c.env.DB, "notify chat set");
    return c.json({ ok: true as const });
  })
  // Проверочное сообщение
  .post("/notify/test", async (c) => {
    const ok = await notify(c.env, "test", "👋 <b>PostFixer</b>: уведомления работают. Сюда будут приходить сообщения о постах и подключениях.");
    return ok ? c.json({ ok: true as const }) : c.json({ error: "Не удалось отправить — чат не привязан или бот недоступен" }, 502);
  })
  .put("/", async (c) => {
    const parsed = SettingsInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Проверьте настройки" }, 400);
    const now = Date.now();
    const stmts = (Object.keys(KEYS) as Array<keyof typeof KEYS>)
      .filter((k) => parsed.data[k] !== undefined)
      .map((k) =>
        c.env.DB.prepare(
          "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        ).bind(KEYS[k], parsed.data[k] ?? "", now),
      );
    if (stmts.length) await c.env.DB.batch(stmts);
    await audit(c.env.DB, "settings", JSON.stringify(parsed.data).slice(0, 300));
    return c.json(await readSettings(c.env.DB));
  });
