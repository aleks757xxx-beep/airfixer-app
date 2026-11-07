import { useMemo, useState } from "react";
import type { StatPost } from "../../../shared/schemas";
import { useChannels, useStats } from "../../api/publish";
import { Card, Skeleton } from "../../components/ui/Card";
import { DAY_MS, formatDay, tbParts, timeKey } from "../../lib/time";
import { channelLabel } from "./channels";
import { ServiceSquare, Thumb } from "./PostCard";

const PERIODS = [
  { days: 7, label: "7 дней" },
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
] as const;
const SHOW: ReadonlyArray<{ type: string; label: string }> = [
  { type: "views", label: "Просмотры" },
  { type: "reach", label: "Охват" },
  { type: "likes", label: "Лайки" },
  { type: "comments", label: "Комментарии" },
  { type: "shares", label: "Репосты" },
  { type: "saves", label: "Сохранения" },
];
/** Лайки у YouTube/TikTok Buffer отдаёт как reactions. */
const metric = (p: StatPost, type: string) => {
  const get = (t: string) => p.metrics.find((m) => m.type === t)?.value;
  return (type === "likes" ? (get("likes") ?? get("reactions")) : get(type)) ?? 0;
};
const has = (p: StatPost, type: string) => p.metrics.some((m) => m.type === type || (type === "likes" && m.type === "reactions"));
const views = (p: StatPost) => metric(p, "views") || metric(p, "impressions") || metric(p, "reach");
const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** Статистика опубликованных постов (цифры Buffer, экспериментально). */
export function StatsPage() {
  const [days, setDays] = useState<number>(30);
  const [range] = useState(() => ({ to: Date.now() }));
  const from = range.to - days * DAY_MS;
  const q = useStats(from, range.to);
  const channels = useChannels();
  const chanById = useMemo(() => new Map((channels.data?.items ?? []).map((c) => [c.id, c])), [channels.data]);
  const items = q.data?.items ?? [];
  const withMetrics = items.filter((p) => p.metrics.length > 0);

  const byChannel = useMemo(() => {
    const m = new Map<string, { posts: number; totals: Record<string, number> }>();
    for (const p of items) {
      const cur = m.get(p.channelId) ?? { posts: 0, totals: {} };
      cur.posts += 1;
      for (const s of SHOW) cur.totals[s.type] = (cur.totals[s.type] ?? 0) + metric(p, s.type);
      m.set(p.channelId, cur);
    }
    return [...m.entries()];
  }, [items]);

  /** Средние просмотры по часу выхода (Тбилиси) — первые наметки «лучшего времени». */
  const hours = useMemo(() => {
    const acc = new Map<number, { sum: number; n: number }>();
    for (const p of withMetrics) {
      const at = p.sentAt ?? p.dueAt;
      if (!at) continue;
      const h = tbParts(at).hh;
      const cur = acc.get(h) ?? { sum: 0, n: 0 };
      acc.set(h, { sum: cur.sum + views(p), n: cur.n + 1 });
    }
    return [...acc.entries()].map(([h, v]) => ({ h, avg: v.sum / v.n, n: v.n })).sort((a, b) => b.avg - a.avg);
  }, [withMetrics]);

  const top = [...items].sort((a, b) => views(b) - views(a));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 text-xl" aria-hidden>
          📈
        </span>
        <h1 className="text-2xl font-bold">Статистика</h1>
        <div className="ml-auto flex rounded-xl border border-white/10 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${days === p.days ? "bg-brand text-white" : "text-white/70 hover:bg-white/5"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-white/45">Цифры из Buffer (у Buffer это пока экспериментальная функция), обновляются раз в несколько часов.</p>

      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <Card>
          <p className="text-red-400">{q.error.message}</p>
          <p className="mt-1 text-sm text-white/55">Если Buffer не отдаёт статистику для этого ключа — скажите Claude, проверим настройки ключа.</p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-white/55">За этот период опубликованных постов нет.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byChannel.map(([cid, v]) => {
              const c = chanById.get(cid);
              return (
                <div key={cid} className="rounded-2xl border border-white/10 bg-ink-card p-3">
                  <div className="flex items-center gap-2">
                    <ServiceSquare service={c?.service ?? ""} />
                    <span className="font-semibold">{c ? channelLabel(c) : cid}</span>
                    <span className="ml-auto text-xs text-white/50">{v.posts} пост.</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                    {SHOW.map((s) => (
                      <div key={s.type}>
                        <dt className="text-[11px] text-white/45">{s.label}</dt>
                        <dd className="font-bold tabular-nums">{fmt(v.totals[s.type] ?? 0)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>

          {hours.length > 0 ? (
            <Card title="Когда смотрят лучше (по часу выхода)">
              <div className="flex flex-wrap gap-2">
                {hours.slice(0, 6).map((h) => (
                  <span key={h.h} className="rounded-full bg-white/10 px-3 py-1 text-sm">
                    <b>{String(h.h).padStart(2, "0")}:00</b> · {fmt(h.avg)} просм. в среднем ({h.n})
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/45">Пока мало данных — точнее станет после десятков постов.</p>
            </Card>
          ) : null}

          <section className="space-y-2">
            <h2 className="px-1 font-bold">Посты — по просмотрам</h2>
            {top.map((p) => {
              const c = chanById.get(p.channelId);
              const at = p.sentAt ?? p.dueAt;
              return (
                <div key={p.id} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-ink-card p-3">
                  <Thumb post={p} className="h-16 w-12" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <ServiceSquare service={p.service} />
                      <span className="font-semibold">{c ? channelLabel(c) : p.service}</span>
                      <span className="ml-auto text-xs text-white/50">{at ? `${formatDay(at)}, ${timeKey(at)}` : ""}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-white/70">{p.text || "без подписи"}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/70">
                      {p.metrics.length === 0 ? (
                        <span className="text-white/40">цифр пока нет</span>
                      ) : (
                        <>
                          {SHOW.filter((s) => has(p, s.type)).map((s) => (
                            <span key={s.type}>
                              {s.label}: <b className="text-white">{fmt(metric(p, s.type))}</b>
                            </span>
                          ))}
                          {has(p, "averageTimeWatched") ? (
                            <span>
                              Досмотр: <b className="text-white">{metric(p, "averageTimeWatched").toFixed(1)} с</b>
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  {p.externalLink ? (
                    <a href={p.externalLink} target="_blank" rel="noreferrer" className="text-sm text-brand-light" aria-label="Открыть в соцсети">
                      ↗
                    </a>
                  ) : null}
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
