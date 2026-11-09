import { useMemo, useState } from "react";
import type { RepostList } from "../../../shared/schemas";
import { useChannels, useReposts } from "../../api/publish";
import { formatDate } from "../../lib/format";
import { ComposeDialog } from "../publish/ComposeDialog";
import { ServiceBadge, channelLabel } from "../publish/channels";

type Item = RepostList["items"][number];
const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);

/**
 * «Можно повторить» — ролики с галочкой «можно повторять» (решение владельца 08.11.2026, только список).
 * В соцсеть, где ролика не было, — сразу; где был — через gapDays. Кнопка «Повторить» открывает окно поста.
 */
export function Reposts() {
  const q = useReposts();
  const channels = useChannels();
  const byId = useMemo(() => new Map((channels.data?.items ?? []).map((c) => [c.id, c])), [channels.data]);
  const [composing, setComposing] = useState<Item | null>(null);
  const items = q.data?.items ?? [];
  if (q.isPending || items.length === 0) return null;
  const name = (id: string) => {
    const c = byId.get(id);
    return c ? channelLabel(c) : id;
  };
  const svc = (id: string) => byId.get(id)?.service ?? "";
  return (
    <section className="rounded-m3m border border-outline-variant bg-surface-container p-3">
      <h2 className="type-title-m">Можно повторить</h2>
      <p className="type-body-s mt-1 text-on-surface-variant">
        Ролики с галочкой «можно повторять». В соцсеть, где ролика не было, — сразу; где был — через {q.data?.gapDays ?? 90} дней. Сверху — самые удачные.
      </p>
      <p className="type-body-s mt-1 font-semibold text-warning">
        Перед повтором смените подпись и начало ролика (первые секунды) — иначе Instagram сочтёт его копией и не покажет новым людям.
      </p>
      <ul className="mt-3 divide-y divide-outline-variant">
        {items.map((it) => (
          <li key={it.media.id} className="flex gap-3 py-3">
            <video src={`${it.media.url}#t=1`} preload="metadata" muted playsInline className="h-24 w-14 shrink-0 rounded-m3s bg-black object-cover" />
            <div className="min-w-0 flex-1">
              <p className="type-title-s line-clamp-2">{it.media.name}</p>
              <p className="type-body-s mt-0.5 text-on-surface-variant">
                {it.best
                  ? `Лучший результат: ${fmt(it.best.views)} просм.${it.best.ratio ? ` (×${it.best.ratio} к обычному)` : ""} — ${name(it.best.channelId)}`
                  : it.history.length
                    ? `Выходил ${it.history.length} раз, цифр пока нет`
                    : "Ещё не выходил"}
              </p>
              {it.ready.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {it.ready.map((id) => (
                    <span key={id} className="type-label-s inline-flex items-center gap-1 rounded-m3xs bg-secondary-container px-1.5 py-0.5 text-on-secondary-container">
                      <ServiceBadge service={svc(id)} /> {name(id)}
                    </span>
                  ))}
                </div>
              ) : null}
              {it.later.length ? (
                <p className="type-body-s mt-1 text-on-surface-variant">
                  Позже: {it.later.map((l) => `${name(l.channelId)} — с ${formatDate(l.from)}`).join("; ")}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 self-center">
              <button
                type="button"
                disabled={it.ready.length === 0}
                onClick={() => setComposing(it)}
                className="state-layer type-label-l rounded-full bg-primary px-4 py-2 text-on-primary disabled:opacity-40"
              >
                Повторить
              </button>
            </div>
          </li>
        ))}
      </ul>
      {composing ? (
        <ComposeDialog
          media={composing.media}
          preset={{ channelIds: composing.ready, text: composing.lastText ?? "", title: composing.lastTitle ?? undefined }}
          onClose={() => setComposing(null)}
        />
      ) : null}
    </section>
  );
}
