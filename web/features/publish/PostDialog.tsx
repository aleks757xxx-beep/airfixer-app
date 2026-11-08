import { useState } from "react";
import type { BufferPost, Channel } from "../../../shared/schemas";
import { useDeletePost, useEditPostText, useMovePost, useRetryPost, useShareNow } from "../../api/publish";
import { useMediaList } from "../../api/media";
import { ComposeDialog } from "./ComposeDialog";
import { TEXT_LIMITS } from "../../../shared/schemas";
import { dayKey, formatWhen, fromTb, timeKey } from "../../lib/time";
import { ServiceBadge, channelLabel } from "./channels";

const STATUS_LABEL: Readonly<Record<BufferPost["status"], string>> = {
  scheduled: "Запланирован",
  sent: "Опубликован",
  error: "Ошибка",
  draft: "Черновик",
  sending: "Отправляется…",
  needs_approval: "Ждёт одобрения",
};

/** Карточка поста: текст, ролик, перенос, «сейчас», удаление. */
export function PostDialog({ post, channel, onClose }: { post: BufferPost; channel: Channel | undefined; onClose: () => void }) {
  const move = useMovePost();
  const now = useShareNow();
  const del = useDeletePost();
  const editText = useEditPostText();
  const retry = useRetryPost();
  const library = useMediaList();
  const [dup, setDup] = useState(false);
  const media = post.mediaId ? library.data?.items.find((m) => m.id === post.mediaId) : undefined;
  const [text, setText] = useState(post.text);
  const [editingText, setEditingText] = useState(false);
  const [date, setDate] = useState(post.dueAt ? dayKey(post.dueAt) : dayKey(Date.now() + 86_400_000));
  const [time, setTime] = useState(post.dueAt ? timeKey(post.dueAt) : "19:00");
  const editable = post.status === "scheduled" || post.status === "draft" || post.status === "error";
  const err = move.error ?? now.error ?? del.error ?? editText.error ?? retry.error;
  const busy = move.isPending || now.isPending || del.isPending || editText.isPending || retry.isPending;
  const target = fromTb(date, time);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 md:items-center" role="dialog" aria-modal="true" aria-label="Пост">
      <div className="max-h-[100dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-surface-container p-4 md:max-h-[92vh] md:rounded-m3xl">
        <header className="flex items-center gap-2">
          <ServiceBadge service={post.service} size="md" />
          <div className="min-w-0">
            <p className="font-bold">{channel ? channelLabel(channel) : post.service}</p>
            <p className="text-xs text-on-surface-variant">
              {STATUS_LABEL[post.status]}
              {post.status === "sent" && post.sentAt ? ` · ${formatWhen(post.sentAt)}` : post.dueAt ? ` · ${formatWhen(post.dueAt)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1 text-on-surface-variant hover:bg-surface-container-highest" aria-label="Закрыть">
            ✕
          </button>
        </header>

        {post.error ? <p className="rounded-lg bg-error-container p-2 text-sm text-error">⚠️ {post.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {post.status === "error" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => retry.mutate(post.id, { onSuccess: onClose })}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40"
            >
              {retry.isPending ? "Ставлю…" : "↻ Повторить (в очередь)"}
            </button>
          ) : null}
          {media ? (
            <button type="button" onClick={() => setDup(true)} className="rounded-full bg-surface-container-highest px-4 py-1.5 text-sm font-bold">
              ⧉ Дублировать
            </button>
          ) : null}
        </div>
        {post.mediaUrl ? <video src={post.mediaUrl} controls playsInline preload="metadata" className="max-h-[45vh] w-full rounded-xl bg-black" /> : null}
        {editingText ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface focus:border-primary focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy || text.length > (TEXT_LIMITS[post.service] ?? 5000)}
                onClick={() => editText.mutate({ id: post.id, text }, { onSuccess: () => setEditingText(false) })}
                className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40"
              >
                {editText.isPending ? "Сохраняю…" : "Сохранить подпись"}
              </button>
              <button type="button" onClick={() => setEditingText(false)} className="text-sm text-on-surface-variant">
                Отмена
              </button>
              <span className="ml-auto text-xs text-on-surface-variant">
                {text.length} / {TEXT_LIMITS[post.service] ?? 5000}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="whitespace-pre-wrap text-sm">{(editText.data?.post.text ?? post.text) || <span className="text-warning">Без подписи</span>}</p>
            {editable ? (
              <button type="button" onClick={() => setEditingText(true)} className="text-sm font-semibold text-primary">
                ✎ {post.text ? "Изменить подпись" : "Добавить подпись"}
              </button>
            ) : null}
          </div>
        )}
        {post.externalLink ? (
          <a href={post.externalLink} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-primary">
            Открыть в соцсети ↗
          </a>
        ) : null}

        {editable ? (
          <div className="space-y-2 border-t border-outline-variant pt-3">
            <p className="text-sm font-semibold">Перенести</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2 text-sm text-on-surface"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-32 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 text-sm text-on-surface"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || target === null || target <= Date.now()}
                onClick={() => target && move.mutate({ id: post.id, dueAt: target }, { onSuccess: onClose })}
                className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40"
              >
                Перенести
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => window.confirm("Опубликовать этот пост прямо сейчас?") && now.mutate(post.id, { onSuccess: onClose })}
                className="rounded-full bg-surface-container-highest px-4 py-1.5 text-sm font-bold"
              >
                Опубликовать сейчас
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => window.confirm("Удалить пост из Buffer? Ролик в библиотеке останется.") && del.mutate(post.id, { onSuccess: onClose })}
                className="ml-auto text-sm font-semibold text-error"
              >
                Удалить
              </button>
            </div>
          </div>
        ) : null}
        {err ? <p className="text-sm text-error">{err.message}</p> : null}
      </div>
      {dup && media ? (
        <ComposeDialog
          media={media}
          preset={{ text: editText.data?.post.text ?? post.text }}
          onClose={() => {
            setDup(false);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
