import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_UPLOAD_BYTES, NOTE_MAX, type MediaItem } from "../../../shared/schemas";
import { mediaKey, uploadVideo, useDeleteMedia, useMediaList, useSaveNote } from "../../api/media";
import { Card, Skeleton } from "../../components/ui/Card";
import { formatBytes, formatDate, plural } from "../../lib/format";
import { AskClaudeButton } from "../claude/askClaude";
import { OrderForm } from "../orders/OrderForm";
import { OrdersList } from "../orders/OrdersList";
import { ComposeDialog } from "../publish/ComposeDialog";

interface UploadJob {
  id: string;
  name: string;
  progress: number;
  error: string | null;
  done: boolean;
  duplicate: boolean;
}

/** Задание для Claude у ролика: текст, статус и ответ. */
function NoteBlock({ item }: { item: MediaItem }) {
  const save = useSaveNote();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.note ?? "");

  if (editing) {
    return (
      <form
        className="mt-2 space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ id: item.id, note: text }, { onSuccess: () => setEditing(false) });
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={NOTE_MAX}
          rows={4}
          autoFocus
          placeholder="Например: подпись для Инсты и ТикТока, выложить в пятницу вечером"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
        />
        {save.isError ? <p className="text-xs text-error">{save.error.message}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={save.isPending} className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary disabled:opacity-50">
            {save.isPending ? "Сохраняю…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => {
              setText(item.note ?? "");
              setEditing(false);
            }}
            className="text-xs text-on-surface-variant"
          >
            Отмена
          </button>
        </div>
      </form>
    );
  }

  if (!item.note) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="mt-2 text-xs font-semibold text-primary">
        ✎ Задание для Claude
      </button>
    );
  }

  const done = item.noteStatus === "done";
  return (
    <div className="mt-2 space-y-1.5 rounded-lg bg-surface-container-high p-2 text-xs">
      <p className={done ? "font-semibold text-success" : "font-semibold text-warning"}>
        {done ? "✓ Claude выполнил" : "⏳ Ждёт Claude"}
      </p>
      <p className="whitespace-pre-wrap text-on-surface">{item.note}</p>
      {item.noteReply ? <p className="whitespace-pre-wrap border-t border-outline-variant pt-1.5 text-on-surface-variant">Claude: {item.noteReply}</p> : null}
      <button
        type="button"
        onClick={() => {
          setText(done ? "" : item.note ?? "");
          setEditing(true);
        }}
        className="font-semibold text-primary"
      >
        {done ? "✎ Новое задание" : "✎ Изменить"}
      </button>
    </div>
  );
}

function MediaCard({ item, onDelete, deleting }: { item: MediaItem; onDelete: () => void; deleting: boolean }) {
  const [composing, setComposing] = useState(false);
  return (
    <div className="overflow-hidden rounded-m3m border border-outline-variant bg-surface-container">
      <a href={item.url} target="_blank" rel="noreferrer" className="block bg-black">
        <video src={`${item.url}#t=1`} preload="metadata" muted playsInline className="aspect-[9/16] w-full object-cover" />
      </a>
      <div className="p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug" title={item.name}>
          {item.name}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          {formatBytes(item.size)} · {formatDate(item.createdAt)} · {item.source === "gotovoe" ? "«Готовое»" : "загружено"}
          {item.tgSize ? ` · копия для Telegram ${formatBytes(item.tgSize)}` : ""}
        </p>
        <button type="button" onClick={() => setComposing(true)} className="mt-2 w-full rounded-full bg-primary py-1.5 text-xs font-bold text-on-primary">
          📅 Запланировать
        </button>
        {composing ? <ComposeDialog media={item} onClose={() => setComposing(false)} /> : null}
        <NoteBlock item={item} />
        <AskClaudeButton item={item} className="mt-2 block text-xs font-semibold text-primary" />
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="mt-2 block text-xs font-semibold text-error disabled:opacity-50"
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
  const [ordering, setOrdering] = useState(false);

  const patch = (id: string, p: Partial<UploadJob>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  async function startUploads(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      setJobs((js) => [{ id, name: file.name, progress: 0, error: null, done: false, duplicate: false }, ...js]);
      if (file.size > MAX_UPLOAD_BYTES) {
        patch(id, { error: "больше 5 ГБ — сожмите ролик" });
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
  const pending = items.filter((i) => i.noteStatus === "new").length;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-bold">Библиотека</h2>
            <p className="text-sm text-on-surface-variant">
              {list.data
                ? `${items.length} ${plural(items.length, "ролик", "ролика", "роликов")} · ${formatBytes(list.data.totalBytes)} из ${formatBytes(list.data.limitBytes)}`
                : "Ролики из папки «Готовое» и загруженные вручную"}
            </p>
            {pending > 0 ? (
              <p className="mt-1 text-sm font-semibold text-warning">
                ⏳ {pending} {plural(pending, "задание ждёт", "задания ждут", "заданий ждут")} Claude — нажмите «💬 Claude» и напишите «посмотри задания»
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setOrdering(true)} className="rounded-full bg-primary px-4 py-2.5 font-bold text-on-primary">
              + Заказать монтаж
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} className="rounded-full bg-tg px-4 py-2.5 font-bold text-white">
              + Загрузить
            </button>
          </div>
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

        {ordering ? <OrderForm onDone={() => setOrdering(false)} /> : null}

        {jobs.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="text-sm">
                <div className="flex gap-2">
                  <span className="truncate">{j.name}</span>
                  <span className={`ml-auto shrink-0 ${j.error ? "text-error" : j.done ? "text-success" : "text-on-surface-variant"}`}>
                    {j.error ?? (j.done ? (j.duplicate ? "уже в библиотеке" : "готово ✓") : `${Math.round(j.progress * 100)}%`)}
                  </span>
                </div>
                {!j.done && !j.error ? (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${j.progress * 100}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <OrdersList />

      {del.isError ? <p className="font-semibold text-error">{del.error.message}</p> : null}

      {list.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16]" />
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <p className="text-error">{list.error.message}</p>
          <button type="button" className="mt-2 text-sm text-primary underline" onClick={() => void list.refetch()}>
            Повторить
          </button>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-on-surface-variant">
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
                if (
                  window.confirm(
                    it.source === "gotovoe"
                      ? `Удалить «${it.name}» насовсем?\n\nИз библиотеки — сразу, из папки «Готовое» — Claude сотрёт при следующей работе.`
                      : `Удалить «${it.name}» из библиотеки?`,
                  )
                )
                  del.mutate(it.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
