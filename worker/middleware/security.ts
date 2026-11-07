import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";

/**
 * Заголовки безопасности — как в CRM (app/_headers).
 * CSP строгий: скрипты и стили только свои, запросы только к своему домену,
 * видео — свои /media/ и blob: (превью), встраивать приложение нельзя.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // превью постов из Buffer (картинки, не скрипты)
  "img-src 'self' data: blob: https://images.buffer.com https://i.ytimg.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders = (opts: { csp: boolean }): MiddlewareHandler<AppBindings> => async (c, next) => {
  await next();
  // Ответы из ASSETS и старой версии могут иметь неизменяемые заголовки — копируем
  c.res = new Response(c.res.body, c.res);
  const h = c.res.headers;
  h.set("Strict-Transport-Security", "max-age=31536000");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (opts.csp) h.set("Content-Security-Policy", CSP);
};

/** Защита от CSRF: изменяющие запросы к API — только со своего сайта. */
export const sameOrigin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const m = c.req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  const origin = c.req.header("Origin");
  const self = new URL(c.req.url).origin;
  if (origin !== self) return c.json({ error: "Запрос с чужого сайта отклонён" }, 403);
  return next();
};
