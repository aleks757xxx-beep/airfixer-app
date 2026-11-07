import { useHealth } from "../../api/hooks";
import { Card, Skeleton, StatusDot } from "../../components/ui/Card";
import { useLogout } from "../../api/auth";
import { useState } from "react";
import { useSaveSettings, useSettings } from "../../api/settings";
import { useBufferLimits, useChannels } from "../../api/publish";

/** Тариф Buffer: сколько каналов разрешено, заблокированные каналы, запланированные посты. */
function BufferPlan() {
  const lim = useBufferLimits();
  const ch = useChannels();
  if (lim.isPending || ch.isPending) return <p className="mt-5 border-t border-white/10 pt-4 text-sm text-white/50">Тариф Buffer: загружаю…</p>;
  if (lim.isError) return <p className="mt-5 border-t border-white/10 pt-4 text-sm text-red-400">Тариф Buffer: {lim.error.message}</p>;
  const chans = ch.data?.items ?? [];
  const locked = chans.filter((c) => c.isLocked);
  const over = chans.length > lim.data.channels;
  return (
    <div className="mt-5 space-y-1.5 border-t border-white/10 pt-4 text-sm">
      <p className="font-semibold">Тариф Buffer</p>
      <p className={over ? "text-amber-300" : ""}>
        Каналов: подключено {chans.length}, по тарифу можно {lim.data.channels}
        {over ? " — лишние Buffer блокирует" : ""}
      </p>
      {locked.length > 0 ? <p className="text-amber-300">🔒 Заблокированы: {locked.map((c) => c.displayName || c.name).join(", ")}</p> : null}
      <p>
        Запланировано постов: {lim.data.scheduledNow} из {lim.data.scheduledPosts}
      </p>
    </div>
  );
}

/** Ссылка на чат с Claude, который открывает кнопка «💬 Claude». */
function ClaudeLinkSetting() {
  const q = useSettings();
  const save = useSaveSettings();
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? q.data?.claudeUrl ?? "";
  return (
    <form
      className="mt-5 space-y-2 border-t border-white/10 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ claudeUrl: current.trim() }, { onSuccess: () => setValue(null) });
      }}
    >
      <label htmlFor="claude-url" className="block font-semibold">
        Чат с Claude (кнопка «💬 Claude»)
      </label>
      <p className="text-sm text-white/55">
        Если начнёте новый чат с Claude: откройте его, скопируйте адрес из строки браузера (или «Поделиться» → «Скопировать ссылку»)
        и вставьте сюда.
      </p>
      <input
        id="claude-url"
        type="url"
        inputMode="url"
        value={current}
        onChange={(e) => setValue(e.target.value)}
        disabled={q.isPending}
        className="w-full rounded-lg border border-white/15 bg-ink-deep p-2 text-sm text-white focus:border-brand focus:outline-none"
      />
      {save.isError ? <p className="text-sm text-red-400">{save.error.message}</p> : null}
      {save.isSuccess && value === null ? <p className="text-sm text-wa">Сохранено ✓</p> : null}
      <button
        type="submit"
        disabled={save.isPending || value === null}
        className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
      >
        Сохранить
      </button>
    </form>
  );
}

/** Состояние системы: база, хранилище, секреты. */
export function StatusPage() {
  const q = useHealth();
  const logoutAll = useLogout(true);

  if (q.isPending) {
    return (
      <Card title="Состояние">
        <div className="space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      </Card>
    );
  }
  if (q.isError) {
    return (
      <Card title="Состояние">
        <p className="text-red-500">{q.error.message}</p>
        <button type="button" className="mt-3 text-sm text-brand underline" onClick={() => void q.refetch()}>
          Повторить
        </button>
      </Card>
    );
  }
  const h = q.data;
  const rows: ReadonlyArray<{ ok: boolean; label: string }> = [
    { ok: h.db.ok, label: `База данных (схема v${h.db.migration})` },
    { ok: h.storage.ok, label: "Хранилище видео" },
    { ok: h.buffer.ok, label: h.buffer.ok ? "Связь с Buffer" : `Связь с Buffer: ${h.buffer.error ?? "нет"}` },
    { ok: h.secrets.appPassword, label: "Секрет APP_PASSWORD" },
    { ok: h.secrets.bufferApiKey, label: "Секрет BUFFER_API_KEY" },
    { ok: h.secrets.uploadToken, label: "Секрет UPLOAD_TOKEN" },
  ];
  return (
    <Card title={`Состояние · версия ${h.version}`}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <StatusDot ok={r.ok} />
            <span>{r.label}</span>
            <span className="ml-auto text-sm text-slate-500 dark:text-white/60">{r.ok ? "в порядке" : "нет"}</span>
          </li>
        ))}
      </ul>
      <BufferPlan />
      <ClaudeLinkSetting />
      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-white/10">
        <button
          type="button"
          disabled={logoutAll.isPending}
          onClick={() => {
            if (window.confirm("Выйти на всех устройствах? Код из приложения понадобится снова везде.")) logoutAll.mutate();
          }}
          className="text-sm font-semibold text-red-500"
        >
          Выйти на всех устройствах (потерял телефон)
        </button>
      </div>
    </Card>
  );
}
