import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_UPLOAD_BYTES, type MediaItem } from "../../../shared/schemas";
import { mediaKey, uploadVideo, useDeleteMedia, useMediaList } from "../../api/media";
import { Card, Skeleton } from "../../components/ui/Card";
import { formatBytes, formatDate, plural } from "../../lib/format";

interface UploadJob {
  id: string;
  name: string;
  progress: number;
  error: string | null;
  done: boolean;
  duplicate: boolean;
}

function MediaCard({ item, onDelete, deleting }: { item: MediaItem; onDelete: () => void; deleting: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-ink-card">
      <a href={item.url} target="_blank" rel="noreferrer" className="block bg-black">
        <video src={`${item.url}#t=1`} preload="metadata" muted playsInline className="aspect-[9/16] w-full object-cover" />
      </a>
      <div className="p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug" title={item.name}>
          {item.name}
        </p>
        <p className="mt-1 text-xs text-white/55">
          {formatBytes(item.size)} · {formatDate(item.createdAt)} · {item.source === "gotovoe" ? "«Готовое»" : "загружено"}
        </p>
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="mt-2 text-xs font-semibold text-red-400 disabled:opacity-50"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

export function LibraryPage() {
  const list = useMediaList();
  const del = useDeleteMedia();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const patch = (id: string, p: Partial<UploadJob>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  async function startUploads(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      setJobs((js) => [{ id, name: file.name, progress: 0, error: null, done: false, duplicate: false }, ...js]);
      if (file.size > MAX_UPLOAD_BYTES) {
        patch(id, { error: "больше 95 МБ — сожмите ролик" });
        continue;
      }
      try {
        const r = await uploadVideo(file, (f) => patch(id, { progress: f }));
        patch(id, { done: true, progress: 1, duplicate: r.duplicate });
        void qc.invalidateQueries({ queryKey: mediaKey });
      } catch (e: unknown) {
        patch(id, { error: e instanceof Error ? e.message : "ошибка" });
      }
    }
  }

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-bold">Библиотека</h2>
            <p className="text-sm text-white/55">
              {list.data
                ? `${items.length} ${plural(items.length, "ролик", "ролика", "роликов")} · ${formatBytes(list.data.totalBytes)} из ${formatBytes(list.data.limitBytes)}`
                : "Ролики из папки «Готовое» и загруженные вручную"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="ml-auto rounded-full bg-tg px-5 py-2.5 font-bold text-white"
          >
            + Загрузить
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
            multiple
            hidden
            onChange={(e) => {
              void startUploads(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {jobs.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="text-sm">
                <div className="flex gap-2">
                  <span className="truncate">{j.name}</span>
                  <span className={`ml-auto shrink-0 ${j.error ? "text-red-400" : j.done ? "text-wa" : "text-white/55"}`}>
                    {j.error ?? (j.done ? (j.duplicate ? "уже в библиотеке" : "готово ✓") : `${Math.round(j.progress * 100)}%`)}
                  </span>
                </div>
                {!j.done && !j.error ? (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-brand transition-[width]" style={{ width: `${j.progress * 100}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {del.isError ? <p className="font-semibold text-red-400">{del.error.message}</p> : null}

      {list.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16]" />
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <p className="text-red-400">{list.error.message}</p>
          <button type="button" className="mt-2 text-sm text-brand-light underline" onClick={() => void list.refetch()}>
            Повторить
          </button>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-white/60">
            Пока пусто. Нажмите «+ Загрузить» и выберите ролик (на iPhone: «Файлы» → iCloud Drive → ALEXFIXER → Готовое), или
            включите автозагрузку с Mac.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((it) => (
            <MediaCard
              key={it.id}
              item={it}
              deleting={del.isPending && del.variables === it.id}
              onDelete={() => {
                if (window.confirm(`Удалить «${it.name}» из библиотеки?`)) del.mutate(it.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
