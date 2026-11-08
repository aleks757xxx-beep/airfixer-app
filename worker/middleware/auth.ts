import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppBindings } from "../env";
import type { AuthState } from "../../shared/schemas";
import { randomToken, sha256Hex } from "../lib/crypto";
import { ensureMigrated } from "../lib/migrate";

const SESSION_COOKIE = "pf_session";
export const DEVICE_COOKIE = "pf_device";
/**
 * Решение владельца 07.11.2026: вход без срока — до нажатия «Выйти» (или «Выйти на всех устройствах»).
 * Браузеры не хранят cookie дольше 400 дней, поэтому при каждом заходе срок cookie продлевается.
 */
const NO_EXPIRY_MS = 100 * 365 * 24 * 3600 * 1000;
const COOKIE_MAX_AGE_SEC = 400 * 86400;

interface SessionRow {
  id: string;
  expires_at: number;
  mfa_ok: number;
  pending_totp: string | null;
}

const cookieOpts = (maxAgeSec: number) =>
  ({ path: "/", httpOnly: true, secure: true, sameSite: "Strict", maxAge: maxAgeSec }) as const;

export async function getSession(c: Context<AppBindings>): Promise<SessionRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  await ensureMigrated(c.env.DB);
  const row = await c.env.DB.prepare("SELECT id, expires_at, mfa_ok, pending_totp FROM sessions WHERE id = ?")
    .bind(await sha256Hex(token))
    .first<SessionRow>();
  if (!row || row.expires_at < Date.now()) return null;
  // продлить cookie (и устройства), чтобы вход не слетал
  setCookie(c, SESSION_COOKIE, token, cookieOpts(COOKIE_MAX_AGE_SEC));
  const device = getCookie(c, DEVICE_COOKIE);
  if (device) setCookie(c, DEVICE_COOKIE, device, cookieOpts(COOKIE_MAX_AGE_SEC));
  return row;
}

export async function createSession(c: Context<AppBindings>, mfaOk: boolean): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, created_at, expires_at, mfa_ok, user_agent, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(await sha256Hex(token), now, now + NO_EXPIRY_MS, mfaOk ? 1 : 0, (c.req.header("User-Agent") ?? "").slice(0, 200), now)
    .run();
  setCookie(c, SESSION_COOKIE, token, cookieOpts(COOKIE_MAX_AGE_SEC));
}

export async function destroySession(c: Context<AppBindings>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

/** Устройство, на котором код уже вводили — там код больше не спрашиваем. */
export async function isTrustedDevice(c: Context<AppBindings>): Promise<boolean> {
  const token = getCookie(c, DEVICE_COOKIE);
  if (!token) return false;
  const row = await c.env.DB.prepare("SELECT expires_at FROM trusted_devices WHERE id = ?")
    .bind(await sha256Hex(token))
    .first<{ expires_at: number }>();
  return Boolean(row && row.expires_at > Date.now());
}

export async function trustDevice(c: Context<AppBindings>): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO trusted_devices (id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), now, now + NO_EXPIRY_MS, (c.req.header("User-Agent") ?? "").slice(0, 200))
    .run();
  setCookie(c, DEVICE_COOKIE, token, cookieOpts(COOKIE_MAX_AGE_SEC));
}

export async function totpConfigured(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT totp_secret_enc FROM auth_settings WHERE id = 1").first<{ totp_secret_enc: string | null }>();
  return Boolean(row?.totp_secret_enc);
}

export async function authState(c: Context<AppBindings>, s: SessionRow | null): Promise<AuthState> {
  if (!s) return "anonymous";
  if (s.mfa_ok) return "ok";
  return (await totpConfigured(c.env.DB)) ? "mfa_required" : "mfa_setup";
}

/** Все API, кроме входа, — только после пароля и кода. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const s = await getSession(c);
  if (!s || !s.mfa_ok) return c.json({ error: "Нужно войти" }, 401);
  await next();
};

export async function audit(db: D1Database, action: string, details?: string): Promise<void> {
  await db.prepare("INSERT INTO audit_log (at, action, details) VALUES (?, ?, ?)").bind(Date.now(), action, details ?? null).run();
}
