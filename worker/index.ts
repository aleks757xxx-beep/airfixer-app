import { Hono } from "hono";
import type { AppBindings, Env } from "./env";
import { securityHeaders, sameOrigin } from "./middleware/security";
import { health } from "./routes/health";
import { auth } from "./routes/auth";
import { requireAuth } from "./middleware/auth";
import { ensureMigrated } from "./lib/migrate";
import { cleanupOrphans, serveMedia } from "./services/storage";
import { ingest, media } from "./routes/media";

/**
 * PostFixer (app.airfixer.ge)
 *  /api/v2/*  — API
 *  /media/*   — ролики для Buffer (публично, ключи случайные)
 *  остальное  — интерфейс (React, dist/), строгий CSP
 */
const app = new Hono<AppBindings>();

// API
const api = new Hono<AppBindings>();
// Автозагрузка с Mac — по токену, не из браузера (поэтому до проверки Origin)
api.route("/ingest", ingest);
api.use("*", sameOrigin);
api.route("/auth", auth);
// Всё остальное — только после входа (пароль + код)
api.use("*", requireAuth);
api.route("/health", health);
api.route("/media", media);
api.all("*", (c) => c.json({ error: "Не найдено" }, 404));
api.onError((err, c) => {
  console.error("api error", err);
  return c.json({ error: "Внутренняя ошибка" }, 500);
});

app.use("*", securityHeaders({ csp: true }));
app.route("/api/v2", api);
app.on(["GET", "HEAD"], "/media/*", (c) =>
  serveMedia(c.req.raw, c.env.BUCKET, decodeURIComponent(new URL(c.req.url).pathname.slice("/media/".length))),
);

// Интерфейс: файл из dist/, иначе index.html (переходы внутри приложения)
app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  const index = new URL("/", c.req.url);
  return c.env.ASSETS.fetch(new Request(index, c.req.raw));
});
app.all("*", (c) => c.json({ error: "Не найдено" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureMigrated(env.DB));
    await ensureMigrated(env.DB);
    const removed = await cleanupOrphans(env.BUCKET, env.DB);
    console.log("cleanup: removed orphan files", removed);
  },
} satisfies ExportedHandler<Env>;
