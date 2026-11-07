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
  secrets: z.object({
    appPassword: z.boolean(),
    bufferApiKey: z.boolean(),
    uploadToken: z.boolean(),
  }),
});
export type Health = z.infer<typeof HealthSchema>;

export const ApiErrorSchema = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;
