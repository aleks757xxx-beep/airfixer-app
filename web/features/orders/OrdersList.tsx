import { useState } from "react";
import { NOTE_MAX, type Order, type OrderEvent, type OrderStatus } from "../../../shared/schemas";
import { useOrderAction, useOrders } from "../../api/orders";
import { formatDateTime, formatShootDate } from "../../lib/format";
import { AskClaudeButton } from "../claude/askClaude";

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  new: { label: "Новый — ждёт Claude", cls: "bg-warning-container text-warning" },
  in_work: { label: "Claude монтирует", cls: "bg-primary/20 text-primary" },
  draft: { label: "Черновик готов — посмотрите", cls: "bg-success-container text-success" },
  revise: { label: "Правки — ждёт Claude", cls: "bg-warning-container text-warning" },
  accepted: { label: "Принят ✓", cls: "bg-surface-container-highest text-on-surface-variant" },
  cancelled: { label: "Отменён", cls: "bg-surface-container-highest text-on-surface-variant" },
};

function orderBrief(o: Order): string {
  const lines = [`PostFixer · заказ монтажа #${o.id} (${STATUS[o.status].label})`];
  if (o.shootDate) lines.push(`Дата съёмки: ${formatShootDate(o.shootDate)}`);
  if (o.folder) lines.push(`Папка: ${o.folder}`);
  lines.push(`Задача: ${o.brief}`);
  if (o.durationSec) lines.push(`Длина: ${o.durationSec} с`);
  if (o.style) lines.push(`Стиль: ${o.style}`);
  const lastRevise = [...o.events].reverse().find((e) => e.kind === "revise");
  if (o.status === "revise" && lastRevise?.text) lines.push(`Правки: ${lastRevise.text}`);
  lines.push("", "");
  return lines.join("\n");
}

function EventLine({ e, draftNo, latest }: { e: OrderEvent; draftNo: number; latest: boolean }) {
  const who = e.author === "claude" ? "Claude" : "Вы";
  const head: Record<OrderEvent["kind"], string> = {
    created: "Заказ создан",
    in_work: "Claude взял в работу",
    comment: who,
    draft: `Черновик v${draftNo}`,
    revise: "Ваши правки",
    accepted: "Вы приняли ролик",
    cancelled: "Заказ отменён",
  };
  return (
    <li className="space-y-1.5">
      <p className="text-xs text-on-surface-variant">
        <span className="font-semibold text-on-surface-variant">{head[e.kind]}</span> · {formatDateTime(e.createdAt)}
      </p>
      {e.text ? <p className="whitespace-pre-wrap text-sm text-on-surface">{e.text}</p> : null}
      {e.kind === "draft" ? (
        e.media ? (
          latest ? (
            <video src={e.media.url} controls playsInline preload="metadata" className="max-h-[60vh] w-full max-w-xs rounded-xl bg-black" />
          ) : (
            <a href={e.media.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary">
              ▶ Смотреть v{draftNo}
            </a>
          )
        ) : (
          <p className="text-xs text-on-surface-variant">Файл черновика удалён из библиотеки</p>
        )
      ) : null}
    </li>
  );
}

function OrderCard({ o }: { o: Order }) {
  const act = useOrderAction();
  const [mode, setMode] = useState<"revise" | "comment" | null>(null);
  const [text, setText] = useState("");
  const open = o.status !== "accepted" && o.status !== "cancelled";
  let drafts = 0;
  const lastDraftId = [...o.events].reverse().find((e) => e.kind === "draft")?.id;

  return (
    <article className="space-y-3 rounded-m3m border border-outline-variant bg-surface-container p-3">
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">
            Монтаж #{o.id}
            {o.shootDate ? ` · ${formatShootDate(o.shootDate)}` : ""}
            {o.folder ? ` · ${o.folder}` : ""}
          </h3>
          <p className="text-xs text-on-surface-variant">
            {[o.durationSec ? `${o.durationSec} с` : null, o.style].filter(Boolean).join(" · ") || "длина и стиль — на усмотрение Claude"}
          </p>
        </div>
        <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
      </header>
      <p className="whitespace-pre-wrap text-sm">{o.brief}</p>

      <ol className="space-y-3 border-l border-outline-variant pl-3">
        {o.events
          .filter((e) => e.kind !== "created")
          .map((e) => (
            <EventLine key={e.id} e={e} draftNo={e.kind === "draft" ? ++drafts : drafts} latest={e.id === lastDraftId} />
          ))}
      </ol>

      {act.isError ? <p className="text-sm text-error">{act.error.message}</p> : null}

      {mode ? (
        <form
          className="space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            act.mutate(
              { id: o.id, action: mode, text: text.trim() },
              {
                onSuccess: () => {
                  setMode(null);
                  setText("");
                },
              },
            );
          }}
        >
          <textarea
            autoFocus
            required
            rows={3}
            maxLength={NOTE_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "revise" ? "Что поправить: «на 6 секунде отзеркалить, финал короче»" : "Сообщение для Claude"}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
          />
          <div className="flex gap-3">
            <button type="submit" disabled={act.isPending || !text.trim()} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40">
              {act.isPending ? "Отправляю…" : "Отправить"}
            </button>
            <button type="button" onClick={() => setMode(null)} className="text-sm text-on-surface-variant">
              Отмена
            </button>
          </div>
        </form>
      ) : open ? (
        <div className="flex flex-wrap items-center gap-2">
          {o.status === "draft" ? (
            <>
              <button
                type="button"
                disabled={act.isPending}
                onClick={() => act.mutate({ id: o.id, action: "accept" })}
                className="rounded-full bg-wa px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                ✓ Принять
              </button>
              <button type="button" onClick={() => setMode("revise")} className="rounded-full bg-surface-container-highest px-4 py-1.5 text-sm font-bold">
                ✎ Правки
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setMode("comment")} className="rounded-full bg-surface-container-highest px-4 py-1.5 text-sm font-semibold">
              ✎ Дописать
            </button>
          )}
          <AskClaudeButton text={orderBrief(o)} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary" />
          <button
            type="button"
            disabled={act.isPending}
            onClick={() => {
              if (window.confirm(`Отменить заказ монтажа #${o.id}?`)) act.mutate({ id: o.id, action: "cancel" });
            }}
            className="ml-auto text-xs text-error"
          >
            Отменить
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** Заказы монтажа: открытые сверху, закрытые свёрнуты. */
export function OrdersList() {
  const q = useOrders();
  const [showClosed, setShowClosed] = useState(false);
  if (q.isPending) return null;
  if (q.isError) return <p className="text-sm text-error">Заказы: {q.error.message}</p>;
  const open = q.data.items.filter((o) => o.status !== "accepted" && o.status !== "cancelled");
  const closed = q.data.items.filter((o) => o.status === "accepted" || o.status === "cancelled");
  if (open.length === 0 && closed.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Заказы монтажа">
      {open.map((o) => (
        <OrderCard key={o.id} o={o} />
      ))}
      {closed.length > 0 ? (
        <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-sm font-semibold text-on-surface-variant">
          {showClosed ? "▾" : "▸"} Завершённые заказы ({closed.length})
        </button>
      ) : null}
      {showClosed ? closed.map((o) => <OrderCard key={o.id} o={o} />) : null}
    </section>
  );
}
