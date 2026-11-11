import { useEffect, useRef, useState } from "react";
import { NOTE_MAX } from "../../../shared/schemas";

/**
 * Правки по секундам (решение владельца 11.11.2026): смотрите ролик, ставите паузу, пишете заметку —
 * она привязывается к секунде. «Отправить правки Claude» собирает их в один текст.
 * Пока не отправлено — заметки хранятся в этом браузере (переживают перезагрузку страницы).
 */
export interface TimeNote {
  id: string;
  t: number;
  text: string;
}

export const formatTime = (t: number): string => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function notesToText(notes: ReadonlyArray<TimeNote>, general: string): string {
  const lines = [...notes].sort((a, b) => a.t - b.t).map((n) => `${formatTime(n.t)} — ${n.text.trim()}`);
  const parts: string[] = [];
  if (lines.length) parts.push("Правки по секундам:", ...lines);
  if (general.trim()) {
    if (lines.length) parts.push("");
    parts.push(`Общее: ${general.trim()}`);
  }
  return parts.join("\n");
}

const storeKey = (k: string) => `postfixer.timenotes.${k}`;
function load(k: string): { notes: TimeNote[]; general: string } {
  try {
    const raw = window.localStorage.getItem(storeKey(k));
    if (!raw) return { notes: [], general: "" };
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && "notes" in v && Array.isArray(v.notes)) {
      const notes = v.notes.filter(
        (n: unknown): n is TimeNote =>
          !!n && typeof n === "object" && "id" in n && "t" in n && "text" in n && typeof n.id === "string" && typeof n.t === "number" && typeof n.text === "string",
      );
      const general = "general" in v && typeof v.general === "string" ? v.general : "";
      return { notes, general };
    }
  } catch {
    /* хранилище недоступно — просто начинаем с пустого */
  }
  return { notes: [], general: "" };
}
function save(k: string, notes: TimeNote[], general: string) {
  try {
    if (notes.length || general.trim()) window.localStorage.setItem(storeKey(k), JSON.stringify({ notes, general }));
    else window.localStorage.removeItem(storeKey(k));
  } catch {
    /* без хранилища заметки живут до закрытия страницы */
  }
}

export function TimeNotes({
  url,
  storageKey,
  sending,
  error,
  sendLabel = "Отправить правки Claude",
  onSend,
  onDone,
}: {
  url: string;
  storageKey: string;
  sending: boolean;
  error: string | null;
  sendLabel?: string;
  onSend: (text: string, clear: () => void) => void;
  onDone?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [{ notes, general }, setState] = useState(() => load(storageKey));
  const [now, setNow] = useState(0);
  const [draft, setDraft] = useState<{ t: number; text: string } | null>(null);

  useEffect(() => save(storageKey, notes, general), [storageKey, notes, general]);

  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const text = notesToText(notes, general);
  const tooLong = text.length > NOTE_MAX;

  const startNote = () => {
    const v = video.current;
    v?.pause();
    setDraft({ t: v?.currentTime ?? now, text: "" });
  };
  const addNote = () => {
    if (!draft?.text.trim()) return;
    setState((s) => ({ ...s, notes: [...s.notes, { id: crypto.randomUUID(), t: draft.t, text: draft.text.trim() }] }));
    setDraft(null);
  };
  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    v.pause();
  };

  return (
    <div className="space-y-3">
      <video
        ref={video}
        src={url}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onSeeked={(e) => setNow(e.currentTarget.currentTime)}
        className="mx-auto max-h-[55vh] w-full max-w-xs rounded-xl bg-black"
      />

      {draft ? (
        <form
          className="space-y-2 rounded-lg bg-surface-container-high p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            addNote();
          }}
        >
          <p className="text-xs font-semibold text-primary">Заметка на {formatTime(draft.t)}</p>
          <input
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            maxLength={300}
            placeholder="Например: этот кусок короче на 2 секунды"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
          />
          <div className="flex gap-3">
            <button type="submit" disabled={!draft.text.trim()} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40">
              Добавить
            </button>
            <button type="button" onClick={() => setDraft(null)} className="text-sm text-on-surface-variant">
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={startNote} className="w-full rounded-full bg-surface-container-highest py-2 text-sm font-bold text-on-surface">
          + Заметка на {formatTime(now)}
        </button>
      )}

      {sorted.length ? (
        <ul className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
          {sorted.map((n) => (
            <li key={n.id} className="flex items-start gap-2 p-2 text-sm">
              <button type="button" onClick={() => seek(n.t)} className="shrink-0 rounded-m3xs bg-primary/20 px-1.5 py-0.5 font-mono text-xs font-bold text-primary" title="Перемотать сюда">
                {formatTime(n.t)}
              </button>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-on-surface">{n.text}</span>
              <button
                type="button"
                aria-label="Удалить заметку"
                onClick={() => setState((s) => ({ ...s, notes: s.notes.filter((x) => x.id !== n.id) }))}
                className="shrink-0 px-1 text-on-surface-variant"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-on-surface-variant">Поставьте ролик на паузу в нужном месте и нажмите «+ Заметка» — время подставится само.</p>
      )}

      <textarea
        rows={2}
        maxLength={600}
        value={general}
        onChange={(e) => setState((s) => ({ ...s, general: e.target.value }))}
        placeholder="Общее (необязательно): «в целом ок, но музыка громковата»"
        className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
      />

      {tooLong ? <p className="text-xs text-error">Слишком много текста — сократите заметки (до {NOTE_MAX} знаков вместе).</p> : null}
      {error ? <p className="text-xs text-error">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={sending || !text || tooLong}
          onClick={() => onSend(text, () => setState({ notes: [], general: "" }))}
          className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40"
        >
          {sending ? "Отправляю…" : `${sendLabel}${notes.length ? ` (${notes.length})` : ""}`}
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className="text-sm text-on-surface-variant">
            Закрыть (заметки сохранятся)
          </button>
        ) : null}
      </div>
    </div>
  );
}
