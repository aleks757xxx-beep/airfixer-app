import { useMemo, useState } from "react";
import type { StatPost } from "../../../shared/schemas";
import { useChannels, useStats } from "../../api/publish";
import { Card, Skeleton } from "../../components/ui/Card";
import { DAY_MS, formatDay, timeKey } from "../../lib/time";
import { channelLabel } from "./channels";
import { ServiceSquare, Thumb } from "./PostCard";
import { BestTimes } from "./BestTimes";

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

/** Статистика опубликованных постов: прямые соцсети + Buffer (TikTok, Google) + сохранённая история Buffer. */
export function StatsPage() {
  const [days, setDays] = useState<number>(30);
  const [range] = useState(() => ({ to: Date.now() }));
  const from = range.to - days * DAY_MS;
  const q = useStats(from, range.to);
  const channels = useChannels();
  const chanById = useMemo(() => new Map((channels.data?.items ?? []).map((c) => [c.id, c])), [channels.data]);
  const items = q.data?.items ?? [];

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


  const top = [...items].sort((a, b) => views(b) - views(a));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-m3m border border-outline-variant text-xl" aria-hidden>
          📈
        </span>
        <h1 className="text-2xl font-bold">Статистика</h1>
        <div className="ml-auto flex rounded-xl border border-outline-variant p-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${days === p.days ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-on-surface-variant">Цифры берутся прямо из соцсетей (TikTok и Google — через Buffer), обновляются раз в несколько часов. Telegram просмотры не отдаёт.</p>
      <BestTimes />

      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <Card>
          <p className="text-error">{q.error.message}</p>
          <p className="mt-1 text-sm text-on-surface-variant">Если цифры не появляются — скажите Claude, проверим.</p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-on-surface-variant">За этот период опубликованных постов нет.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byChannel.map(([cid, v]) => {
              const c = chanById.get(cid);
              return (
                <div key={cid} className="rounded-m3m border border-outline-variant bg-surface-container p-3">
                  <div className="flex items-center gap-2">
                    <ServiceSquare service={c?.service ?? ""} />
                    <span className="font-semibold">{c ? channelLabel(c) : cid}</span>
                    <span className="ml-auto text-xs text-on-surface-variant">{v.posts} пост.</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                    {SHOW.map((s) => (
                      <div key={s.type}>
                        <dt className="text-[11px] text-on-surface-variant">{s.label}</dt>
                        <dd className="font-bold tabular-nums">{fmt(v.totals[s.type] ?? 0)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>


          <section className="space-y-2">
            <h2 className="px-1 font-bold">Посты — по просмотрам</h2>
            {top.map((p) => {
              const c = chanById.get(p.channelId);
              const at = p.sentAt ?? p.dueAt;
              return (
                <div key={p.id} className="flex items-start gap-3 rounded-m3m border border-outline-variant bg-surface-container p-3">
                  <Thumb post={p} className="h-16 w-12" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <ServiceSquare service={p.service} />
                      <span className="font-semibold">{c ? channelLabel(c) : p.service}</span>
                      <span className="ml-auto text-xs text-on-surface-variant">{at ? `${formatDay(at)}, ${timeKey(at)}` : ""}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-on-surface-variant">{p.text || "без подписи"}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                      {p.metrics.length === 0 ? (
                        <span className="text-on-surface-variant">цифр пока нет</span>
                      ) : (
                        <>
                          {SHOW.filter((s) => has(p, s.type)).map((s) => (
                            <span key={s.type}>
                              {s.label}: <b className="text-on-surface">{fmt(metric(p, s.type))}</b>
                            </span>
                          ))}
                          {has(p, "averageTimeWatched") ? (
                            <span>
                              Досмотр: <b className="text-on-surface">{metric(p, "averageTimeWatched").toFixed(1)} с</b>
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  {p.externalLink ? (
                    <a href={p.externalLink} target="_blank" rel="noreferrer" className="text-sm text-primary" aria-label="Открыть в соцсети">
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
