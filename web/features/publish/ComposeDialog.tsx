import { useEffect, useMemo, useState } from "react";
import { TEXT_LIMITS, type Channel, type ComposeInput, type ComposeResult, type MediaItem, type ShareMode } from "../../../shared/schemas";
import { useMediaList } from "../../api/media";
import { useChannels, useCompose } from "../../api/publish";
import { dayKey, fromTb } from "../../lib/time";
import { ServiceBadge, channelLabel } from "./channels";

const MODES: ReadonlyArray<{ mode: ShareMode; label: string; button: string; hint: string }> = [
  { mode: "queue", label: "В очередь", button: "Добавить в очередь", hint: "Ближайший свободный слот из расписания канала в Buffer" },
  { mode: "next", label: "Следующим", button: "Поставить следующим", hint: "Первым в очереди — выйдет в ближайший слот" },
  { mode: "schedule", label: "На время", button: "Запланировать", hint: "Точная дата и время (Тбилиси)" },
  { mode: "now", label: "Сейчас", button: "Опубликовать сейчас", hint: "Выйдет сразу" },
  { mode: "draft", label: "Черновик", button: "Сохранить черновиком", hint: "В Buffer, без даты — можно поставить позже" },
];

const input =
  "w-full rounded-lg border border-white/15 bg-ink-deep p-2.5 text-sm text-white placeholder:text-white/35 focus:border-brand focus:outline-none";
const titleFrom = (name: string) => name.replace(/\.[a-z0-9]+$/i, "").replace(/^\d+\s*/, "").slice(0, 100);
const needsTitle = (s: string) => s === "youtube";

interface Props {
  media?: MediaItem;
  presetDate?: string;
  onClose: () => void;
}

/** Окно поста — как «Create Post» в Buffer: ролик, соцсети, подписи по сетям, когда выпустить. */
export function ComposeDialog({ media, presetDate, onClose }: Props) {
  const channels = useChannels();
  const library = useMediaList();
  const compose = useCompose();
  const [mediaId, setMediaId] = useState(media?.id ?? "");
  const [selected, setSelected] = useState<ReadonlyArray<string> | null>(null);
  const [baseText, setBaseText] = useState("");
  const [custom, setCustom] = useState<Readonly<Record<string, string>>>({});
  const [tab, setTab] = useState<string>("all");
  const [title, setTitle] = useState(media ? titleFrom(media.name) : "");
  const [mode, setMode] = useState<ShareMode>(presetDate ? "schedule" : "queue");
  const [date, setDate] = useState(presetDate ?? dayKey(Date.now() + 86_400_000));
  const [time, setTime] = useState("19:00");
  const [result, setResult] = useState<ComposeResult | null>(null);

  const all = useMemo(() => (channels.data?.items ?? []).filter((c) => !c.isDisconnected), [channels.data]);
  const chosen = selected ?? all.map((c) => c.id);
  const chosenChannels = all.filter((c) => chosen.includes(c.id));
  const current = library.data?.items.find((m) => m.id === mediaId) ?? media;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const textFor = (c: Channel) => custom[c.id] ?? baseText;
  const toggle = (id: string) => setSelected(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const dueAt = mode === "schedule" ? fromTb(date, time) : null;
  const tooLong = chosenChannels.filter((c) => textFor(c).length > (TEXT_LIMITS[c.service] ?? 5000));
  const ytMissing = chosenChannels.some((c) => needsTitle(c.service)) && !title.trim();
  const canSend =
    !!mediaId && chosenChannels.length > 0 && tooLong.length === 0 && !ytMissing && (mode !== "schedule" || (dueAt !== null && dueAt > Date.now()));
  const modeInfo = MODES.find((m) => m.mode === mode) ?? { mode, label: "", button: "Отправить", hint: "" };

  function submit() {
    if (!canSend || !mediaId) return;
    const body: ComposeInput = {
      mediaId,
      mode,
      ...(mode === "schedule" && dueAt ? { dueAt } : {}),
      targets: chosenChannels.map((c) => ({
        channelId: c.id,
        text: textFor(c),
        ...(needsTitle(c.service) || c.service === "tiktok" ? (title.trim() ? { title: title.trim() } : {}) : {}),
      })),
    };
    compose.mutate(body, { onSuccess: setResult });
  }

  const tabChannel = all.find((c) => c.id === tab);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 md:items-center" role="dialog" aria-modal="true" aria-label="Новый пост">
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-ink-card md:max-h-[92vh] md:rounded-3xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-bold">Новый пост</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1 text-white/60 hover:bg-white/10" aria-label="Закрыть">
            ✕
          </button>
        </header>

        {result ? (
          <div className="space-y-3 overflow-y-auto p-4">
            <p className="font-semibold">
              {result.results.every((r) => r.ok) ? "Готово ✓ Посты отправлены в Buffer" : "Часть постов не прошла — смотрите ниже"}
            </p>
            <ul className="space-y-2">
              {result.results.map((r) => {
                const c = all.find((x) => x.id === r.channelId);
                return (
                  <li key={r.channelId} className="flex items-start gap-2 text-sm">
                    <ServiceBadge service={c?.service ?? ""} />
                    <span className="font-semibold">{c ? channelLabel(c) : r.channelId}</span>
                    <span className={`ml-auto text-right ${r.ok ? "text-wa" : "text-red-400"}`}>{r.ok ? "✓" : r.error}</span>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={onClose} className="rounded-full bg-brand px-5 py-2 font-bold text-white">
              Закрыть
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4 overflow-y-auto p-4">
              {/* Ролик */}
              <div className="flex gap-3">
                {current ? (
                  <video src={`${current.url}#t=1`} muted playsInline preload="metadata" className="h-28 w-16 shrink-0 rounded-lg bg-black object-cover" />
                ) : (
                  <div className="flex h-28 w-16 shrink-0 items-center justify-center rounded-lg bg-white/5 text-2xl">🎬</div>
                )}
                <label className="block min-w-0 flex-1 space-y-1 text-sm">
                  <span className="font-semibold">Ролик</span>
                  <select
                    value={mediaId}
                    onChange={(e) => {
                      setMediaId(e.target.value);
                      const m = library.data?.items.find((x) => x.id === e.target.value);
                      if (m && !title) setTitle(titleFrom(m.name));
                    }}
                    className={input}
                  >
                    <option value="">— выберите ролик —</option>
                    {(library.data?.items ?? (media ? [media] : [])).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Соцсети */}
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Куда</p>
                {channels.isPending ? <p className="text-sm text-white/50">Загружаю каналы Buffer…</p> : null}
                {channels.isError ? <p className="text-sm text-red-400">{channels.error.message}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {all.map((c) => {
                    const on = chosen.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(c.id)}
                        className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold ${on ? "bg-brand/25 text-white ring-1 ring-brand" : "bg-white/5 text-white/45"}`}
                      >
                        <ServiceBadge service={c.service} size="md" />
                        {channelLabel(c)}
                        {c.isQueuePaused ? " ⏸" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Подписи: общая + своя для сети */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTab("all")}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === "all" ? "bg-white text-ink" : "bg-white/10 text-white/70"}`}
                  >
                    Общая подпись
                  </button>
                  {chosenChannels.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setTab(c.id)}
                      className={`flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs font-semibold ${tab === c.id ? "bg-white text-ink" : "bg-white/10 text-white/70"}`}
                    >
                      <ServiceBadge service={c.service} />
                      {custom[c.id] !== undefined ? "✎" : ""}
                    </button>
                  ))}
                </div>
                {tab === "all" || !tabChannel ? (
                  <textarea rows={6} value={baseText} onChange={(e) => setBaseText(e.target.value)} placeholder="Подпись для всех соцсетей" className={input} />
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-white/55">
                      {channelLabel(tabChannel)}:{" "}
                      {custom[tabChannel.id] === undefined ? "сейчас берётся общая подпись" : "своя подпись для этой сети"}
                    </p>
                    <textarea
                      rows={6}
                      value={textFor(tabChannel)}
                      onChange={(e) => setCustom({ ...custom, [tabChannel.id]: e.target.value })}
                      className={input}
                    />
                    {custom[tabChannel.id] !== undefined ? (
                      <button
                        type="button"
                        onClick={() => {
                          const { [tabChannel.id]: _drop, ...rest } = custom;
                          setCustom(rest);
                        }}
                        className="text-xs text-brand-light"
                      >
                        ↺ Вернуть общую подпись
                      </button>
                    ) : null}
                    <span className="block text-right text-xs text-white/45">
                      {textFor(tabChannel).length} / {TEXT_LIMITS[tabChannel.service] ?? 5000}
                    </span>
                  </div>
                )}
                {tooLong.length > 0 ? (
                  <p className="text-xs text-red-400">Слишком длинно для: {tooLong.map((c) => channelLabel(c)).join(", ")}</p>
                ) : null}
              </div>

              {chosenChannels.some((c) => needsTitle(c.service) || c.service === "tiktok") ? (
                <label className="block space-y-1 text-sm">
                  <span className="font-semibold">Название (YouTube, TikTok)</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={input} />
                  {ytMissing ? <span className="text-xs text-red-400">Для YouTube нужно название</span> : null}
                </label>
              ) : null}

              {/* Когда */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">Когда</p>
                <div className="flex flex-wrap gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.mode}
                      type="button"
                      aria-pressed={mode === m.mode}
                      onClick={() => setMode(m.mode)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === m.mode ? "bg-brand text-white" : "bg-white/10 text-white/75"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-white/50">{modeInfo.hint}</p>
                {mode === "schedule" ? (
                  <div className="flex gap-2">
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${input} w-32`} />
                  </div>
                ) : null}
                {mode === "schedule" && dueAt !== null && dueAt <= Date.now() ? <p className="text-xs text-red-400">Это время уже прошло</p> : null}
              </div>
            </div>

            <footer className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
              {compose.isError ? <p className="min-w-0 flex-1 text-sm text-red-400">{compose.error.message}</p> : <span className="flex-1" />}
              <button
                type="button"
                disabled={!canSend || compose.isPending}
                onClick={() => {
                  if (mode === "now" && !window.confirm("Опубликовать сразу во всех выбранных соцсетях?")) return;
                  submit();
                }}
                className="rounded-full bg-brand px-5 py-2.5 font-bold text-white disabled:opacity-40"
              >
                {compose.isPending ? "Отправляю в Buffer…" : modeInfo.button}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
