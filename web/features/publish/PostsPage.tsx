import { useMemo, useState } from "react";
import type { BufferPost } from "../../../shared/schemas";
import { useChannels, usePosts } from "../../api/publish";
import { Card, Skeleton } from "../../components/ui/Card";
import { DAY_MS, dayKey, formatDay, timeKey } from "../../lib/time";
import { ServiceBadge, channelLabel } from "./channels";
import { PostDialog } from "./PostDialog";

type Tab = "queue" | "sent" | "error" | "draft";
const TABS: ReadonlyArray<{ tab: Tab; label: string }> = [
  { tab: "queue", label: "Очередь" },
  { tab: "sent", label: "Опубликовано" },
  { tab: "error", label: "Ошибки" },
  { tab: "draft", label: "Черновики" },
];

/** Посты списком (как вкладка Queue/Sent в Buffer): месяц назад и месяц вперёд. */
export function PostsPage() {
  const [range] = useState(() => {
    const now = Date.now();
    return { from: now - 30 * DAY_MS, to: now + 31 * DAY_MS };
  });
  const posts = usePosts(range.from, range.to);
  const channels = useChannels();
  const [tab, setTab] = useState<Tab>("queue");
  const [open, setOpen] = useState<BufferPost | null>(null);
  const chanById = useMemo(() => new Map((channels.data?.items ?? []).map((c) => [c.id, c])), [channels.data]);

  const all = posts.data?.items ?? [];
  const lists: Record<Tab, BufferPost[]> = {
    queue: all.filter((p) => p.status === "scheduled" || p.status === "sending" || p.status === "needs_approval"),
    sent: [...all.filter((p) => p.status === "sent")].reverse(),
    error: all.filter((p) => p.status === "error"),
    draft: [...all.filter((p) => p.status === "draft"), ...(posts.data?.drafts ?? [])],
  };
  const list = lists[tab];
  const groups = new Map<string, BufferPost[]>();
  for (const p of list) {
    const k = p.dueAt ? dayKey(p.dueAt) : "—";
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              aria-pressed={tab === t.tab}
              onClick={() => setTab(t.tab)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tab === t.tab ? "bg-brand text-white" : "bg-white/10 text-white/70"}`}
            >
              {t.label} {posts.data ? `(${lists[t.tab].length})` : ""}
            </button>
          ))}
        </div>
        {posts.isError ? <p className="mt-2 text-sm text-red-400">{posts.error.message}</p> : null}
      </Card>
      {posts.isPending ? (
        <Skeleton className="h-40" />
      ) : list.length === 0 ? (
        <Card>
          <p className="text-white/55">Пусто. Новый пост — кнопка «📅 Запланировать» у ролика в «Библиотеке» или «+ Пост» в «Календаре».</p>
        </Card>
      ) : (
        [...groups.entries()].map(([k, ps]) => (
          <section key={k} className="space-y-2">
            <h3 className="px-1 text-sm font-bold text-white/60">{k === "—" ? "Без даты" : formatDay(ps[0]?.dueAt ?? 0)}</h3>
            {ps.map((p) => {
              const c = chanById.get(p.channelId);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpen(p)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left ${p.status === "error" ? "border-red-500/50 bg-red-500/10" : "border-white/10 bg-ink-card"}`}
                >
                  {p.mediaUrl ? (
                    <video src={`${p.mediaUrl}#t=1`} muted preload="metadata" className="h-16 w-10 shrink-0 rounded-lg bg-black object-cover" />
                  ) : (
                    <span className="flex h-16 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">🎬</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <ServiceBadge service={p.service} />
                      {c ? channelLabel(c) : p.service}
                      <span className="ml-auto text-xs font-normal text-white/50">{p.dueAt ? timeKey(p.dueAt) : ""}</span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-white/75">{p.text || "без подписи"}</span>
                    {p.error ? <span className="mt-1 block text-xs text-red-300">⚠️ {p.error}</span> : null}
                  </span>
                </button>
              );
            })}
          </section>
        ))
      )}
      {open ? <PostDialog post={open} channel={chanById.get(open.channelId)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
