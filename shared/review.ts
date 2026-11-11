import { z } from "zod";
import { MediaItemSchema } from "./schemas";

/**
 * «Работа с видео» (решение владельца 11.11.2026): заметки к ролику (точка или отрезок, тип),
 * настройки звука (по умолчанию и для ролика) и переписка с Claude по раундам правок.
 */

export const REVIEW_KINDS = ["cut", "frame", "subtitle", "sound", "circle", "other"] as const;
export const ReviewKindSchema = z.enum(REVIEW_KINDS);
export type ReviewKind = z.infer<typeof ReviewKindSchema>;
export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  cut: "✂️ Убрать",
  frame: "🎞 Кадр",
  subtitle: "💬 Субтитр",
  sound: "🔊 Звук",
  circle: "⭕ Кружочек",
  other: "✏️ Другое",
};

export const REVIEW_TEXT_MAX = 4000;
const time = z.number().min(0).max(36_000);

export const ReviewNoteInputSchema = z
  .object({
    kind: ReviewKindSchema,
    tFrom: time.nullable(),
    tTo: time.nullable(),
    text: z.string().trim().min(1, "Напишите, что поправить").max(REVIEW_TEXT_MAX, `До ${REVIEW_TEXT_MAX} знаков`),
  })
  .refine((n) => n.tTo === null || (n.tFrom !== null && n.tTo > n.tFrom), { message: "Конец отрезка должен быть позже начала" });
export type ReviewNoteInput = z.infer<typeof ReviewNoteInputSchema>;

export const ReviewNoteStatusSchema = z.enum(["draft", "sent", "done", "wontdo"]);
export type ReviewNoteStatus = z.infer<typeof ReviewNoteStatusSchema>;
export const ReviewNoteSchema = z.object({
  id: z.string(),
  kind: ReviewKindSchema,
  tFrom: z.number().nullable(),
  tTo: z.number().nullable(),
  text: z.string(),
  status: ReviewNoteStatusSchema,
  reply: z.string().nullable(),
  roundId: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type ReviewNote = z.infer<typeof ReviewNoteSchema>;
export const ReviewNoteResultSchema = z.object({ note: ReviewNoteSchema });

/** Звук: понятные уровни вместо децибел. Громкость/бас −2…+2, гнусавость/шум/паузы 0…2, музыка −3 (без) … +2. */
const lvl = z.number().int().min(-2).max(2);
const lvl0 = z.number().int().min(0).max(2);
export const VoiceSettingsSchema = z.object({
  volume: lvl,
  bass: lvl,
  nasal: lvl0,
  noise: lvl0,
  pauses: lvl0,
  music: z.number().int().min(-3).max(2),
  comment: z.string().trim().max(1000).optional(),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;
/** Исходные настройки: так владелец уже решил (бас срезан, гнусавость смягчена, паузы не трогать). */
export const DEFAULT_VOICE: VoiceSettings = { volume: 0, bass: -1, nasal: 1, noise: 0, pauses: 0, music: 0 };
export const VoiceInputSchema = z.object({ voice: VoiceSettingsSchema.nullable() });

export interface VoiceOption {
  value: number;
  label: string;
}
export const VOICE_FIELDS: ReadonlyArray<{ key: Exclude<keyof VoiceSettings, "comment">; label: string; live: boolean; options: VoiceOption[] }> = [
  { key: "volume", label: "Громкость голоса", live: true, options: [{ value: -2, label: "Тише−−" }, { value: -1, label: "Тише" }, { value: 0, label: "Как есть" }, { value: 1, label: "Громче" }, { value: 2, label: "Громче++" }] },
  { key: "bass", label: "Бас (басовитость)", live: true, options: [{ value: -2, label: "Меньше−−" }, { value: -1, label: "Меньше" }, { value: 0, label: "Как есть" }, { value: 1, label: "Больше" }, { value: 2, label: "Больше++" }] },
  { key: "nasal", label: "Гнусавость", live: true, options: [{ value: 0, label: "Не трогать" }, { value: 1, label: "Смягчить" }, { value: 2, label: "Сильнее" }] },
  { key: "noise", label: "Шум и гул", live: false, options: [{ value: 0, label: "Не трогать" }, { value: 1, label: "Убрать немного" }, { value: 2, label: "Убрать сильно" }] },
  { key: "pauses", label: "Паузы в речи", live: false, options: [{ value: 0, label: "Оставить" }, { value: 1, label: "Сократить длинные" }, { value: 2, label: "Убрать" }] },
  { key: "music", label: "Музыка", live: false, options: [{ value: -3, label: "Без музыки" }, { value: -2, label: "Тише−−" }, { value: -1, label: "Тише" }, { value: 0, label: "Как есть" }, { value: 1, label: "Громче" }, { value: 2, label: "Громче++" }] },
];

/**
 * Одна и та же «формула звука» для прослушивания в приложении (Web Audio) и для монтажа (ffmpeg),
 * чтобы владелец слышал то же, что получит.
 */
export interface VoiceChain {
  highpassHz: number | null;
  shelf: { f: number; gain: number } | null;
  peaks: Array<{ f: number; q: number; gain: number }>;
  gainDb: number;
}
export function voiceChain(v: VoiceSettings): VoiceChain {
  const shelfGain: Record<number, number> = { [-2]: -7, [-1]: -5, 0: 0, 1: 3, 2: 6 };
  const peaks: VoiceChain["peaks"] =
    v.nasal === 2
      ? [
          { f: 950, q: 1.0, gain: -6 },
          { f: 450, q: 1.4, gain: -2.5 },
          { f: 3000, q: 1.0, gain: 1.5 },
        ]
      : v.nasal === 1
        ? [
            { f: 1000, q: 1.2, gain: -3.5 },
            { f: 450, q: 1.4, gain: -1.5 },
          ]
        : [];
  return {
    highpassHz: v.bass === -2 ? 120 : v.bass === -1 ? 110 : null,
    shelf: v.bass === 0 ? null : { f: 220, gain: shelfGain[v.bass] ?? 0 },
    peaks,
    gainDb: v.volume * 3,
  };
}
/** Для Claude: фильтр ffmpeg голоса (громкость к норме соцсетей Claude доводит отдельно, простым усилением). */
export function voiceFfmpeg(v: VoiceSettings): string {
  const c = voiceChain(v);
  const parts: string[] = [];
  if (c.highpassHz) parts.push(`highpass=f=${c.highpassHz}`);
  if (c.shelf) parts.push(`lowshelf=f=${c.shelf.f}:g=${c.shelf.gain}`);
  for (const p of c.peaks) parts.push(`equalizer=f=${p.f}:t=q:w=${p.q}:g=${p.gain}`);
  if (c.gainDb) parts.push(`volume=${c.gainDb}dB`);
  return parts.join(",") || "anull";
}
export function voiceSummary(v: VoiceSettings): string {
  const parts = VOICE_FIELDS.map((f) => `${f.label}: ${f.options.find((o) => o.value === v[f.key])?.label ?? v[f.key]}`);
  if (v.comment) parts.push(`Комментарий: ${v.comment}`);
  return parts.join(" · ");
}

export const ReviewRoundSchema = z.object({
  id: z.number().int(),
  sentAt: z.number().int(),
  voice: VoiceSettingsSchema.nullable(),
  reply: z.string().nullable(),
  repliedAt: z.number().int().nullable(),
  notes: z.array(ReviewNoteSchema),
});
export type ReviewRound = z.infer<typeof ReviewRoundSchema>;

export const ReviewStateSchema = z.object({
  mediaId: z.string(),
  drafts: z.array(ReviewNoteSchema),
  rounds: z.array(ReviewRoundSchema),
  voice: VoiceSettingsSchema.nullable(),
  voiceDefault: VoiceSettingsSchema,
  /** Можно ли отправить: есть черновики или звук изменился после прошлого раунда */
  canSend: z.boolean(),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export const VoiceDefaultResultSchema = z.object({ voice: VoiceSettingsSchema });
export const SendReviewInputSchema = z.object({ orderId: z.number().int().positive().optional() });

/** Для Claude: открытые раунды. */
export const ReviewQueueSchema = z.object({
  items: z.array(
    z.object({
      media: MediaItemSchema,
      round: ReviewRoundSchema,
      voice: VoiceSettingsSchema,
      voiceFfmpeg: z.string(),
    }),
  ),
});
export const ReviewAnswerInputSchema = z.object({
  reply: z.string().trim().max(REVIEW_TEXT_MAX).optional(),
  notes: z
    .array(z.object({ id: z.string(), status: z.enum(["done", "wontdo"]), reply: z.string().trim().max(REVIEW_TEXT_MAX).optional() }))
    .max(200)
    .default([]),
});
