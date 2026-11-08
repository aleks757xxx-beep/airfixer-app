import { useState } from "react";
import { useBestTimes } from "../../api/publish";
import { Skeleton } from "../../components/ui/Card";
import { ServiceBadge } from "./channels";

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

/**
 * «Лучшее время» (решение владельца 08.11.2026): карта день × час по каждому каналу.
 * Ярче — лучше обычного. «В очередь» сам ставит пост в лучший свободный час, примерно каждый 5-й — в пробный.
 */
export function BestTimes() {
  const q = useBestTimes();
  const items = (q.data?.items ?? []).filter((i) => i.source !== "none");
  const [sel, setSel] = useState<string | null>(null);
  const cur = items.find((i) => i.channelId === sel) ?? items[0];
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <p className="text-sm text-error">{q.error.message}</p>;
  if (!q.data || !cur) return <p className="text-sm text-on-surface-variant">Пока мало опубликованных постов с цифрами — карта появится сама.</p>;
  const from = q.data.hourFrom;
  const hours = Array.from({ length: q.data.hourTo - from + 1 }, (_, i) => from + i);
  const flat = cur.cells.flat();
  const max = Math.max(...flat, 1.01);
  const min = Math.min(...flat, 0.99);
  const alpha = (v: number) => (v >= 1 ? 0.18 + 0.82 * ((v - 1) / (max - 1)) : 0.18 * Math.max(0, (v - min) / (1 - min)));
  const isBest = (d: number, h: number) => cur.best.some((b) => b.day === d && b.hour === h);
  return (
    <section className="rounded-m3m border border-outline-variant bg-surface-container p-3">
      <h2 className="type-title-m">Лучшее время</h2>
      <p className="type-body-s mt-1 text-on-surface-variant">
        Ярче — больше просмотров за первые сутки, чем обычно. «В очередь» сам ставит пост в лучший свободный час (8:00–22:00), примерно каждый 5-й — в пробный, чтобы карта уточнялась.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((i) => (
          <button
            key={i.channelId}
            type="button"
            aria-pressed={i.channelId === cur.channelId}
            onClick={() => setSel(i.channelId)}
            className={`state-layer type-label-l inline-flex h-8 items-center gap-1.5 rounded-m3s px-2 ${i.channelId === cur.channelId ? "bg-secondary-container text-on-secondary-container" : "border border-outline-variant text-on-surface-variant"}`}
          >
            <ServiceBadge service={i.service} />
            {i.name}
          </button>
        ))}
      </div>
      <p className="type-body-s mt-2 text-on-surface-variant">
        {cur.source === "own" ? `По ${cur.samples} постам этого канала.` : "Своих постов с цифрами пока мало — по всем каналам."}{" "}
        {cur.best.length ? `Лучше всего: ${cur.best.map((b) => `${DAYS_FULL[b.day]} ${b.hour}:00`).join(", ")}.` : ""}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-center">
          <thead>
            <tr>
              <th className="w-7" />
              {hours.map((h) => (
                <th key={h} className="type-label-s font-normal text-on-surface-variant">
                  {h % 2 === 0 ? h : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cur.cells.map((row, d) => (
              <tr key={DAYS[d]}>
                <th className="type-label-s pr-1 text-left font-normal text-on-surface-variant">{DAYS[d]}</th>
                {row.map((v, i) => {
                  const h = from + i;
                  const n = cur.counts[d]?.[i] ?? 0;
                  return (
                    <td
                      key={h}
                      title={`${DAYS_FULL[d]} ${h}:00 — ${v >= 1 ? `+${Math.round((v - 1) * 100)}` : `−${Math.round((1 - v) * 100)}`}% к обычному; постов: ${n}`}
                      className={`h-6 min-w-5 rounded-[3px] ${isBest(d, h) ? "ring-2 ring-primary" : ""}`}
                      style={{ backgroundColor: `rgb(183 196 255 / ${alpha(v).toFixed(2)})` }}
                    >
                      {n ? <span className="type-label-s text-on-surface/70">•</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="type-body-s mt-2 text-on-surface-variant">• — в этот час уже были посты; рамка — три лучших часа.</p>
    </section>
  );
}
