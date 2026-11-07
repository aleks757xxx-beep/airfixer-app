import { z } from "zod";

/** Общие схемы для Worker и интерфейса. Типы выводятся из схем — один источник правды. */

export const ServiceSchema = z.enum(["instagram", "facebook", "tiktok", "youtube"]);
export type Service = z.infer<typeof ServiceSchema>;

export const PostStatusSchema = z.enum(["draft", "scheduled", "published", "failed", "partial"]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.object({ ok: z.boolean(), migration: z.number().int() }),
  storage: z.object({ ok: z.boolean() }),
  buffer: z.object({
    ok: z.boolean(),
    organizations: z.number().int(),
    mutations: z.array(z.string()),
    error: z.string().optional(),
  }),
  secrets: z.object({
    appPassword: z.boolean(),
    bufferApiKey: z.boolean(),
    uploadToken: z.boolean(),
  }),
});
export type Health = z.infer<typeof HealthSchema>;

export const ApiErrorSchema = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------- Вход ----------
/** anonymous — нужен пароль; mfa_setup — подключить 2FA; mfa_required — ввести код; ok — внутри. */
export const AuthStateSchema = z.enum(["anonymous", "mfa_setup", "mfa_required", "ok"]);
export type AuthState = z.infer<typeof AuthStateSchema>;

export const MeSchema = z.object({ state: AuthStateSchema });
export type Me = z.infer<typeof MeSchema>;

export const LoginInputSchema = z.object({ password: z.string().min(1, "Введите пароль").max(200) });
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const TotpCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Код — 6 цифр"),
  trustDevice: z.boolean().default(true),
});
export type TotpCodeInput = z.input<typeof TotpCodeSchema>;

export const TotpSetupSchema = z.object({ secret: z.string(), uri: z.string() });
export type TotpSetup = z.infer<typeof TotpSetupSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
