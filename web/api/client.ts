import type { z } from "zod";
import { ApiErrorSchema } from "../../shared/schemas";

/** Ошибка API с понятным текстом для человека. */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<S extends z.ZodType>(method: "GET" | "POST" | "PUT", path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`/api/v2${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError("Нет связи с сервером. Проверьте интернет.", 0);
  }
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
    throw new ApiRequestError("Сервер ответил неожиданно. Обновите страницу.", res.status);
  }
  const err = ApiErrorSchema.safeParse(data);
  throw new ApiRequestError(err.success ? err.data.error : `Ошибка сервера (${res.status})`, res.status);
}

/** Запросы к /api/v2 с проверкой ответа по Zod-схеме. */
export const apiGet = <S extends z.ZodType>(path: string, schema: S) => request("GET", path, schema);
export const apiPost = <S extends z.ZodType>(path: string, schema: S, body: unknown = {}) => request("POST", path, schema, body);
export const apiPut = <S extends z.ZodType>(path: string, schema: S, body: unknown) => request("PUT", path, schema, body);
