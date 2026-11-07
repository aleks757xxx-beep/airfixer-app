import { useEffect, useState } from "react";
import { DEFAULT_CLAUDE_URL, type MediaItem } from "../../../shared/schemas";
import { useSettings } from "../../api/settings";
import { formatBytes, formatDate } from "../../lib/format";

/** Текст о ролике, который вставляется в чат с Claude. */
export function mediaBrief(item: MediaItem): string {
  const lines = [
    `PostFixer · ролик «${item.name}»`,
    `id: ${item.id} · ${formatBytes(item.size)} · ${item.source === "gotovoe" ? "из «Готового»" : "загружен вручную"} · ${formatDate(item.createdAt)}`,
  ];
  if (item.note) lines.push(`Задание: ${item.note}`);
  lines.push("", "");
  return lines.join("\n");
}

type Toast = { text: string } | null;
let showToast: (t: Toast) => void = () => {};

/** Всплывающая подсказка «скопировано» (одна на приложение). */
export function ClaudeToast() {
  const [toast, setToast] = useState<Toast>(null);
  useEffect(() => {
    showToast = setToast;
    return () => {
      showToast = () => {};
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-30 mx-auto max-w-md rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-ink shadow-xl md:bottom-6"
    >
      {toast.text}
    </div>
  );
}

/**
 * Кнопка «Обсудить с Claude»: копирует текст (если есть) и открывает чат с Claude.
 * Открываем окно сразу в обработчике нажатия — иначе Safari на iPhone блокирует.
 */
export function useAskClaude() {
  const settings = useSettings();
  const url = settings.data?.claudeUrl ?? DEFAULT_CLAUDE_URL;
  return (text?: string) => {
    if (text) {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => showToast({ text: "Скопировано ✓ В чате с Claude: нажмите в поле сообщения → «Вставить»" }))
        .catch(() => showToast({ text: "Не удалось скопировать — напишите в чате название ролика" }));
    }
    window.open(url, "_blank", "noopener");
  };
}

export function AskClaudeButton({ item, className = "" }: { item?: MediaItem; className?: string }) {
  const ask = useAskClaude();
  return (
    <button type="button" onClick={() => ask(item ? mediaBrief(item) : undefined)} className={className}>
      💬 {item ? "Обсудить с Claude" : "Claude"}
    </button>
  );
}
