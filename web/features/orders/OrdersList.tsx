import { useState } from "react";
import { NOTE_MAX, type Order, type OrderEvent, type OrderStatus } from "../../../shared/schemas";
import { useOrderAction, useOrders } from "../../api/orders";
import { formatDateTime, formatShootDate } from "../../lib/format";
import { AskClaudeButton } from "../claude/askClaude";

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  new: { label: "Новый — ждёт Claude", cls: "bg-amber-400/15 text-amber-300" },
  in_work: { label: "Claude монтирует", cls: "bg-brand/20 text-brand-light" },
  draft: { label: "Черновик готов — посмотрите", cls: "bg-wa/15 text-wa" },
  revise: { label: "Правки — ждёт Claude", cls: "bg-amber-400/15 text-amber-300" },
  accepted: { label: "Принят ✓", cls: "bg-white/10 text-white/60" },
  cancelled: { label: "Отменён", cls: "bg-white/10 text-white/40" },
};

export function orderBrief(o: Order): string {
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
      <p className="text-xs text-white/45">
        <span className="font-semibold text-white/75">{head[e.kind]}</span> · {formatDateTime(e.createdAt)}
      </p>
      {e.text ? <p className="whitespace-pre-wrap text-sm text-white/85">{e.text}</p> : null}
      {e.kind === "draft" ? (
        e.media ? (
          latest ? (
            <video src={e.media.url} controls playsInline preload="metadata" className="max-h-[60vh] w-full max-w-xs rounded-xl bg-black" />
          ) : (
            <a href={e.media.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-light">
              ▶ Смотреть v{draftNo}
            </a>
          )
        ) : (
          <p className="text-xs text-white/40">Файл черновика удалён из библиотеки</p>
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
    <article className="space-y-3 rounded-2xl border border-white/10 bg-ink-card p-3">
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">
            Монтаж #{o.id}
            {o.shootDate ? ` · ${formatShootDate(o.shootDate)}` : ""}
            {o.folder ? ` · ${o.folder}` : ""}
          </h3>
          <p className="text-xs text-white/50">
            {[o.durationSec ? `${o.durationSec} с` : null, o.style].filter(Boolean).join(" · ") || "длина и стиль — на усмотрение Claude"}
          </p>
        </div>
        <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
      </header>
      <p className="whitespace-pre-wrap text-sm">{o.brief}</p>

      <ol className="space-y-3 border-l border-white/10 pl-3">
        {o.events
          .filter((e) => e.kind !== "created")
          .map((e) => (
            <EventLine key={e.id} e={e} draftNo={e.kind === "draft" ? ++drafts : drafts} latest={e.id === lastDraftId} />
          ))}
      </ol>

      {act.isError ? <p className="text-sm text-red-400">{act.error.message}</p> : null}

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
            className="w-full rounded-lg border border-white/15 bg-ink-deep p-2.5 text-sm text-white placeholder:text-white/35 focus:border-brand focus:outline-none"
          />
          <div className="flex gap-3">
            <button type="submit" disabled={act.isPending || !text.trim()} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40">
              {act.isPending ? "Отправляю…" : "Отправить"}
            </button>
            <button type="button" onClick={() => setMode(null)} className="text-sm text-white/55">
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
              <button type="button" onClick={() => setMode("revise")} className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-bold">
                ✎ Правки
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setMode("comment")} className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold">
              ✎ Дописать
            </button>
          )}
          <AskClaudeButton text={orderBrief(o)} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white" />
          <button
            type="button"
            disabled={act.isPending}
            onClick={() => {
              if (window.confirm(`Отменить заказ монтажа #${o.id}?`)) act.mutate({ id: o.id, action: "cancel" });
            }}
            className="ml-auto text-xs text-red-400"
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
  if (q.isError) return <p className="text-sm text-red-400">Заказы: {q.error.message}</p>;
  const open = q.data.items.filter((o) => o.status !== "accepted" && o.status !== "cancelled");
  const closed = q.data.items.filter((o) => o.status === "accepted" || o.status === "cancelled");
  if (open.length === 0 && closed.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Заказы монтажа">
      {open.map((o) => (
        <OrderCard key={o.id} o={o} />
      ))}
      {closed.length > 0 ? (
        <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-sm font-semibold text-white/55">
          {showClosed ? "▾" : "▸"} Завершённые заказы ({closed.length})
        </button>
      ) : null}
      {showClosed ? closed.map((o) => <OrderCard key={o.id} o={o} />) : null}
    </section>
  );
}
