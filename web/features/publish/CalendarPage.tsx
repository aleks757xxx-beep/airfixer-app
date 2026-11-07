import { useMemo, useState, type DragEvent } from "react";
import type { BufferPost, Channel, MediaItem } from "../../../shared/schemas";
import { useMediaList } from "../../api/media";
import { useChannels, useMovePost, usePosts } from "../../api/publish";
import { Card, Skeleton } from "../../components/ui/Card";
import { DAY_MS, dayKey, formatDay, fromTb, tbParts, timeKey, weekStart } from "../../lib/time";
import { ServiceBadge, channelLabel } from "./channels";
import { ComposeDialog } from "./ComposeDialog";
import { PostDialog } from "./PostDialog";

const DRAG_POST = "application/x-postfixer-post";
const DRAG_MEDIA = "application/x-postfixer-media";
const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const statusCls: Readonly<Record<BufferPost["status"], string>> = {
  scheduled: "border-white/10 bg-ink-deep",
  sending: "border-brand/50 bg-ink-deep",
  sent: "border-white/5 bg-white/5 opacity-70",
  error: "border-red-500/60 bg-red-500/10",
  draft: "border-dashed border-white/25 bg-transparent",
  needs_approval: "border-amber-400/50 bg-ink-deep",
};

function PostChip({ p, channel, onOpen }: { p: BufferPost; channel: Channel | undefined; onOpen: () => void }) {
  const draggable = p.status === "scheduled" || p.status === "draft";
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData(DRAG_POST, p.id)}
      onClick={onOpen}
      className={`flex w-full items-start gap-1.5 rounded-lg border p-1.5 text-left text-xs ${statusCls[p.status]} ${draggable ? "cursor-grab" : ""}`}
    >
      <ServiceBadge service={p.service} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {p.dueAt ? timeKey(p.dueAt) : "—"} {p.status === "error" ? "⚠️" : p.status === "sent" ? "✓" : ""}
          <span className="ml-1 hidden font-normal text-white/45 xl:inline">{channel ? channelLabel(channel) : ""}</span>
        </span>
        <span className="line-clamp-2 text-white/70">{p.text || "без подписи"}</span>
      </span>
      {p.mediaUrl ? <video src={`${p.mediaUrl}#t=1`} muted preload="metadata" className="h-10 w-6 shrink-0 rounded bg-black object-cover" /> : null}
    </button>
  );
}

/** Календарь недели как в Buffer: посты по дням, свободные слоты, перетаскивание. */
export function CalendarPage() {
  const [start, setStart] = useState(() => weekStart(Date.now()));
  const end = start + 7 * DAY_MS;
  const posts = usePosts(start, end);
  const channels = useChannels();
  const library = useMediaList();
  const move = useMovePost();
  const [hidden, setHidden] = useState<ReadonlyArray<string>>([]);
  const [open, setOpen] = useState<BufferPost | null>(null);
  const [compose, setCompose] = useState<{ date?: string; media?: MediaItem } | null>(null);
  const [showLib, setShowLib] = useState(false);

  const chans = channels.data?.items ?? [];
  const chanById = useMemo(() => new Map(chans.map((c) => [c.id, c])), [chans]);
  const visible = (posts.data?.items ?? []).filter((p) => !hidden.includes(p.channelId));
  const days = Array.from({ length: 7 }, (_, i) => start + i * DAY_MS);
  const today = dayKey(Date.now());

  /** Свободные слоты дня из расписаний видимых каналов (как пустые места в Buffer). */
  function freeSlots(dayMs: number): ReadonlyArray<{ time: string; channel: Channel }> {
    const code = DAY_CODES[tbParts(dayMs).wd];
    const key = dayKey(dayMs);
    const out: { time: string; channel: Channel }[] = [];
    for (const c of chans) {
      if (hidden.includes(c.id) || c.isQueuePaused) continue;
      const sched = c.schedule.find((s) => s.day === code);
      if (!sched || sched.paused) continue;
      for (const t of sched.times) {
        const at = fromTb(key, t);
        if (at === null || at < Date.now()) continue;
        const taken = visible.some((p) => p.channelId === c.id && p.dueAt !== null && Math.abs(p.dueAt - at) < 60_000);
        if (!taken) out.push({ time: t, channel: c });
      }
    }
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  function onDrop(e: DragEvent, dayMs: number) {
    e.preventDefault();
    const postId = e.dataTransfer.getData(DRAG_POST);
    const mediaId = e.dataTransfer.getData(DRAG_MEDIA);
    const key = dayKey(dayMs);
    if (postId) {
      const p = visible.find((x) => x.id === postId);
      const at = fromTb(key, p?.dueAt ? timeKey(p.dueAt) : "19:00");
      if (!p || at === null) return;
      if (at <= Date.now()) {
        window.alert("Нельзя перенести в прошлое");
        return;
      }
      move.mutate({ id: p.id, dueAt: at });
    } else if (mediaId) {
      setCompose({ date: key, media: library.data?.items.find((m) => m.id === mediaId) });
    }
  }

  const rangeLabel = `${formatDay(start)} — ${formatDay(end - DAY_MS)}`;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-lg font-bold">Календарь</h2>
          <button type="button" onClick={() => setStart(start - 7 * DAY_MS)} className="rounded-full bg-white/10 px-3 py-1.5 font-bold" aria-label="Прошлая неделя">
            ‹
          </button>
          <button type="button" onClick={() => setStart(weekStart(Date.now()))} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">
            Сегодня
          </button>
          <button type="button" onClick={() => setStart(start + 7 * DAY_MS)} className="rounded-full bg-white/10 px-3 py-1.5 font-bold" aria-label="Следующая неделя">
            ›
          </button>
          <span className="text-sm text-white/60">{rangeLabel}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setShowLib((v) => !v)} className="hidden rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold md:block">
              🎬 Ролики
            </button>
            <button type="button" onClick={() => setCompose({})} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white">
              + Пост
            </button>
          </div>
        </div>
        {chans.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chans.map((c) => {
              const on = !hidden.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHidden(on ? [...hidden, c.id] : hidden.filter((x) => x !== c.id))}
                  className={`flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs font-semibold ${on ? "bg-white/10" : "bg-transparent text-white/35 line-through"}`}
                >
                  <ServiceBadge service={c.service} />
                  {channelLabel(c)}
                </button>
              );
            })}
          </div>
        ) : null}
        {showLib ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {(library.data?.items ?? []).map((m) => (
              <div
                key={m.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(DRAG_MEDIA, m.id)}
                title={`${m.name} — перетащите на день`}
                className="w-20 shrink-0 cursor-grab"
              >
                <video src={`${m.url}#t=1`} muted preload="metadata" className="pointer-events-none aspect-[9/16] w-full rounded-lg bg-black object-cover" />
                <p className="mt-1 line-clamp-2 text-[10px] text-white/60">{m.name}</p>
              </div>
            ))}
            <p className="self-center text-xs text-white/40">Перетащите ролик на день</p>
          </div>
        ) : null}
        {posts.isError ? <p className="mt-2 text-sm text-red-400">{posts.error.message}</p> : null}
        {move.isError ? <p className="mt-2 text-sm text-red-400">Перенос: {move.error.message}</p> : null}
      </Card>

      {posts.isPending ? (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => (
            <Skeleton key={d} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const key = dayKey(d);
            const dayPosts = visible.filter((p) => p.dueAt !== null && dayKey(p.dueAt) === key).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
            const slots = freeSlots(d);
            const past = key < today;
            return (
              <section
                key={d}
                onDragOver={(e) => !past && e.preventDefault()}
                onDrop={(e) => onDrop(e, d)}
                className={`${dayPosts.length === 0 && slots.length === 0 ? "md:min-h-28" : "min-h-20 md:min-h-28"} space-y-1.5 rounded-2xl border p-2 ${key === today ? "border-brand/60 bg-brand/5" : "border-white/10 bg-ink-card"} ${past ? "opacity-60" : ""}`}
              >
                <header className="flex items-center">
                  <span className={`text-xs font-bold ${key === today ? "text-brand-light" : "text-white/70"}`}>{formatDay(d)}</span>
                  {!past ? (
                    <button type="button" onClick={() => setCompose({ date: key })} className="ml-auto rounded-full px-2 text-white/50 hover:bg-white/10" aria-label={`Пост на ${formatDay(d)}`}>
                      +
                    </button>
                  ) : null}
                </header>
                {dayPosts.map((p) => (
                  <PostChip key={p.id} p={p} channel={chanById.get(p.channelId)} onOpen={() => setOpen(p)} />
                ))}
                {slots.length > 0 ? (
                  <p className="text-[10px] leading-snug text-white/30" title="Свободные слоты очереди">
                    свободно: {[...new Set(slots.map((s) => s.time))].join(", ")}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {(posts.data?.drafts.length ?? 0) > 0 ? (
        <Card title="Черновики без даты">
          <div className="grid gap-2 sm:grid-cols-2">
            {posts.data?.drafts.map((p) => (
              <PostChip key={p.id} p={p} channel={chanById.get(p.channelId)} onOpen={() => setOpen(p)} />
            ))}
          </div>
        </Card>
      ) : null}

      {open ? <PostDialog post={open} channel={chanById.get(open.channelId)} onClose={() => setOpen(null)} /> : null}
      {compose ? <ComposeDialog media={compose.media} presetDate={compose.date} onClose={() => setCompose(null)} /> : null}
    </div>
  );
}
