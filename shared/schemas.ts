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
  /** Размер лёгкой копии для Telegram («имя.tg.mp4»), если есть */
  tgSize: z.number().int().nullable().optional(),
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
/** Кнопка под постами в Telegram — в бот записи для клиентов (решение владельца 08.11.2026). Пустая ссылка — без кнопки. */
export const DEFAULT_TG_BUTTON = { text: "📅 Записаться", url: "https://t.me/fixerairbot" } as const;
export const SettingsSchema = z.object({
  claudeUrl: z.string(),
  tgButtonText: z.string(),
  tgButtonUrl: z.string(),
  /** Claude берётся за задания сам (задача Claude с запуском по сигналу) */
  claudeAuto: z.object({ configured: z.boolean(), lastFire: z.number().nullable(), pending: z.number() }).optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsInputSchema = z.object({
  claudeUrl: ClaudeUrlSchema.optional(),
  tgButtonText: z.string().trim().max(40, "Текст кнопки — до 40 знаков").optional(),
  tgButtonUrl: z
    .string()
    .trim()
    .max(300)
    .refine((u) => u === "" || /^https:\/\/\S+$/.test(u), "Ссылка кнопки должна начинаться с https://")
    .optional(),
});
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

// ---------- Заказы монтажа ----------
export const OrderStatusSchema = z.enum(["new", "in_work", "draft", "revise", "accepted", "cancelled"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export const OrderEventKindSchema = z.enum(["created", "in_work", "comment", "draft", "revise", "accepted", "cancelled"]);
export type OrderEventKind = z.infer<typeof OrderEventKindSchema>;

export const OrderEventSchema = z.object({
  id: z.number().int(),
  kind: OrderEventKindSchema,
  author: z.enum(["owner", "claude"]),
  text: z.string().nullable(),
  media: MediaItemSchema.nullable(),
  createdAt: z.number().int(),
});
export type OrderEvent = z.infer<typeof OrderEventSchema>;

export const OrderSchema = z.object({
  id: z.number().int(),
  status: OrderStatusSchema,
  shootDate: z.string().nullable(),
  folder: z.string().nullable(),
  brief: z.string(),
  durationSec: z.number().int().nullable(),
  style: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  events: z.array(OrderEventSchema),
});
export type Order = z.infer<typeof OrderSchema>;
export const OrderListSchema = z.object({ items: z.array(OrderSchema) });
export type OrderList = z.infer<typeof OrderListSchema>;
export const OrderResultSchema = z.object({ order: OrderSchema });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
export const OrderInputSchema = z.object({
  shootDate: isoDate.nullable(),
  folder: z.string().trim().max(200).nullable(),
  brief: z.string().trim().min(1, "Опишите, что снято и что нужно").max(NOTE_MAX),
  durationSec: z.number().int().min(5).max(600).nullable(),
  style: z.string().trim().max(300).nullable(),
});
export type OrderInput = z.infer<typeof OrderInputSchema>;
export const OrderTextInputSchema = z.object({ text: z.string().trim().min(1, "Напишите текст").max(NOTE_MAX) });

/** Ответы Claude по заказу (по токену). */
export const OrderAgentInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("in_work"), text: z.string().trim().max(NOTE_MAX).optional() }),
  z.object({ kind: z.literal("comment"), text: z.string().trim().min(1).max(NOTE_MAX) }),
  z.object({ kind: z.literal("draft"), mediaId: z.string().min(1), text: z.string().trim().max(NOTE_MAX).optional() }),
]);
export type OrderAgentInput = z.infer<typeof OrderAgentInputSchema>;

/** Оглавление «Исходников» (Claude обновляет с Mac): папки и даты съёмки. */
export const SourceFolderSchema = z.object({
  name: z.string().min(1).max(200),
  count: z.number().int().nonnegative(),
  dates: z.array(z.object({ date: isoDate, count: z.number().int().positive() })).max(2000),
});
export type SourceFolder = z.infer<typeof SourceFolderSchema>;
export const SourcesIndexSchema = z.object({
  updatedAt: z.number().int().nullable(),
  folders: z.array(SourceFolderSchema).max(500),
});
export type SourcesIndex = z.infer<typeof SourcesIndexSchema>;
export const SourcesIndexInputSchema = SourcesIndexSchema.pick({ folders: true });

// ---------- Публикация (Buffer) ----------
export const ChannelServiceSchema = z.string();
export const ScheduleDaySchema = z.object({ day: z.string(), times: z.array(z.string()), paused: z.boolean() });
export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  service: ChannelServiceSchema,
  avatar: z.string(),
  timezone: z.string(),
  isQueuePaused: z.boolean(),
  isDisconnected: z.boolean(),
  /** Заблокирован тарифом Buffer (каналов больше, чем разрешено) */
  isLocked: z.boolean(),
  schedule: z.array(ScheduleDaySchema),
});
export type Channel = z.infer<typeof ChannelSchema>;
export const ChannelListSchema = z.object({ items: z.array(ChannelSchema) });
export type ChannelList = z.infer<typeof ChannelListSchema>;

export const BufferPostStatusSchema = z.enum(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]);
export type BufferPostStatus = z.infer<typeof BufferPostStatusSchema>;
export const BufferPostSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  service: z.string(),
  status: BufferPostStatusSchema,
  text: z.string(),
  dueAt: z.number().int().nullable(),
  sentAt: z.number().int().nullable(),
  error: z.string().nullable(),
  isCustomScheduled: z.boolean(),
  externalLink: z.string().nullable(),
  thumbnail: z.string().nullable(),
  /** Ролик из нашей библиотеки, если пост создан из PostFixer */
  mediaId: z.string().nullable(),
  mediaUrl: z.string().nullable(),
});
export type BufferPost = z.infer<typeof BufferPostSchema>;
export const BufferPostListSchema = z.object({ items: z.array(BufferPostSchema), drafts: z.array(BufferPostSchema) });
export type BufferPostList = z.infer<typeof BufferPostListSchema>;

/** Как выпустить пост — как кнопки Buffer. */
export const ShareModeSchema = z.enum(["queue", "next", "now", "schedule", "draft"]);
export type ShareMode = z.infer<typeof ShareModeSchema>;
export const POST_TEXT_MAX = 5000;
export const ComposeTargetSchema = z.object({
  channelId: z.string().min(1).max(100),
  text: z.string().max(POST_TEXT_MAX),
  /** Название (YouTube, TikTok, Google) */
  title: z.string().trim().max(100).optional(),
  /** Первый комментарий (Instagram, Facebook) */
  firstComment: z.string().max(2200).optional(),
});
export const GoogleButtonSchema = z.enum(["call", "learn_more", "none"]);
export type GoogleButton = z.infer<typeof GoogleButtonSchema>;
export const ComposeInputSchema = z
  .object({
    mediaId: z.string().min(1),
    mode: ShareModeSchema,
    dueAt: z.number().int().optional(),
    targets: z.array(ComposeTargetSchema).min(1, "Выберите хотя бы одну соцсеть").max(20),
    /** Обложка: кадр ролика, мс от начала (Instagram, TikTok) */
    thumbnailMs: z.number().int().min(0).max(600_000).optional(),
    /** Геометка Instagram «Тбилиси» */
    geotag: z.boolean().optional(),
    /** Кнопка под постом Google */
    googleButton: GoogleButtonSchema.optional(),
  })
  .refine((v) => v.mode !== "schedule" || (v.dueAt !== undefined && v.dueAt > Date.now() - 60_000), {
    message: "Укажите дату и время в будущем",
  });
export type ComposeInput = z.infer<typeof ComposeInputSchema>;
export const ComposeResultSchema = z.object({
  results: z.array(z.object({ channelId: z.string(), ok: z.boolean(), postId: z.string().nullable(), error: z.string().nullable() })),
});
export type ComposeResult = z.infer<typeof ComposeResultSchema>;
export const MovePostInputSchema = z.object({ dueAt: z.number().int() });
export const PostTextInputSchema = z.object({
  text: z.string().max(POST_TEXT_MAX),
  /** Новое название (YouTube/TikTok) — вместе с сетью поста */
  title: z.object({ service: z.string(), title: z.string().trim().min(1).max(100) }).optional(),
  firstComment: z.string().max(2200).optional(),
});
export const PostResultSchema = z.object({ post: BufferPostSchema });

/** Лимиты длины подписи по сетям (для счётчика в окне поста). */
export const TEXT_LIMITS: Readonly<Record<string, number>> = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  facebook: 5000,
  googlebusiness: 1500,
  telegram: 1024,
};
/** Боты Telegram принимают ролики до 50 МБ. */
export const TG_MAX_BYTES = 50 * 1024 * 1024;
/** Грузия без перехода на летнее время: UTC+4. */
export const TBILISI_OFFSET_MS = 4 * 3600 * 1000;

/** Статистика постов (Buffer: экспериментально). */
export const PostMetricSchema = z.object({ type: z.string(), name: z.string(), value: z.number(), unit: z.string() });
export type PostMetric = z.infer<typeof PostMetricSchema>;
export const StatPostSchema = BufferPostSchema.extend({ metrics: z.array(PostMetricSchema), metricsUpdatedAt: z.number().int().nullable() });
export type StatPost = z.infer<typeof StatPostSchema>;
export const StatsSchema = z.object({ items: z.array(StatPostSchema), updatedAt: z.number().int() });
export type Stats = z.infer<typeof StatsSchema>;

/** Вставки (сниппеты Buffer): наборы хэштегов, подвалы с контактами. */
export const SnippetSchema = z.object({ id: z.string(), name: z.string(), text: z.string() });
export type Snippet = z.infer<typeof SnippetSchema>;
export const SnippetListSchema = z.object({ items: z.array(SnippetSchema) });
export type SnippetList = z.infer<typeof SnippetListSchema>;
export const SnippetInputSchema = z.object({ name: z.string().trim().min(1, "Название").max(100), text: z.string().trim().min(1, "Текст").max(5000) });
export type SnippetInput = z.infer<typeof SnippetInputSchema>;
export const SnippetResultSchema = z.object({ snippet: SnippetSchema });

/** Лимиты тарифа Buffer. */
export const BufferLimitsSchema = z.object({
  scheduledPosts: z.number().int(),
  channels: z.number().int(),
  scheduledNow: z.number().int(),
  daily: z.array(z.object({ channelId: z.string(), limit: z.number().int().nullable(), scheduled: z.number().int(), sent: z.number().int(), isAtLimit: z.boolean() })),
  connected: z.array(z.object({ name: z.string(), service: z.string(), isLocked: z.boolean() })).optional(),
});
export type BufferLimits = z.infer<typeof BufferLimitsSchema>;

/** Аккаунты, подключённые напрямую (без Buffer). */
export const DirectAccountsSchema = z.object({
  items: z.array(ChannelSchema.extend({ replaces: z.string().nullable() })),
  meta: z.object({ configured: z.boolean() }),
  telegram: z.object({ configured: z.boolean(), bot: z.string().nullable().optional() }).optional(),
  instagram: z.object({ configured: z.boolean() }).optional(),
});
export type DirectAccounts = z.infer<typeof DirectAccountsSchema>;
