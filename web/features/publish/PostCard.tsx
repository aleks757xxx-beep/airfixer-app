import { useState } from "react";
import type { BufferPost, Channel } from "../../../shared/schemas";
import { timeKey } from "../../lib/time";
import { serviceInfo } from "./channels";

export const DRAG_POST = "application/x-postfixer-post";
export const DRAG_MEDIA = "application/x-postfixer-media";

/** Квадратный значок соцсети, как в Buffer. */
export function ServiceSquare({ service }: { service: string }) {
  const i = serviceInfo(service);
  return (
    <span aria-label={i.label} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black text-white ${i.cls}`}>
      {i.short}
    </span>
  );
}

/** Тип поста: Reels (IG/FB) или Shorts (YouTube). */
function TypeIcon({ service }: { service: string }) {
  if (service === "youtube") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white/70" aria-label="Shorts" fill="currentColor">
        <path d="M14.5 2.6a4 4 0 0 1 3.9 6.9l-1.3.8a4 4 0 0 1 .6 7.3l-6.2 3.6a4 4 0 0 1-3.9-6.9l1.3-.8a4 4 0 0 1-.6-7.3zM10 9v6l5-3z" />
      </svg>
    );
  }
  if (service === "instagram" || service === "facebook" || service === "tiktok" || service === "telegram") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white/70" aria-label="Ролик" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 9h18M8 4l3 5M14 4l3 5" />
        <path d="M10 12.5v4l3.5-2z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return null;
}

/** Превью: картинка Buffer, иначе кадр нашего ролика. */
export function Thumb({ post, className = "h-10 w-10" }: { post: BufferPost; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`relative shrink-0 overflow-hidden rounded-lg bg-black ${className}`}>
      {post.thumbnail && !broken ? (
        <img src={post.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : post.mediaUrl ? (
        <video src={`${post.mediaUrl}#t=1`} muted preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm">🎬</span>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[8px] text-white">▶</span>
      </span>
    </span>
  );
}

const tone: Readonly<Record<BufferPost["status"], string>> = {
  scheduled: "border-white/10 bg-[#24232e] hover:border-white/25",
  sending: "border-brand/50 bg-[#24232e]",
  sent: "border-white/5 bg-[#1d1c26] hover:border-white/20",
  error: "border-[#8a3b30] bg-[#5a2a24] hover:border-[#c2584a]",
  draft: "border-dashed border-white/25 bg-transparent",
  needs_approval: "border-amber-400/50 bg-[#24232e]",
};

/** Карточка поста в календаре — значок сети, тип, время, превью. */
export function PostCard({ post, channel, onOpen }: { post: BufferPost; channel: Channel | undefined; onOpen: () => void }) {
  const draggable = post.status === "scheduled" || post.status === "draft";
  const noText = !post.text.trim() && post.status !== "sent";
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData(DRAG_POST, post.id)}
      onClick={onOpen}
      title={`${channel?.displayName || channel?.name || post.service}${post.text ? ` — ${post.text.slice(0, 80)}` : ""}`}
      className={`flex w-full items-center gap-2 rounded-xl border p-1.5 text-left transition-colors ${tone[post.status]} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <ServiceSquare service={post.service} />
          <TypeIcon service={post.service} />
        </span>
        <span className="mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums">
          {post.dueAt ? timeKey(post.dueAt) : "—"}
          {post.status === "error" ? <span title={post.error ?? "Ошибка"}>⚠️</span> : null}
          {post.status === "sent" ? <span className="text-xs text-wa">✓</span> : null}
          {noText ? (
            <span className="text-xs text-amber-300" title="Без подписи">
              ✎
            </span>
          ) : null}
        </span>
      </span>
      <Thumb post={post} />
    </button>
  );
}
