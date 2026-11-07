import { useState } from "react";
import type { BufferPost, Channel } from "../../../shared/schemas";
import { useDeletePost, useEditPostText, useMovePost, useShareNow } from "../../api/publish";
import { TEXT_LIMITS } from "../../../shared/schemas";
import { dayKey, formatWhen, fromTb, timeKey } from "../../lib/time";
import { ServiceBadge, channelLabel } from "./channels";

export const STATUS_LABEL: Readonly<Record<BufferPost["status"], string>> = {
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
  const [text, setText] = useState(post.text);
  const [editingText, setEditingText] = useState(false);
  const [date, setDate] = useState(post.dueAt ? dayKey(post.dueAt) : dayKey(Date.now() + 86_400_000));
  const [time, setTime] = useState(post.dueAt ? timeKey(post.dueAt) : "19:00");
  const editable = post.status === "scheduled" || post.status === "draft" || post.status === "error";
  const err = move.error ?? now.error ?? del.error ?? editText.error;
  const busy = move.isPending || now.isPending || del.isPending || editText.isPending;
  const target = fromTb(date, time);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 md:items-center" role="dialog" aria-modal="true" aria-label="Пост">
      <div className="max-h-[100dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-ink-card p-4 md:max-h-[92vh] md:rounded-3xl">
        <header className="flex items-center gap-2">
          <ServiceBadge service={post.service} size="md" />
          <div className="min-w-0">
            <p className="font-bold">{channel ? channelLabel(channel) : post.service}</p>
            <p className="text-xs text-white/55">
              {STATUS_LABEL[post.status]}
              {post.status === "sent" && post.sentAt ? ` · ${formatWhen(post.sentAt)}` : post.dueAt ? ` · ${formatWhen(post.dueAt)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1 text-white/60 hover:bg-white/10" aria-label="Закрыть">
            ✕
          </button>
        </header>

        {post.error ? <p className="rounded-lg bg-red-500/15 p-2 text-sm text-red-300">⚠️ {post.error}</p> : null}
        {post.mediaUrl ? <video src={post.mediaUrl} controls playsInline preload="metadata" className="max-h-[45vh] w-full rounded-xl bg-black" /> : null}
        {editingText ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-ink-deep p-2.5 text-sm text-white focus:border-brand focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy || text.length > (TEXT_LIMITS[post.service] ?? 5000)}
                onClick={() => editText.mutate({ id: post.id, text }, { onSuccess: () => setEditingText(false) })}
                className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              >
                {editText.isPending ? "Сохраняю…" : "Сохранить подпись"}
              </button>
              <button type="button" onClick={() => setEditingText(false)} className="text-sm text-white/55">
                Отмена
              </button>
              <span className="ml-auto text-xs text-white/45">
                {text.length} / {TEXT_LIMITS[post.service] ?? 5000}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="whitespace-pre-wrap text-sm">{(editText.data?.post.text ?? post.text) || <span className="text-amber-300">Без подписи</span>}</p>
            {editable ? (
              <button type="button" onClick={() => setEditingText(true)} className="text-sm font-semibold text-brand-light">
                ✎ {post.text ? "Изменить подпись" : "Добавить подпись"}
              </button>
            ) : null}
          </div>
        )}
        {post.externalLink ? (
          <a href={post.externalLink} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-brand-light">
            Открыть в соцсети ↗
          </a>
        ) : null}

        {editable ? (
          <div className="space-y-2 border-t border-white/10 pt-3">
            <p className="text-sm font-semibold">Перенести</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-ink-deep p-2 text-sm text-white"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-32 rounded-lg border border-white/15 bg-ink-deep p-2 text-sm text-white"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || target === null || target <= Date.now()}
                onClick={() => target && move.mutate({ id: post.id, dueAt: target }, { onSuccess: onClose })}
                className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              >
                Перенести
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => window.confirm("Опубликовать этот пост прямо сейчас?") && now.mutate(post.id, { onSuccess: onClose })}
                className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-bold"
              >
                Опубликовать сейчас
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => window.confirm("Удалить пост из Buffer? Ролик в библиотеке останется.") && del.mutate(post.id, { onSuccess: onClose })}
                className="ml-auto text-sm font-semibold text-red-400"
              >
                Удалить
              </button>
            </div>
          </div>
        ) : null}
        {err ? <p className="text-sm text-red-400">{err.message}</p> : null}
      </div>
    </div>
  );
}
