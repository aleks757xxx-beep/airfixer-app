import { Hono } from "hono";
import type { AppBindings } from "../env";
import { ensureMigrated } from "../lib/migrate";
import { HealthSchema, type Health } from "../../shared/schemas";
import { APP_VERSION } from "../version";

/** Проверка, что всё подключено. Не раскрывает значения секретов — только есть/нет. */
export const health = new Hono<AppBindings>().get("/", async (c) => {
  let migration = 0;
  let dbOk = false;
  try {
    migration = await ensureMigrated(c.env.DB);
    await c.env.DB.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let storageOk = false;
  try {
    await c.env.BUCKET.list({ limit: 1 });
    storageOk = true;
  } catch {
    storageOk = false;
  }
  const body: Health = HealthSchema.parse({
    ok: dbOk && storageOk,
    version: APP_VERSION,
    db: { ok: dbOk, migration },
    storage: { ok: storageOk },
    secrets: {
      appPassword: Boolean(c.env.APP_PASSWORD),
      bufferApiKey: Boolean(c.env.BUFFER_API_KEY),
      uploadToken: Boolean(c.env.UPLOAD_TOKEN),
    },
  });
  return c.json(body, body.ok ? 200 : 503);
});
