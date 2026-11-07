import { useHealth } from "../../api/hooks";
import { Card, Skeleton, StatusDot } from "../../components/ui/Card";

/** Состояние системы: база, хранилище, секреты. */
export function StatusPage() {
  const q = useHealth();

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
    </Card>
  );
}
