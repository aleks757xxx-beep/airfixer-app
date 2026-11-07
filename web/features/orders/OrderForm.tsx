import { useMemo, useState } from "react";
import { NOTE_MAX, type OrderInput } from "../../../shared/schemas";
import { useCreateOrder, useSources } from "../../api/orders";
import { formatDate } from "../../lib/format";

const DURATIONS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: "15 с", value: 15 },
  { label: "30 с", value: 30 },
  { label: "40 с", value: 40 },
  { label: "60 с", value: 60 },
  { label: "Как получится", value: null },
];
const STYLES = ["Заставка в стиле сайта", "Осенний фон", "Озвучка", "Отзывы и Telegram в конце", "Без музыки"] as const;

const input =
  "w-full rounded-lg border border-white/15 bg-ink-deep p-2.5 text-sm text-white placeholder:text-white/35 focus:border-brand focus:outline-none";

/** Форма «Заказать монтаж». */
export function OrderForm({ onDone }: { onDone: () => void }) {
  const sources = useSources();
  const create = useCreateOrder();
  const [shootDate, setShootDate] = useState("");
  const [folder, setFolder] = useState("");
  const [brief, setBrief] = useState("");
  const [duration, setDuration] = useState<number | null>(40);
  const [styles, setStyles] = useState<ReadonlyArray<string>>([]);
  const [styleExtra, setStyleExtra] = useState("");

  const folders = sources.data?.folders ?? [];
  /** Что снято в выбранный день (по оглавлению «Исходников»). */
  const onDate = useMemo(
    () =>
      shootDate
        ? folders.flatMap((f) => f.dates.filter((d) => d.date === shootDate).map((d) => ({ folder: f.name, count: d.count })))
        : [],
    [folders, shootDate],
  );

  const toggleStyle = (s: string) => setStyles((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <form
      className="mt-4 space-y-4 rounded-2xl border border-brand/40 bg-ink-deep/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const style = [...styles, styleExtra.trim()].filter(Boolean).join(", ");
        const body: OrderInput = {
          shootDate: shootDate || null,
          folder: folder || null,
          brief: brief.trim(),
          durationSec: duration,
          style: style || null,
        };
        create.mutate(body, { onSuccess: onDone });
      }}
    >
      <h3 className="font-bold">Новый заказ монтажа</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-semibold">Дата съёмки</span>
          <input type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} className={input} />
          {shootDate && sources.data ? (
            <span className={`block text-xs ${onDate.length ? "text-wa" : "text-white/50"}`}>
              {onDate.length
                ? `В этот день: ${onDate.map((d) => `${d.folder} (${d.count})`).join(", ")}`
                : sources.data.updatedAt
                  ? "В оглавлении «Исходников» за этот день видео нет — Claude поищет сам"
                  : "Оглавление «Исходников» ещё не загружено — Claude поищет сам"}
            </span>
          ) : null}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-semibold">Папка в «Исходниках»</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className={input}>
            <option value="">Любая (по дате)</option>
            {folders.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} · {f.count}
              </option>
            ))}
          </select>
          {sources.data?.updatedAt ? (
            <span className="block text-xs text-white/40">Оглавление обновлено {formatDate(sources.data.updatedAt)}</span>
          ) : null}
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Что снято и что сделать</span>
        <textarea
          required
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={NOTE_MAX}
          rows={4}
          placeholder="Например: установка в Ваке, показать трассу, монтаж наружного блока и финал с пультом"
          className={input}
        />
      </label>

      <div className="space-y-1.5 text-sm">
        <span className="font-semibold">Длина</span>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => setDuration(d.value)}
              aria-pressed={duration === d.value}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${duration === d.value ? "bg-brand text-white" : "bg-white/10 text-white/75"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        <span className="font-semibold">Стиль</span>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleStyle(s)}
              aria-pressed={styles.includes(s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${styles.includes(s) ? "bg-brand text-white" : "bg-white/10 text-white/75"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <input value={styleExtra} onChange={(e) => setStyleExtra(e.target.value)} maxLength={200} placeholder="Своё пожелание (необязательно)" className={input} />
      </div>

      {create.isError ? <p className="text-sm text-red-400">{create.error.message}</p> : null}
      <div className="flex gap-3">
        <button type="submit" disabled={create.isPending || !brief.trim()} className="rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-40">
          {create.isPending ? "Отправляю…" : "Заказать"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-white/55">
          Отмена
        </button>
      </div>
    </form>
  );
}
