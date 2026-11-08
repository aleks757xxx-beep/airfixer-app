import { Hono } from "hono";
import type { AppBindings, Env } from "./env";
import { securityHeaders, sameOrigin } from "./middleware/security";
import { health } from "./routes/health";
import { auth } from "./routes/auth";
import { passkeys } from "./routes/passkeys";
import { requireAuth } from "./middleware/auth";
import { ensureMigrated } from "./lib/migrate";
import { cleanupOrphans, serveMedia } from "./services/storage";
import { cleanupStaleUploads, ingest, media } from "./routes/media";
import { settings } from "./routes/settings";
import { orders, ordersAgent } from "./routes/orders";
import { publish, publishAgent } from "./routes/publish";
import { setBufferApiUrl } from "./services/buffer";
import { setGraphUrl } from "./services/meta";
import { setTgApiUrl } from "./services/telegram";
import { connect, connectCallback } from "./routes/connect";
import { processDirectQueue } from "./services/direct";
import { fireRoutine } from "./services/routine";

/**
 * PostFixer (app.airfixer.ge)
 *  /api/v2/*  — API
 *  /media/*   — ролики для Buffer (публично, ключи случайные)
 *  остальное  — интерфейс (React, dist/), строгий CSP
 */
const app = new Hono<AppBindings>();

// API
const api = new Hono<AppBindings>();
api.use("*", async (c, next) => {
  setBufferApiUrl(c.env.BUFFER_API_URL);
  setGraphUrl(c.env.META_GRAPH_URL);
  setTgApiUrl(c.env.TG_API_URL);
  await next();
});
// Возврат из Facebook после входа — без cookie (проверка по одноразовому state)
api.route("/connect", connectCallback);
// Автозагрузка с Mac — по токену, не из браузера (поэтому до проверки Origin)
api.route("/ingest/agent/publish", publishAgent);
api.route("/ingest/agent", ordersAgent);
api.route("/ingest", ingest);
api.use("*", sameOrigin);
api.route("/auth/passkey", passkeys);
api.route("/auth", auth);
// Всё остальное — только после входа (пароль + код)
api.use("*", requireAuth);
api.route("/health", health);
api.route("/media", media);
api.route("/settings", settings);
api.route("/orders", orders);
api.route("/publish", publish);
api.route("/connect", connect);
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
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureMigrated(env.DB);
    setGraphUrl(env.META_GRAPH_URL);
    setTgApiUrl(env.TG_API_URL);
    if (event.cron === "* * * * *") {
      // Каждую минуту: прямые посты (Instagram, Facebook), у которых подошло время
      const n = await processDirectQueue(env);
      if (n) console.log("direct queue: processed", n);
      if (await fireRoutine(env).catch((e: unknown) => (console.error("routine", e), false))) console.log("claude routine fired");
      return;
    }
    const removed = await cleanupOrphans(env.BUCKET, env.DB);
    console.log("cleanup: removed orphan files", removed);
    const stale = await cleanupStaleUploads(env.DB, env.BUCKET);
    console.log("cleanup: aborted stale uploads", stale);
  },
} satisfies ExportedHandler<Env>;
