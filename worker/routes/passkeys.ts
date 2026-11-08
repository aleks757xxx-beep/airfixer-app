import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AppBindings } from "../env";
import { randomToken } from "../lib/crypto";
import { ensureMigrated } from "../lib/migrate";
import { audit, createSession, destroySession, requireAuth } from "../middleware/auth";
import type { Me } from "../../shared/schemas";

/** Вход по Face ID / Touch ID («ключи входа» Apple, WebAuthn). Ключи синхронизируются через iCloud между Mac и iPhone. */

type Ctx = Context<AppBindings>;
const CHALLENGE_TTL_MS = 5 * 60_000;
const USER_ID = new Uint8Array(new TextEncoder().encode("postfixer-owner")); // один владелец
const rp = (c: Ctx) => {
  const u = new URL(c.req.url);
  return { id: u.hostname, origin: u.origin };
};

const Finish = z.object({ challengeId: z.string().min(10).max(100), response: z.record(z.string(), z.unknown()) });

async function saveChallenge(c: Ctx, kind: "register" | "login", challenge: string): Promise<string> {
  const id = randomToken(24);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM webauthn_challenges WHERE created_at < ?").bind(Date.now() - CHALLENGE_TTL_MS),
    c.env.DB.prepare("INSERT INTO webauthn_challenges (id, challenge, kind, created_at) VALUES (?, ?, ?, ?)").bind(id, challenge, kind, Date.now()),
  ]);
  return id;
}
/** Вызов одноразовый: забираем и сразу удаляем. */
async function takeChallenge(c: Ctx, id: string, kind: "register" | "login"): Promise<string | null> {
  const row = await c.env.DB.prepare("SELECT challenge, created_at FROM webauthn_challenges WHERE id = ? AND kind = ?")
    .bind(id, kind)
    .first<{ challenge: string; created_at: number }>();
  await c.env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(id).run();
  if (!row || Date.now() - row.created_at > CHALLENGE_TTL_MS) return null;
  return row.challenge;
}

interface PasskeyRow {
  id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device: string | null;
  created_at: number;
  last_used_at: number | null;
}
const transportsOf = (r: PasskeyRow): AuthenticatorTransportFuture[] | undefined => {
  try {
    const t: unknown = r.transports ? JSON.parse(r.transports) : undefined;
    return Array.isArray(t) ? (t.filter((x) => typeof x === "string") as AuthenticatorTransportFuture[]) : undefined;
  } catch {
    return undefined;
  }
};
/** Понятное имя устройства по User-Agent. */
function deviceName(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  return "Устройство";
}

export const passkeys = new Hono<AppBindings>()
  .use("*", async (c, next) => {
    await ensureMigrated(c.env.DB);
    await next();
  })

  // ---- Создать ключ (только после входа) ----
  .post("/register/options", requireAuth, async (c) => {
    const existing = await c.env.DB.prepare("SELECT * FROM passkeys").all<PasskeyRow>();
    const options = await generateRegistrationOptions({
      rpName: "PostFixer",
      rpID: rp(c).id,
      userID: USER_ID,
      userName: "postfixer",
      userDisplayName: "PostFixer — Алексей",
      attestationType: "none",
      excludeCredentials: existing.results.map((r) => ({ id: r.id, transports: transportsOf(r) })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    return c.json({ challengeId: await saveChallenge(c, "register", options.challenge), options });
  })
  .post("/register/verify", requireAuth, async (c) => {
    const p = Finish.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверный запрос" }, 400);
    const challenge = await takeChallenge(c, p.data.challengeId, "register");
    if (!challenge) return c.json({ error: "Время вышло — нажмите ещё раз" }, 400);
    try {
      const v = await verifyRegistrationResponse({
        response: p.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp(c).origin,
        expectedRPID: rp(c).id,
        requireUserVerification: false,
      });
      if (!v.verified || !v.registrationInfo) return c.json({ error: "Не удалось создать ключ входа" }, 400);
      const cred = v.registrationInfo.credential;
      const device = deviceName(c.req.header("User-Agent") ?? "");
      await c.env.DB.prepare("INSERT OR REPLACE INTO passkeys (id, public_key, counter, transports, device, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(cred.id, isoBase64URL.fromBuffer(cred.publicKey), cred.counter, cred.transports ? JSON.stringify(cred.transports) : null, device, Date.now())
        .run();
      await audit(c.env.DB, "passkey added", device);
      return c.json({ ok: true as const });
    } catch (e: unknown) {
      console.error("passkey register", e);
      return c.json({ error: "Не удалось создать ключ входа" }, 400);
    }
  })

  // ---- Вход по ключу (до входа) ----
  .post("/login/options", async (c) => {
    const options = await generateAuthenticationOptions({ rpID: rp(c).id, userVerification: "preferred" });
    return c.json({ challengeId: await saveChallenge(c, "login", options.challenge), options });
  })
  .post("/login/verify", async (c) => {
    const p = Finish.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверный запрос" }, 400);
    const challenge = await takeChallenge(c, p.data.challengeId, "login");
    if (!challenge) return c.json({ error: "Время вышло — нажмите ещё раз" }, 400);
    const response = p.data.response as unknown as AuthenticationResponseJSON;
    const row = await c.env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(String(response.id ?? "")).first<PasskeyRow>();
    if (!row) return c.json({ error: "Этот ключ входа не подходит — войдите паролем и создайте новый в «Состоянии»" }, 401);
    try {
      const v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp(c).origin,
        expectedRPID: rp(c).id,
        credential: { id: row.id, publicKey: isoBase64URL.toBuffer(row.public_key), counter: row.counter, transports: transportsOf(row) },
        requireUserVerification: false,
      });
      if (!v.verified) return c.json({ error: "Ключ входа не подтверждён" }, 401);
      await c.env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(v.authenticationInfo.newCounter, Date.now(), row.id).run();
      await destroySession(c);
      await createSession(c, true);
      await audit(c.env.DB, "login passkey", deviceName(c.req.header("User-Agent") ?? ""));
      const body: Me = { state: "ok" };
      return c.json(body);
    } catch (e: unknown) {
      console.error("passkey login", e);
      return c.json({ error: "Ключ входа не подтверждён" }, 401);
    }
  })

  // ---- Список и удаление (после входа) ----
  .get("/", requireAuth, async (c) => {
    const rows = await c.env.DB.prepare("SELECT * FROM passkeys ORDER BY created_at").all<PasskeyRow>();
    return c.json({ items: rows.results.map((r) => ({ id: r.id, device: r.device ?? "Устройство", createdAt: r.created_at, lastUsedAt: r.last_used_at })) });
  })
  .delete("/:id", requireAuth, async (c) => {
    await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ?").bind(c.req.param("id")).run();
    await audit(c.env.DB, "passkey removed");
    return c.json({ ok: true as const });
  });
