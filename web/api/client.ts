import type { z } from "zod";
import { ApiErrorSchema } from "../../shared/schemas";

/** Ошибка API с понятным текстом для человека. */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Запрос к /api/v2 с проверкой ответа по Zod-схеме. */
export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`/api/v2${path}`, { credentials: "same-origin" });
  } catch {
    throw new ApiRequestError("Нет связи с сервером. Проверьте интернет.", 0);
  }
  const data: unknown = await res.json().catch(() => null);
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const err = ApiErrorSchema.safeParse(data);
  throw new ApiRequestError(err.success ? err.data.error : `Ошибка сервера (${res.status})`, res.status);
}
