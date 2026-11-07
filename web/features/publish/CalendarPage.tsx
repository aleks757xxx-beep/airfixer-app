import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { BufferPost, MediaItem } from "../../../shared/schemas";
import { useMediaList } from "../../api/media";
import { useChannels, useMovePost, usePosts } from "../../api/publish";
import { Skeleton } from "../../components/ui/Card";
import { DAY_MS, dayKey, fromTb, tbParts, timeKey, weekStart } from "../../lib/time";
import { channelLabel, serviceInfo } from "./channels";
import { ComposeDialog } from "./ComposeDialog";
import { DRAG_MEDIA, DRAG_POST, PostCard, ServiceSquare } from "./PostCard";
import { PostDialog } from "./PostDialog";
import { TBILISI_OFFSET_MS } from "../../../shared/schemas";
import { plural } from "../../lib/format";

type View = "month" | "week";
type StatusFilter = "all" | "scheduled" | "sent" | "error" | "draft";
const STATUS_FILTERS: ReadonlyArray<{ v: StatusFilter; label: string }> = [
  { v: "all", label: "Все посты" },
  { v: "scheduled", label: "Запланированные" },
  { v: "sent", label: "Опубликованные" },
  { v: "error", label: "С ошибкой" },
  { v: "draft", label: "Черновики" },
];
const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"] as const;
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;
const MONTH_LIMIT = 3;

function useWide(): boolean {
  const q = "(min-width: 768px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Первое число месяца 00:00 по Тбилиси. */
const monthStart = (y: number, m: number) => Date.UTC(y, m - 1, 1) - TBILISI_OFFSET_MS;

function useOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [onOut]);
  return ref;
}

const pill = "flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/5";

/** Календарь публикаций в стиле Buffer: месяц/неделя, фильтры, карточки с превью, перетаскивание. */
export function CalendarPage() {
  const nowParts = tbParts(Date.now());
  const [viewChoice, setView] = useState<View>("month");
  const wide = useWide();
  /** На телефоне — всегда месяц (с точками), неделя — только на компьютере. */
  const view: View = wide ? viewChoice : "month";
  const [ym, setYm] = useState({ y: nowParts.y, m: nowParts.m });
  const [wStart, setWStart] = useState(() => weekStart(Date.now()));
  const [hidden, setHidden] = useState<ReadonlyArray<string>>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [showNoDate, setShowNoDate] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [chanMenu, setChanMenu] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([]);
  const [selectedDay, setSelectedDay] = useState(dayKey(Date.now()));
  const [open, setOpen] = useState<BufferPost | null>(null);
  const [compose, setCompose] = useState<{ date?: string; media?: MediaItem } | null>(null);
  const chanRef = useOutside(() => setChanMenu(false));

  // Сетка: месяц — 6 недель от понедельника перед 1-м числом; неделя — 7 дней
  const gridStart = view === "month" ? weekStart(monthStart(ym.y, ym.m)) : wStart;
  const gridDays = view === "month" ? 42 : 7;
  const gridEnd = gridStart + gridDays * DAY_MS;
  const posts = usePosts(gridStart, gridEnd);
  const channels = useChannels();
  const library = useMediaList();
  const move = useMovePost();

  const chans = channels.data?.items ?? [];
  const chanById = useMemo(() => new Map(chans.map((c) => [c.id, c])), [chans]);
  const visible = (posts.data?.items ?? []).filter(
    (p) =>
      !hidden.includes(p.channelId) &&
      (status === "all" || p.status === status || (status === "scheduled" && (p.status === "sending" || p.status === "needs_approval"))),
  );
  const byDay = useMemo(() => {
    const m = new Map<string, BufferPost[]>();
    for (const p of visible) {
      if (p.dueAt === null) continue;
      const k = dayKey(p.dueAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    for (const list of m.values()) list.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
    return m;
  }, [visible]);
  const drafts = (posts.data?.drafts ?? []).filter((p) => !hidden.includes(p.channelId));
  const days = Array.from({ length: gridDays }, (_, i) => gridStart + i * DAY_MS);
  const today = dayKey(Date.now());
  const noTextSoon = visible.filter((p) => p.status === "scheduled" && !p.text.trim());

  const title =
    view === "month"
      ? `${MONTHS[ym.m - 1]} ${ym.y}`
      : (() => {
          const a = tbParts(wStart);
          const b = tbParts(wStart + 6 * DAY_MS);
          return a.m === b.m ? `${a.d}–${b.d} ${MONTHS_GEN[a.m - 1]} ${a.y}` : `${a.d} ${MONTHS_GEN[a.m - 1]} – ${b.d} ${MONTHS_GEN[b.m - 1]} ${b.y}`;
        })();

  function shift(dir: 1 | -1) {
    if (view === "month") {
      const m0 = ym.m - 1 + dir;
      setYm({ y: ym.y + Math.floor(m0 / 12), m: ((m0 % 12) + 12) % 12 + 1 });
    } else setWStart(wStart + dir * 7 * DAY_MS);
  }
  function goToday() {
    setYm({ y: nowParts.y, m: nowParts.m });
    setWStart(weekStart(Date.now()));
    setSelectedDay(today);
  }

  /** Свободные слоты очереди в этот день (неделя). */
  function freeSlots(dayMs: number): string[] {
    const code = DAY_CODES[tbParts(dayMs).wd];
    const key = dayKey(dayMs);
    const set = new Set<string>();
    for (const c of chans) {
      if (hidden.includes(c.id) || c.isQueuePaused) continue;
      const s = c.schedule.find((x) => x.day === code);
      if (!s || s.paused) continue;
      for (const t of s.times) {
        const at = fromTb(key, t);
        if (at === null || at < Date.now()) continue;
        if (!(byDay.get(key) ?? []).some((p) => p.channelId === c.id && p.dueAt !== null && Math.abs(p.dueAt - at) < 60_000)) set.add(t);
      }
    }
    return [...set].sort();
  }

  function onDrop(e: DragEvent, dayMs: number) {
    e.preventDefault();
    const key = dayKey(dayMs);
    const postId = e.dataTransfer.getData(DRAG_POST);
    const mediaId = e.dataTransfer.getData(DRAG_MEDIA);
    if (postId) {
      const p = [...visible, ...drafts].find((x) => x.id === postId);
      const at = fromTb(key, p?.dueAt ? timeKey(p.dueAt) : "19:00");
      if (!p || at === null) return;
      if (at <= Date.now()) return window.alert("Нельзя перенести в прошлое");
      move.mutate({ id: p.id, dueAt: at });
    } else if (mediaId) {
      setCompose({ date: key, media: library.data?.items.find((m) => m.id === mediaId) });
    }
  }

  const monthOf = (ms: number) => tbParts(ms).m;
  const selPosts = byDay.get(selectedDay) ?? [];

  return (
    <div className="space-y-4">
      {/* Заголовок как в Buffer */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 text-xl" aria-hidden>
          📅
        </span>
        <h1 className="text-2xl font-bold">Публикации</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-xl border border-white/10 p-1">
            <a href="#/posts" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white/70 hover:bg-white/5">
              ☰ Список
            </a>
            <span className="rounded-lg bg-wa/20 px-3 py-1.5 text-sm font-semibold text-wa">📅 Календарь</span>
          </div>
          <button type="button" onClick={() => setCompose({})} className={`${pill} bg-white/5`}>
            + Новый пост
          </button>
        </div>
      </div>

      {/* Навигация */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => shift(-1)} className="rounded-lg px-2 py-1 text-xl text-white/70 hover:bg-white/5" aria-label="Назад">
          ‹
        </button>
        <button type="button" onClick={() => shift(1)} className="rounded-lg px-2 py-1 text-xl text-white/70 hover:bg-white/5" aria-label="Вперёд">
          ›
        </button>
        <h2 className="min-w-40 text-xl font-bold">{title}</h2>
        <button type="button" onClick={goToday} className={pill}>
          Сегодня
        </button>
        <select
          value={viewChoice}
          onChange={(e) => {
            const v = e.target.value === "week" ? "week" : "month";
            setView(v);
            if (v === "week") setWStart(weekStart(fromTb(selectedDay, "12:00") ?? Date.now()));
          }}
          className="hidden rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm font-semibold md:block"
          aria-label="Вид"
        >
          <option value="month" className="bg-ink">
            Месяц
          </option>
          <option value="week" className="bg-ink">
            Неделя
          </option>
        </select>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative" ref={chanRef}>
          <button type="button" onClick={() => setChanMenu((v) => !v)} className={pill} aria-expanded={chanMenu}>
            ⚏ Каналы {hidden.length ? `(${chans.length - hidden.length}/${chans.length})` : ""} ▾
          </button>
          {chanMenu ? (
            <div className="absolute left-0 top-full z-20 mt-1 w-64 space-y-1 rounded-xl border border-white/10 bg-ink-card p-2 shadow-xl">
              <button type="button" onClick={() => setHidden([])} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-brand-light hover:bg-white/5">
                Показать все
              </button>
              {chans.map((c) => {
                const on = !hidden.includes(c.id);
                return (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <input type="checkbox" checked={on} onChange={() => setHidden(on ? [...hidden, c.id] : hidden.filter((x) => x !== c.id))} />
                    <ServiceSquare service={c.service} />
                    <span className="text-sm">{channelLabel(c)}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={`${pill} bg-transparent`} aria-label="Какие посты">
          {STATUS_FILTERS.map((s) => (
            <option key={s.v} value={s.v} className="bg-ink">
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" aria-pressed={showNoDate} onClick={() => setShowNoDate((v) => !v)} className={`${pill} ${showNoDate ? "bg-white/10" : ""}`}>
          ▤ Без даты {drafts.length ? `(${drafts.length})` : ""}
        </button>
        <button type="button" aria-pressed={showLib} onClick={() => setShowLib((v) => !v)} className={`${pill} hidden md:flex ${showLib ? "bg-white/10" : ""}`}>
          🎬 Ролики
        </button>
        <span className="ml-auto flex items-center gap-1 text-sm text-white/55">🌐 Тбилиси</span>
      </div>

      {noTextSoon.length > 0 ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          ✎ {noTextSoon.length} {plural(noTextSoon.length, "запланированный пост", "запланированных поста", "запланированных постов")} без подписи — откройте пост и
          добавьте текст, или попросите Claude.
        </p>
      ) : null}
      {posts.isError ? <p className="text-sm text-red-400">{posts.error.message}</p> : null}
      {move.isError ? <p className="text-sm text-red-400">Перенос: {move.error.message}</p> : null}

      {showLib ? (
        <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 p-2">
          {(library.data?.items ?? []).map((m) => (
            <div key={m.id} draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_MEDIA, m.id)} title={`${m.name} — перетащите на день`} className="w-20 shrink-0 cursor-grab">
              <video src={`${m.url}#t=1`} muted preload="metadata" className="pointer-events-none aspect-[9/16] w-full rounded-lg bg-black object-cover" />
              <p className="mt-1 line-clamp-2 text-[10px] text-white/60">{m.name}</p>
            </div>
          ))}
          <p className="self-center px-2 text-xs text-white/40">Перетащите ролик на день →</p>
        </div>
      ) : null}

      {showNoDate ? (
        <div className="rounded-2xl border border-white/10 p-3">
          <p className="mb-2 text-sm font-semibold">Черновики без даты</p>
          {drafts.length === 0 ? (
            <p className="text-sm text-white/45">Нет</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {drafts.map((p) => (
                <PostCard key={p.id} post={p} channel={chanById.get(p.channelId)} onOpen={() => setOpen(p)} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {posts.isPending ? (
        <Skeleton className="h-[60vh]" />
      ) : (
        <>
          {/* Компьютер: сетка как в Buffer */}
          <div className="hidden overflow-hidden rounded-2xl border border-white/10 md:block">
            <div className="grid grid-cols-7 border-b border-white/10">
              {WEEKDAYS.map((w) => (
                <div key={w} className="border-r border-white/10 py-3 text-center text-sm text-white/60 last:border-r-0">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const key = dayKey(d);
                const list = byDay.get(key) ?? [];
                const past = key < today;
                const other = view === "month" && monthOf(d) !== ym.m;
                const isOpen = expanded.includes(key);
                const shown = view === "month" && !isOpen ? list.slice(0, MONTH_LIMIT) : list;
                const slots = view === "week" ? freeSlots(d) : [];
                return (
                  <section
                    key={d}
                    onDragOver={(e) => !past && e.preventDefault()}
                    onDrop={(e) => onDrop(e, d)}
                    className={`group space-y-1.5 border-b border-r border-white/10 p-2 [&:nth-child(7n)]:border-r-0 ${view === "month" ? "min-h-36" : "min-h-[60vh]"} ${key === today ? "bg-brand/5" : ""}`}
                  >
                    <header className="flex items-center">
                      <span
                        className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm ${key === today ? "bg-brand font-bold text-white" : other ? "text-white/25" : past ? "text-white/40" : "text-white/80"}`}
                      >
                        {tbParts(d).d}
                      </span>
                      {!past ? (
                        <button
                          type="button"
                          onClick={() => setCompose({ date: key })}
                          className="ml-auto rounded-lg px-2 text-lg leading-none text-white/0 hover:bg-white/10 group-hover:text-white/60"
                          aria-label="Новый пост на этот день"
                        >
                          +
                        </button>
                      ) : null}
                    </header>
                    {shown.map((p) => (
                      <PostCard key={p.id} post={p} channel={chanById.get(p.channelId)} onOpen={() => setOpen(p)} />
                    ))}
                    {view === "month" && list.length > MONTH_LIMIT ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? expanded.filter((x) => x !== key) : [...expanded, key])}
                        className="w-full py-1 text-center text-sm font-semibold text-white/70 hover:text-white"
                      >
                        {isOpen ? "⌃ Свернуть" : `⌄ Ещё ${list.length - MONTH_LIMIT}`}
                      </button>
                    ) : null}
                    {slots.length > 0 ? <p className="text-[11px] leading-snug text-white/30">свободно: {slots.join(", ")}</p> : null}
                  </section>
                );
              })}
            </div>
          </div>

          {/* Телефон: месяц с точками + посты выбранного дня */}
          <div className="space-y-3 md:hidden">
            <div className="rounded-2xl border border-white/10 p-2">
              <div className="grid grid-cols-7 pb-1 text-center text-xs text-white/45">
                {WD_SHORT.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1">
                {(view === "month" ? days : Array.from({ length: 42 }, (_, i) => weekStart(monthStart(ym.y, ym.m)) + i * DAY_MS)).map((d) => {
                  const key = dayKey(d);
                  const list = byDay.get(key) ?? [];
                  const other = monthOf(d) !== ym.m;
                  const sel = key === selectedDay;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDay(key)}
                      className={`flex h-12 flex-col items-center justify-start rounded-xl pt-1 ${sel ? "bg-white/10" : ""}`}
                      aria-pressed={sel}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${key === today ? "bg-brand font-bold text-white" : other ? "text-white/25" : "text-white/85"}`}
                      >
                        {tbParts(d).d}
                      </span>
                      <span className="mt-0.5 flex gap-0.5">
                        {list.slice(0, 4).map((p) => (
                          <span key={p.id} className={`h-1.5 w-1.5 rounded-full ${p.status === "error" ? "bg-amber-400 ring-1 ring-red-500" : serviceInfo(p.service).cls}`} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center">
              <h3 className="font-bold">
                {(() => {
                  const ms = fromTb(selectedDay, "12:00") ?? Date.now();
                  const t = tbParts(ms);
                  return `${WEEKDAYS[t.wd]}, ${t.d} ${MONTHS_GEN[t.m - 1]}`;
                })()}
              </h3>
              {selectedDay >= today ? (
                <button type="button" onClick={() => setCompose({ date: selectedDay })} className="ml-auto rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white">
                  + Пост
                </button>
              ) : null}
            </div>
            {selPosts.length === 0 ? (
              <p className="text-sm text-white/45">Постов нет</p>
            ) : (
              <div className="space-y-2">
                {selPosts.map((p) => (
                  <PostCard key={p.id} post={p} channel={chanById.get(p.channelId)} onOpen={() => setOpen(p)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {open ? <PostDialog post={open} channel={chanById.get(open.channelId)} onClose={() => setOpen(null)} /> : null}
      {compose ? <ComposeDialog media={compose.media} presetDate={compose.date} onClose={() => setCompose(null)} /> : null}
    </div>
  );
}
