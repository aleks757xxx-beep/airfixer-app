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

// ---------- Библиотека роликов ----------
export const MediaSourceSchema = z.enum(["upload", "gotovoe"]);
export type MediaSource = z.infer<typeof MediaSourceSchema>;

export const NoteStatusSchema = z.enum(["new", "done"]);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;
export const NOTE_MAX = 2000;
export const NoteInputSchema = z.object({ note: z.string().max(NOTE_MAX) });
export const TaskReplySchema = z.object({ reply: z.string().min(1).max(NOTE_MAX) });

export const MediaItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int(),
  mime: z.string().nullable(),
  source: MediaSourceSchema,
  createdAt: z.number().int(),
  url: z.string(),
  /** Задание для Claude (пишет владелец) */
  note: z.string().nullable(),
  noteStatus: NoteStatusSchema.nullable(),
  /** Ответ Claude на задание */
  noteReply: z.string().nullable(),
  noteAt: z.number().int().nullable(),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const MediaListSchema = z.object({
  items: z.array(MediaItemSchema),
  totalBytes: z.number().int(),
  limitBytes: z.number().int(),
});
export type MediaList = z.infer<typeof MediaListSchema>;

export const MediaItemResultSchema = z.object({ item: MediaItemSchema });
export const TaskListSchema = z.object({ items: z.array(MediaItemSchema) });
export type TaskList = z.infer<typeof TaskListSchema>;

export const UploadResultSchema = z.object({ item: MediaItemSchema, duplicate: z.boolean() });
export type UploadResult = z.infer<typeof UploadResultSchema>;

/**
 * Ограничения загрузки. Cloudflare принимает до 100 МБ за один запрос,
 * поэтому ролики грузятся частями по PART_SIZE (R2 multipart), всего до MAX_UPLOAD_BYTES.
 */
export const PART_SIZE = 50 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

export const UploadStartInputSchema = z.object({
  name: z.string().min(1).max(200),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type UploadStartInput = z.infer<typeof UploadStartInputSchema>;

export const UploadStartSchema = z.discriminatedUnion("duplicate", [
  z.object({ duplicate: z.literal(true), item: MediaItemSchema }),
  z.object({ duplicate: z.literal(false), uploadId: z.string(), partSize: z.number().int(), parts: z.number().int() }),
]);
export type UploadStart = z.infer<typeof UploadStartSchema>;

export const UploadPartSchema = z.object({ partNumber: z.number().int(), etag: z.string() });
export type UploadPart = z.infer<typeof UploadPartSchema>;

export const UploadCompleteInputSchema = z.object({ parts: z.array(UploadPartSchema).min(1).max(10000) });
export const ALLOWED_VIDEO_EXT = ["mp4", "mov", "m4v"] as const;

// ---------- Настройки ----------
/** Чат с Claude по умолчанию — текущий рабочий чат; меняется в «Состоянии». */
export const DEFAULT_CLAUDE_URL = "https://claude.ai/code/session_01V1h3GHri8iWkFU8ZAPG15M";
export const ClaudeUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^https:\/\/claude\.ai\/[A-Za-z0-9._~\/?#=&%-]*$/.test(u), "Ссылка должна начинаться с https://claude.ai/");
export const SettingsSchema = z.object({ claudeUrl: z.string() });
export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsInputSchema = z.object({ claudeUrl: ClaudeUrlSchema });
