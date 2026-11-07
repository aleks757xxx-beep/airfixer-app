import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiErrorSchema,
  MediaListSchema,
  OkSchema,
  UploadPartSchema,
  UploadResultSchema,
  UploadStartSchema,
  type MediaList,
  type UploadPart,
  type UploadResult,
} from "../../shared/schemas";
import { apiGet, ApiRequestError } from "./client";

export const mediaKey = ["media"] as const;

export function useMediaList() {
  return useQuery<MediaList>({ queryKey: mediaKey, queryFn: () => apiGet("/media", MediaListSchema), staleTime: 15_000 });
}

function errorFrom(status: number, data: unknown, fallback: string): ApiRequestError {
  const err = ApiErrorSchema.safeParse(data);
  return new ApiRequestError(err.success ? err.data.error : `${fallback} (${status})`, status);
}

async function postJson<T>(url: string, body: unknown, schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false } }): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const ok = schema.safeParse(data);
    if (ok.success) return ok.data;
  }
  throw errorFrom(res.status, data, "Ошибка загрузки");
}

/** Одна часть через XHR (у fetch нет прогресса отправки). */
function sendPart(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<UploadPart> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        /* не JSON */
      }
      if (x.status >= 200 && x.status < 300) {
        const ok = UploadPartSchema.safeParse(data);
        if (ok.success) return resolve(ok.data);
      }
      reject(errorFrom(x.status, data, "Ошибка загрузки части"));
    };
    x.onerror = () => reject(new ApiRequestError("Нет связи с сервером", 0));
    x.send(blob);
  });
}

/**
 * Загрузка ролика частями по 50 МБ (так проходят файлы больше 100 МБ, до 5 ГБ).
 * Часть, упавшая из-за связи, повторяется до 3 раз.
 */
export async function uploadVideo(file: File, onProgress: (fraction: number) => void): Promise<UploadResult> {
  const begin = await postJson("/api/v2/media/uploads", { name: file.name, size: file.size }, UploadStartSchema);
  if (begin.duplicate) return { item: begin.item, duplicate: true };

  const base = `/api/v2/media/uploads/${encodeURIComponent(begin.uploadId)}`;
  const parts: UploadPart[] = [];
  let doneBytes = 0;
  for (let n = 1; n <= begin.parts; n++) {
    const blob = file.slice((n - 1) * begin.partSize, Math.min(n * begin.partSize, file.size));
    for (let attempt = 1; ; attempt++) {
      try {
        parts.push(await sendPart(`${base}/parts/${n}`, blob, (loaded) => onProgress((doneBytes + loaded) / file.size)));
        break;
      } catch (e: unknown) {
        const retriable = e instanceof ApiRequestError && (e.status === 0 || e.status >= 500);
        if (!retriable || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    doneBytes += blob.size;
    onProgress(doneBytes / file.size);
  }
  return postJson(`${base}/complete`, { parts }, UploadResultSchema);
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v2/media/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok && OkSchema.safeParse(data).success) return;
      const err = ApiErrorSchema.safeParse(data);
      throw new ApiRequestError(err.success ? err.data.error : `Ошибка (${res.status})`, res.status);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mediaKey }),
  });
}
