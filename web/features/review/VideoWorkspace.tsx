import { useEffect, useRef, useState, type RefObject } from "react";
import {
  REVIEW_KINDS,
  REVIEW_KIND_LABEL,
  REVIEW_TEXT_MAX,
  VOICE_FIELDS,
  voiceChain,
  type ReviewKind,
  type ReviewNote,
  type ReviewRound,
  type VoiceSettings,
} from "../../../shared/review";
import { useAddNote, useDeleteNote, useEditNote, useReview, useSaveVoice, useSaveVoiceDefault, useSendReview } from "../../api/review";
import { formatDateTime } from "../../lib/format";

/**
 * «🎬 Работа с видео» (решение владельца 11.11.2026): заметки к моменту или отрезку ролика с типом,
 * звук с прослушиванием прямо в плеере («мои по умолчанию» и свои для ролика), переписка с Claude.
 */

export const formatTime = (t: number): string => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const span = (n: { tFrom: number | null; tTo: number | null }) =>
  n.tFrom === null ? "без времени" : n.tTo === null ? formatTime(n.tFrom) : `${formatTime(n.tFrom)}–${formatTime(n.tTo)}`;
const round1 = (t: number) => Math.round(t * 10) / 10;

/** Прослушивание звука с настройками: те же фильтры, что Claude ставит при монтаже (voiceChain). */
function useVoicePreview(video: RefObject<HTMLVideoElement | null>, voice: VoiceSettings, on: boolean) {
  const graph = useRef<{ ctx: AudioContext; hp: BiquadFilterNode; shelf: BiquadFilterNode; peaks: BiquadFilterNode[]; gain: GainNode } | null>(null);
  const [failed, setFailed] = useState(false);
  const apply = () => {
    const g = graph.current;
    if (!g) return;
    const c = voiceChain(voice);
    g.hp.frequency.value = on && c.highpassHz ? c.highpassHz : 10;
    g.shelf.frequency.value = c.shelf?.f ?? 220;
    g.shelf.gain.value = on && c.shelf ? c.shelf.gain : 0;
    g.peaks.forEach((p, i) => {
      const s = c.peaks[i];
      p.frequency.value = s?.f ?? 1000;
      p.Q.value = s?.q ?? 1;
      p.gain.value = on && s ? s.gain : 0;
    });
    g.gain.gain.value = on ? Math.pow(10, c.gainDb / 20) : 1;
  };
  useEffect(apply);
  const start = () => {
    const el = video.current;
    if (!el || failed) return;
    if (!graph.current) {
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaElementSource(el);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        const shelf = ctx.createBiquadFilter();
        shelf.type = "lowshelf";
        const peaks = [0, 1, 2].map(() => {
          const p = ctx.createBiquadFilter();
          p.type = "peaking";
          return p;
        });
        const gain = ctx.createGain();
        [hp, shelf, ...peaks, gain].reduce<AudioNode>((a, b) => a.connect(b), src);
        gain.connect(ctx.destination);
        graph.current = { ctx, hp, shelf, peaks, gain };
      } catch (e: unknown) {
        console.warn("voice preview", e);
        setFailed(true);
        return;
      }
    }
    apply();
    void graph.current.ctx.resume();
  };
  return { start, failed };
}

function Seg<T extends number>({ options, value, onChange }: { options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${o.value === value ? "bg-primary text-on-primary" : "bg-surface-container-highest text-on-surface"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<ReviewNote["status"], { label: string; cls: string }> = {
  draft: { label: "черновик", cls: "bg-surface-container-highest text-on-surface-variant" },
  sent: { label: "⏳ ждёт Claude", cls: "bg-warning-container text-warning" },
  done: { label: "✅ сделано", cls: "bg-success-container text-success" },
  wontdo: { label: "⛔ не сделано", cls: "bg-error-container text-on-error-container" },
};

function NoteLine({ n, onSeek, actions }: { n: ReviewNote; onSeek: (t: number) => void; actions?: React.ReactNode }) {
  return (
    <li className="space-y-1 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {n.tFrom !== null ? (
          <button type="button" onClick={() => onSeek(n.tFrom ?? 0)} className="rounded-m3xs bg-primary/20 px-1.5 py-0.5 font-mono text-xs font-bold text-primary" title="Перемотать сюда">
            {span(n)}
          </button>
        ) : (
          <span className="rounded-m3xs bg-surface-container-highest px-1.5 py-0.5 text-xs text-on-surface-variant">без времени</span>
        )}
        <span className="text-xs text-on-surface-variant">{REVIEW_KIND_LABEL[n.kind]}</span>
        {n.status !== "draft" ? <span className={`rounded-m3xs px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span> : null}
        <span className="flex-1" />
        {actions}
      </div>
      <p className="whitespace-pre-wrap text-on-surface">{n.text}</p>
      {n.reply ? <p className="whitespace-pre-wrap rounded-lg bg-surface-container-high p-2 text-xs text-on-surface">🤖 {n.reply}</p> : null}
    </li>
  );
}

function RoundCard({ r, onSeek }: { r: ReviewRound; onSeek: (t: number) => void }) {
  return (
    <section className="rounded-lg border border-outline-variant">
      <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-2 py-1.5 text-xs">
        <span className="font-semibold text-on-surface">Правки #{r.id}</span>
        <span className="text-on-surface-variant">{formatDateTime(r.sentAt)}</span>
        <span className={`rounded-m3xs px-1.5 py-0.5 font-semibold ${r.repliedAt ? "bg-success-container text-success" : "bg-warning-container text-warning"}`}>
          {r.repliedAt ? "Claude ответил" : "⏳ ждёт Claude"}
        </span>
      </div>
      {r.notes.length ? (
        <ul className="divide-y divide-outline-variant">
          {r.notes.map((n) => (
            <NoteLine key={n.id} n={n} onSeek={onSeek} />
          ))}
        </ul>
      ) : (
        <p className="p-2 text-xs text-on-surface-variant">Только звук</p>
      )}
      {r.voice ? (
        <p className="border-t border-outline-variant p-2 text-xs text-on-surface-variant">
          🔊 {VOICE_FIELDS.map((f) => `${f.label}: ${f.options.find((o) => o.value === r.voice?.[f.key])?.label ?? "—"}`).join(" · ")}
          {r.voice.comment ? ` · «${r.voice.comment}»` : ""}
        </p>
      ) : null}
      {r.reply ? <p className="whitespace-pre-wrap border-t border-outline-variant p-2 text-sm text-on-surface">🤖 {r.reply}</p> : null}
    </section>
  );
}

type Tab = "notes" | "sound" | "chat";

export function VideoWorkspace({ media, orderId, onClose }: { media: { id: string; name: string; url: string }; orderId?: number; onClose: () => void }) {
  const q = useReview(media.id);
  const add = useAddNote(media.id);
  const edit = useEditNote(media.id);
  const del = useDeleteNote(media.id);
  const saveVoice = useSaveVoice(media.id);
  const saveDefault = useSaveVoiceDefault(media.id);
  const send = useSendReview(media.id);

  const video = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<Tab>("notes");
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(0);

  // заметка в работе
  const [kind, setKind] = useState<ReviewKind>("other");
  const [tFrom, setTFrom] = useState<number | null>(null);
  const [tTo, setTTo] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // звук
  const st = q.data;
  const effective = st ? (st.voice ?? st.voiceDefault) : null;
  const [voice, setVoice] = useState<VoiceSettings | null>(null);
  const [listen, setListen] = useState(true);
  useEffect(() => {
    if (effective && voice === null) setVoice(effective);
  }, [effective, voice]);
  const curVoice = voice ?? effective;
  const preview = useVoicePreview(video, curVoice ?? { volume: 0, bass: 0, nasal: 0, noise: 0, pauses: 0, music: 0 }, listen);
  const voiceDirty = !!(curVoice && effective && JSON.stringify(curVoice) !== JSON.stringify(effective));

  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    v.pause();
  };
  const resetComposer = () => {
    setKind("other");
    setTFrom(null);
    setTTo(null);
    setText("");
    setEditingId(null);
    setComposing(false);
  };
  const startNote = () => {
    const v = video.current;
    v?.pause();
    resetComposer();
    setTFrom(round1(v?.currentTime ?? now));
    setComposing(true);
  };
  const saveNote = () => {
    const input = { kind, tFrom, tTo, text: text.trim() };
    if (!input.text) return;
    if (editingId) edit.mutate({ id: editingId, ...input }, { onSuccess: resetComposer });
    else add.mutate(input, { onSuccess: resetComposer });
  };
  const startEdit = (n: ReviewNote) => {
    setKind(n.kind);
    setTFrom(n.tFrom);
    setTTo(n.tTo);
    setText(n.text);
    setEditingId(n.id);
    setComposing(true);
    setTab("notes");
  };
  const doSend = async () => {
    if (voiceDirty && curVoice) await saveVoice.mutateAsync(curVoice);
    send.mutate(orderId);
  };

  const drafts = st?.drafts ?? [];
  const rounds = st?.rounds ?? [];
  const marks: ReviewNote[] = [...drafts, ...rounds.flatMap((r) => r.notes)].filter((n) => n.tFrom !== null);
  const saveErr = add.error ?? edit.error ?? del.error;
  const canSend = (st?.canSend ?? false) || voiceDirty;

  return (
    <div role="dialog" aria-modal="true" aria-label="Работа с видео" className="fixed inset-0 z-50 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-md space-y-3 p-4 pb-28">
        <div className="flex items-start gap-2">
          <h2 className="type-title-m min-w-0 flex-1">🎬 Работа с видео · {media.name}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="shrink-0 px-2 text-xl text-on-surface-variant">
            ✕
          </button>
        </div>

        <video
          ref={video}
          src={media.url}
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          onPlay={preview.start}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          onSeeked={(e) => setNow(e.currentTarget.currentTime)}
          className="mx-auto max-h-[50vh] w-full max-w-xs rounded-xl bg-black"
        />
        {duration > 0 ? (
          <div className="relative h-3 w-full rounded-full bg-surface-container-highest" aria-label="Заметки на шкале ролика">
            <div className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${Math.min(100, (now / duration) * 100)}%` }} />
            {marks.map((n) => {
              const left = ((n.tFrom ?? 0) / duration) * 100;
              const width = n.tTo !== null ? Math.max(1, ((n.tTo - (n.tFrom ?? 0)) / duration) * 100) : 1;
              const color = n.status === "draft" ? "bg-primary" : n.status === "done" ? "bg-success" : n.status === "wontdo" ? "bg-error" : "bg-warning";
              return (
                <button
                  key={n.id}
                  type="button"
                  title={`${span(n)} ${n.text}`}
                  onClick={() => seek(n.tFrom ?? 0)}
                  className={`absolute inset-y-0 min-w-1.5 rounded-full ${color}`}
                  style={{ left: `${Math.min(99, left)}%`, width: `${width}%` }}
                />
              );
            })}
          </div>
        ) : null}

        <div className="flex gap-1 rounded-full bg-surface-container-high p-1 text-sm font-semibold">
          {(
            [
              ["notes", `📝 Заметки${drafts.length ? ` ${drafts.length}` : ""}`],
              ["sound", `🔊 Звук${voiceDirty ? " •" : ""}`],
              ["chat", `💬 Ответы${rounds.length ? ` ${rounds.length}` : ""}`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 whitespace-nowrap rounded-full py-1.5 text-[13px] ${tab === k ? "bg-primary text-on-primary" : "text-on-surface"}`}>
              {label}
            </button>
          ))}
        </div>

        {q.isPending ? <p className="text-sm text-on-surface-variant">Загружаю…</p> : null}
        {q.isError ? <p className="text-sm text-error">{q.error.message}</p> : null}

        {tab === "notes" ? (
          <div className="space-y-3">
            {composing ? (
              <form
                className="space-y-2.5 rounded-lg bg-surface-container-high p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveNote();
                }}
              >
                <div className="flex flex-wrap gap-1">
                  {REVIEW_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${kind === k ? "bg-primary text-on-primary" : "bg-surface-container-highest text-on-surface"}`}
                    >
                      {REVIEW_KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {tFrom === null ? (
                    <button type="button" onClick={() => setTFrom(round1(now))} className="rounded-full bg-surface-container-highest px-3 py-1 text-xs font-semibold">
                      ⏱ Привязать к {formatTime(now)}
                    </button>
                  ) : (
                    <>
                      <span className="text-on-surface-variant">Начало</span>
                      <button type="button" onClick={() => seek(tFrom)} className="rounded-m3xs bg-primary/20 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                        {formatTime(tFrom)}
                      </button>
                      <button type="button" onClick={() => setTFrom(round1(now))} className="text-xs text-primary">
                        ⟲ на {formatTime(now)}
                      </button>
                      <span className="text-on-surface-variant">· Конец</span>
                      {tTo === null ? (
                        <button
                          type="button"
                          disabled={now <= tFrom}
                          onClick={() => setTTo(round1(now))}
                          className="rounded-full bg-surface-container-highest px-3 py-1 text-xs font-semibold disabled:opacity-40"
                          title="Включите ролик, остановите в конце куска и нажмите"
                        >
                          Отметить {formatTime(now)}
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => seek(tTo)} className="rounded-m3xs bg-primary/20 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                            {formatTime(tTo)}
                          </button>
                          <button type="button" onClick={() => setTTo(null)} aria-label="Убрать конец" className="text-xs text-on-surface-variant">
                            ✕
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setTFrom(null);
                          setTTo(null);
                        }}
                        className="text-xs text-on-surface-variant underline"
                      >
                        без времени
                      </button>
                    </>
                  )}
                </div>
                <textarea
                  autoFocus
                  rows={3}
                  maxLength={REVIEW_TEXT_MAX}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Что поправить? Например: этот кусок убрать, тут кадр темноват, слово в субтитре с ошибкой"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
                />
                {saveErr ? <p className="text-xs text-error">{saveErr.message}</p> : null}
                <div className="flex gap-3">
                  <button type="submit" disabled={!text.trim() || add.isPending || edit.isPending} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40">
                    {editingId ? "Сохранить" : "Добавить"}
                  </button>
                  <button type="button" onClick={resetComposer} className="text-sm text-on-surface-variant">
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={startNote} className="w-full rounded-full bg-surface-container-highest py-2.5 text-sm font-bold text-on-surface">
                + Заметка на {formatTime(now)}
              </button>
            )}

            {drafts.length ? (
              <ul className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
                {drafts.map((n) => (
                  <NoteLine
                    key={n.id}
                    n={n}
                    onSeek={seek}
                    actions={
                      <>
                        <button type="button" onClick={() => startEdit(n)} aria-label="Изменить заметку" className="px-1 text-on-surface-variant">
                          ✎
                        </button>
                        <button type="button" onClick={() => del.mutate(n.id)} aria-label="Удалить заметку" className="px-1 text-on-surface-variant">
                          ✕
                        </button>
                      </>
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-on-surface-variant">
                Поставьте ролик на паузу и нажмите «+ Заметка» — время подставится. Для куска: отметьте начало, включите ролик, остановите в конце и нажмите «Отметить». Заметки сохраняются сразу и видны с телефона и с Мака.
              </p>
            )}
          </div>
        ) : null}

        {tab === "sound" && curVoice ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-lg bg-surface-container-high p-2.5 text-sm">
              <input type="checkbox" checked={listen} onChange={(e) => setListen(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              <span>🎧 Слушать с настройками {listen ? "(включено)" : "(выключено — как в ролике)"}</span>
            </label>
            {preview.failed ? <p className="text-xs text-warning">Этот браузер не умеет менять звук на лету — настройки всё равно сохранятся.</p> : null}
            {VOICE_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <p className="text-sm font-semibold text-on-surface">
                  {f.label} {f.live ? null : <span className="text-xs font-normal text-on-surface-variant">— услышите в новой версии</span>}
                </p>
                <Seg options={f.options} value={curVoice[f.key]} onChange={(v) => setVoice({ ...curVoice, [f.key]: v })} />
              </div>
            ))}
            <textarea
              rows={2}
              maxLength={1000}
              value={curVoice.comment ?? ""}
              onChange={(e) => setVoice({ ...curVoice, comment: e.target.value })}
              placeholder="Своими словами: как должен звучать ролик («голос ближе, без эха, музыка еле слышно»)"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
            />
            <p className="text-xs text-on-surface-variant">
              Сейчас у ролика: {st?.voice ? "свои настройки" : "мои настройки по умолчанию"}
              {voiceDirty ? " · есть несохранённые изменения" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saveVoice.isPending} onClick={() => saveVoice.mutate(curVoice)} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40">
                Сохранить для этого ролика
              </button>
              <button
                type="button"
                disabled={saveDefault.isPending}
                onClick={() => saveDefault.mutate(curVoice)}
                className="rounded-full bg-surface-container-highest px-4 py-1.5 text-sm font-bold text-on-surface disabled:opacity-40"
              >
                Сделать моими по умолчанию
              </button>
              {st?.voice ? (
                <button
                  type="button"
                  onClick={() => {
                    setVoice(st.voiceDefault);
                    saveVoice.mutate(null);
                  }}
                  className="text-sm text-on-surface-variant underline"
                >
                  Вернуть мои по умолчанию
                </button>
              ) : null}
            </div>
            {saveDefault.isSuccess ? <p className="text-xs text-success">Сохранено как ваши настройки по умолчанию — применяю ко всем новым роликам.</p> : null}
            {saveVoice.error ?? saveDefault.error ? <p className="text-xs text-error">{(saveVoice.error ?? saveDefault.error)?.message}</p> : null}
          </div>
        ) : null}

        {tab === "chat" ? (
          <div className="space-y-3">
            {rounds.length ? rounds.map((r) => <RoundCard key={r.id} r={r} onSeek={seek} />) : <p className="text-sm text-on-surface-variant">Здесь будут отправленные правки и мои ответы на каждую.</p>}
          </div>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-outline-variant bg-surface-container p-3">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <button
            type="button"
            disabled={!canSend || send.isPending || saveVoice.isPending}
            onClick={() => void doSend()}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-on-primary disabled:opacity-40"
          >
            {send.isPending ? "Отправляю…" : `Отправить Claude${drafts.length ? ` (${drafts.length})` : ""}`}
          </button>
          <p className="min-w-0 flex-1 text-xs text-on-surface-variant">
            {send.isSuccess && !canSend ? "Отправлено. Ответ придёт в «Ответы» и в Telegram." : send.error ? send.error.message : canSend ? `Уйдут заметки${voiceDirty || st?.voice ? " и звук" : ""}` : "Добавьте заметку или измените звук"}
          </p>
        </div>
      </div>
    </div>
  );
}
