import { Hono } from "hono";
import type { AppBindings } from "../env";
import { DEFAULT_CLAUDE_URL, SettingsInputSchema, type Settings } from "../../shared/schemas";
import { ensureMigrated } from "../lib/migrate";
import { audit } from "../middleware/auth";

async function readSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'claude_url'").first<{ value: string | null }>();
  return { claudeUrl: row?.value || DEFAULT_CLAUDE_URL };
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
    if (!parsed.success) return c.json({ error: "Ссылка должна начинаться с https://claude.ai/" }, 400);
    await c.env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('claude_url', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(parsed.data.claudeUrl, Date.now())
      .run();
    await audit(c.env.DB, "settings claude_url", parsed.data.claudeUrl);
    return c.json(await readSettings(c.env.DB));
  });
