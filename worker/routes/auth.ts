import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { AppBindings } from "../env";
import { LoginInputSchema, TotpCodeSchema, type Me, type TotpSetup } from "../../shared/schemas";
import { safeEqual } from "../lib/crypto";
import { newTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";
import { ensureMigrated } from "../lib/migrate";
import {
  DEVICE_COOKIE,
  audit,
  authState,
  createSession,
  destroySession,
  getSession,
  isTrustedDevice,
  requireAuth,
  totpConfigured,
  trustDevice,
} from "../middleware/auth";

const MAX_FAILS = 8; // попыток за окно
const WINDOW_MS = 15 * 60 * 1000;

async function tooManyAttempts(db: D1Database, ip: string): Promise<boolean> {
  const since = Date.now() - WINDOW_MS;
  await db.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since).run();
  const r = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at >= ?").bind(ip, since).first<{ n: number }>();
  return (r?.n ?? 0) >= MAX_FAILS;
}
async function recordFail(db: D1Database, ip: string): Promise<void> {
  await db.prepare("INSERT INTO login_attempts (ip, at) VALUES (?, ?)").bind(ip, Date.now()).run();
}
const slow = () => new Promise((r) => setTimeout(r, 600));

export const auth = new Hono<AppBindings>()
  .use("*", async (c, next) => {
    await ensureMigrated(c.env.DB);
    await next();
  })

  .get("/me", async (c) => {
    const body: Me = { state: await authState(c, await getSession(c)) };
    return c.json(body);
  })

  .post("/login", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (await tooManyAttempts(c.env.DB, ip)) return c.json({ error: "Слишком много попыток. Подождите 15 минут." }, 429);
    const parsed = LoginInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Введите пароль" }, 400);
    const expected = c.env.APP_PASSWORD?.trim();
    if (!expected) return c.json({ error: "В Cloudflare не задан APP_PASSWORD" }, 500);
    if (!(await safeEqual(parsed.data.password.trim(), expected))) {
      await recordFail(c.env.DB, ip);
      await slow();
      return c.json({ error: "Неверный пароль" }, 401);
    }
    await destroySession(c);
    const trusted = (await totpConfigured(c.env.DB)) && (await isTrustedDevice(c));
    await createSession(c, trusted);
    await audit(c.env.DB, "login", trusted ? "trusted device" : "password ok, code needed");
    const body: Me = { state: trusted ? "ok" : (await totpConfigured(c.env.DB)) ? "mfa_required" : "mfa_setup" };
    return c.json(body);
  })

  /** Подключение 2FA: только после пароля и только если 2FA ещё не подключена. */
  .post("/totp/setup", async (c) => {
    const s = await getSession(c);
    if (!s) return c.json({ error: "Нужно войти" }, 401);
    if (await totpConfigured(c.env.DB)) return c.json({ error: "Код уже подключён" }, 409);
    const secret = s.pending_totp ?? newTotpSecret();
    if (!s.pending_totp) await c.env.DB.prepare("UPDATE sessions SET pending_totp = ? WHERE id = ?").bind(secret, s.id).run();
    const body: TotpSetup = { secret, uri: otpauthUri(secret, "Алексей", "PostFixer") };
    return c.json(body);
  })

  .post("/totp/verify", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (await tooManyAttempts(c.env.DB, ip)) return c.json({ error: "Слишком много попыток. Подождите 15 минут." }, 429);
    const s = await getSession(c);
    if (!s) return c.json({ error: "Нужно войти" }, 401);
    const parsed = TotpCodeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Код — 6 цифр" }, 400);

    const row = await c.env.DB.prepare("SELECT totp_secret_enc, last_step FROM auth_settings WHERE id = 1").first<{
      totp_secret_enc: string | null;
      last_step: number | null;
    }>();
    const configured = Boolean(row?.totp_secret_enc);
    const secret = configured ? row?.totp_secret_enc ?? null : s.pending_totp;
    if (!secret) return c.json({ error: "Сначала подключите код" }, 400);

    const step = await verifyTotp(secret, parsed.data.code, configured ? row?.last_step ?? null : null);
    if (step === null) {
      await recordFail(c.env.DB, ip);
      await slow();
      return c.json({ error: "Неверный код. Проверьте время на телефоне и попробуйте следующий." }, 401);
    }
    const now = Date.now();
    await c.env.DB.batch([
      configured
        ? c.env.DB.prepare("UPDATE auth_settings SET last_step = ? WHERE id = 1").bind(step)
        : c.env.DB.prepare(
            "INSERT INTO auth_settings (id, totp_secret_enc, totp_enabled_at, last_step) VALUES (1, ?, ?, ?) " +
              "ON CONFLICT(id) DO UPDATE SET totp_secret_enc = excluded.totp_secret_enc, totp_enabled_at = excluded.totp_enabled_at, last_step = excluded.last_step",
          ).bind(secret, now, step),
      c.env.DB.prepare("UPDATE sessions SET mfa_ok = 1, pending_totp = NULL, last_seen = ? WHERE id = ?").bind(now, s.id),
    ]);
    if (parsed.data.trustDevice) await trustDevice(c);
    await audit(c.env.DB, configured ? "mfa ok" : "mfa enabled");
    const body: Me = { state: "ok" };
    return c.json(body);
  })

  /** Показать ключ кода проверки ещё раз (добавить код на второе устройство). Только после входа и с текущим кодом. */
  .post("/totp/reveal", requireAuth, async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (await tooManyAttempts(c.env.DB, ip)) return c.json({ error: "Слишком много попыток. Подождите 15 минут." }, 429);
    const parsed = TotpCodeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Код — 6 цифр" }, 400);
    const row = await c.env.DB.prepare("SELECT totp_secret_enc, last_step FROM auth_settings WHERE id = 1").first<{ totp_secret_enc: string | null; last_step: number | null }>();
    if (!row?.totp_secret_enc) return c.json({ error: "Код проверки не подключён" }, 400);
    const step = await verifyTotp(row.totp_secret_enc, parsed.data.code, row.last_step);
    if (step === null) {
      await recordFail(c.env.DB, ip);
      await slow();
      return c.json({ error: "Неверный код — введите следующий из «Паролей»" }, 401);
    }
    await c.env.DB.prepare("UPDATE auth_settings SET last_step = ? WHERE id = 1").bind(step).run();
    await audit(c.env.DB, "totp reveal", "ключ показан для второго устройства");
    const body: TotpSetup = { secret: row.totp_secret_enc, uri: otpauthUri(row.totp_secret_enc, "Алексей", "PostFixer") };
    return c.json(body);
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true as const });
  })

  /** Выйти на всех устройствах: удаляет все сессии и доверенные устройства. */
  .post("/logout-all", requireAuth, async (c) => {
    await c.env.DB.batch([c.env.DB.prepare("DELETE FROM sessions"), c.env.DB.prepare("DELETE FROM trusted_devices")]);
    await audit(c.env.DB, "logout all");
    deleteCookie(c, DEVICE_COOKIE, { path: "/", secure: true });
    await destroySession(c);
    return c.json({ ok: true as const });
  });
