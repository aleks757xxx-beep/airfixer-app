import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaListSchema, OkSchema, UploadResultSchema, ApiErrorSchema, type MediaList, type UploadResult } from "../../shared/schemas";
import { apiGet, ApiRequestError } from "./client";

export const mediaKey = ["media"] as const;

export function useMediaList() {
  return useQuery<MediaList>({ queryKey: mediaKey, queryFn: () => apiGet("/media", MediaListSchema), staleTime: 15_000 });
}

/** Загрузка с прогрессом (fetch прогресс отправки не умеет — поэтому XHR). */
export function uploadVideo(file: File, onProgress: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `/api/v2/media/upload?name=${encodeURIComponent(file.name)}`);
    x.setRequestHeader("Content-Type", file.type || "video/mp4");
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    x.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        /* не JSON */
      }
      if (x.status >= 200 && x.status < 300) {
        const ok = UploadResultSchema.safeParse(data);
        if (ok.success) return resolve(ok.data);
      }
      const err = ApiErrorSchema.safeParse(data);
      reject(new ApiRequestError(err.success ? err.data.error : `Ошибка загрузки (${x.status})`, x.status));
    };
    x.onerror = () => reject(new ApiRequestError("Нет связи с сервером", 0));
    x.send(file);
  });
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
