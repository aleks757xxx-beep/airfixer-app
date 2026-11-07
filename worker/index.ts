import { Hono } from "hono";
import type { AppBindings, Env } from "./env";
import { securityHeaders, sameOrigin } from "./middleware/security";
import { health } from "./routes/health";
import { ensureMigrated } from "./lib/migrate";
import legacy from "./legacy.js";

/**
 * PostFixer.
 *  /next/*      — новый интерфейс (React, dist/next), строгий CSP
 *  /api/v2/*    — новый API
 *  остальное    — старая версия (worker/legacy.js), пока её не заменят новые экраны
 */
const app = new Hono<AppBindings>();

// Новый интерфейс
app.use("/next/*", securityHeaders({ csp: true }));
app.get("/next", (c) => c.redirect("/next/", 301));
app.get("/next/*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Новый API
const api = new Hono<AppBindings>();
api.use("*", securityHeaders({ csp: true }));
api.use("*", sameOrigin);
api.route("/health", health);
api.all("*", (c) => c.json({ error: "Не найдено" }, 404));
api.onError((err, c) => {
  console.error("api error", err);
  return c.json({ error: "Внутренняя ошибка" }, 500);
});
app.route("/api/v2", api);

// Старая версия: базовые заголовки без CSP (у неё встроенные скрипты)
app.use("*", securityHeaders({ csp: false }));
app.all("*", (c) => legacy.fetch(c.req.raw, c.env));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureMigrated(env.DB));
    await legacy.scheduled(event, env);
  },
} satisfies ExportedHandler<Env>;
