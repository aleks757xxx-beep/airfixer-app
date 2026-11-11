import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_UPLOAD_BYTES, NOTE_MAX, type MediaItem } from "../../../shared/schemas";
import { mediaKey, uploadVideo, useDeleteMedia, useMediaList, useSaveNote, useSetRepost, useTrashAction, useTrashList } from "../../api/media";
import { Card, Skeleton } from "../../components/ui/Card";
import { formatBytes, formatDate, plural } from "../../lib/format";
import { AskClaudeButton } from "../claude/askClaude";
import { OrderForm } from "../orders/OrderForm";
import { OrdersList } from "../orders/OrdersList";
import { ComposeDialog } from "../publish/ComposeDialog";
import { VideoWorkspace } from "../review/VideoWorkspace";
import { Reposts } from "./Reposts";

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

/** Галочка «можно повторять» (не все ролики можно выкладывать повторно — решает владелец). */
function RepostToggle({ item }: { item: MediaItem }) {
  const set = useSetRepost();
  const on = set.isPending ? set.variables.on : item.repostable === true;
  return (
    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={on}
        disabled={set.isPending}
        onChange={(e) => set.mutate({ id: item.id, on: e.target.checked })}
        className="h-4 w-4 accent-[var(--color-primary)]"
      />
      <span>Можно повторять</span>
      {set.isError ? <span className="text-error">не сохранилось</span> : null}
    </label>
  );
}

function MediaCard({ item, onDelete, deleting }: { item: MediaItem; onDelete: () => void; deleting: boolean }) {
  const [composing, setComposing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  return (
    <div className="overflow-hidden rounded-m3m border border-outline-variant bg-surface-container">
      <a href={item.url} target="_blank" rel="noreferrer" className="block bg-black">
        <video src={`${item.url}#t=1`} preload="metadata" muted playsInline className="aspect-[9/16] w-full object-cover" />
      </a>
      <div className="p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug" title={item.name}>
          {item.number && !item.name.startsWith(`${item.number} `) ? <span className="mr-1 text-primary">№{item.number}</span> : null}
          {item.name}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          {formatBytes(item.size)} · {formatDate(item.createdAt)} · {item.source === "gotovoe" ? "«Готовое»" : "загружено"}
          {item.tgSize ? ` · копия для Telegram ${formatBytes(item.tgSize)}` : ""}
        </p>
        <button type="button" onClick={() => setReviewing(true)} className="mt-2 w-full rounded-full bg-primary py-2.5 text-sm font-bold text-on-primary">
          🎬 Работа с видео
          {item.reviewDrafts ? ` · ${item.reviewDrafts} черн.` : ""}
          {item.reviewOpen ? " · ⏳" : ""}
        </button>
        {reviewing ? <VideoWorkspace media={item} onClose={() => setReviewing(false)} /> : null}
        <button type="button" onClick={() => setComposing(true)} className="mt-2 w-full rounded-full bg-secondary-container py-2 text-sm font-bold text-on-secondary-container">
          📅 Запланировать
        </button>
        {composing ? <ComposeDialog media={item} onClose={() => setComposing(false)} /> : null}
        <RepostToggle item={item} />
        <NoteBlock item={item} />
        <AskClaudeButton item={item} className="mt-2 block text-xs font-semibold text-primary" />
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="mt-2 block text-xs font-semibold text-error disabled:opacity-50"
        >
          🗑 В корзину
        </button>
      </div>
    </div>
  );
}

/** Корзина (решение владельца 11.11.2026): старые версии и выброшенное вручную; через 14 дней — насовсем. */
function Trash() {
  const q = useTrashList();
  const act = useTrashAction();
  const del = useDeleteMedia();
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  const days = q.data?.days ?? 14;
  return (
    <Card>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="text-lg font-bold">🗑 Корзина · {items.length}</span>
        <span className="flex-1 text-xs text-on-surface-variant">удаляется насовсем через {days} дней</span>
        <span className="text-on-surface-variant">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <ul className="mt-2 divide-y divide-outline-variant">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 py-2">
              <video src={`${it.url}#t=1`} preload="metadata" muted playsInline className="h-16 w-9 shrink-0 rounded bg-black object-cover" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold">{it.name}</p>
                <p className="text-xs text-on-surface-variant">
                  {it.trashReason === "old_version" ? "старая версия — новую поставили в публикацию" : "в корзину вручную"}
                  {it.trashedAt ? ` · удалится ${formatDate(it.trashedAt + days * 86_400_000)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: it.id, action: "restore" })} className="text-xs font-semibold text-primary">
                  ↩ Вернуть
                </button>
                <button
                  type="button"
                  disabled={del.isPending}
                  onClick={() => {
                    if (window.confirm(`Удалить «${it.name}» насовсем?\n\nИз приложения — сразу, из папки «Готовое» — Claude сотрёт при следующей работе. Вернуть будет нельзя.`)) del.mutate(it.id);
                  }}
                  className="text-xs font-semibold text-error"
                >
                  Удалить сейчас
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {act.error ?? del.error ? <p className="mt-2 text-sm text-error">{(act.error ?? del.error)?.message}</p> : null}
    </Card>
  );
}

export function LibraryPage() {
  const list = useMediaList();
  const trash = useTrashAction();
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
  const pending = items.filter((i) => i.noteStatus === "new" || (i.reviewOpen ?? 0) > 0).length;

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

      <Reposts />

      {trash.isError ? <p className="font-semibold text-error">{trash.error.message}</p> : null}

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
            Пока пусто. Нажмите «+ Загрузить» и выберите ролик (на iPhone: «Файлы» → iCloud Drive → SMM → Готовое), или
            включите автозагрузку с Mac.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((it) => (
            <MediaCard
              key={it.id}
              item={it}
              deleting={trash.isPending && trash.variables.id === it.id}
              onDelete={() => trash.mutate({ id: it.id, action: "trash" })}
            />
          ))}
        </div>
      )}
      <Trash />
    </div>
  );
}
