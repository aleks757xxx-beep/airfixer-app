import { Hono } from "hono";
import type { AppBindings } from "../env";
import { DEFAULT_CLAUDE_URL, DEFAULT_TG_BUTTON, SettingsInputSchema, type Settings } from "../../shared/schemas";
import { ensureMigrated } from "../lib/migrate";
import { audit } from "../middleware/auth";

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
  .get("/", async (c) => c.json(await readSettings(c.env.DB)))
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
