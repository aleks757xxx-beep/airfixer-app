import { useState } from "react";
import type { Snippet } from "../../../shared/schemas";
import { useDeleteSnippet, useSaveSnippet, useSnippets } from "../../api/publish";

const input =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none";

/** Вставки: наборы хэштегов и подвалы (хранятся в Buffer как сниппеты). */
export function SnippetsDialog({ onClose }: { onClose: () => void }) {
  const list = useSnippets();
  const save = useSaveSnippet();
  const del = useDeleteSnippet();
  const [edit, setEdit] = useState<Partial<Snippet> | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 md:items-center" role="dialog" aria-modal="true" aria-label="Вставки">
      <div className="max-h-[100dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl bg-surface-container p-4 md:max-h-[90vh] md:rounded-m3xl">
        <header className="flex items-center">
          <h2 className="text-lg font-bold">Вставки</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1 text-on-surface-variant hover:bg-surface-container-highest" aria-label="Закрыть">
            ✕
          </button>
        </header>
        <p className="text-sm text-on-surface-variant">Наборы хэштегов, контакты, подвалы — вставляются в подпись одним нажатием. Хранятся в Buffer.</p>
        {list.isError ? <p className="text-sm text-error">{list.error.message}</p> : null}
        {edit ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { ...(edit.id ? { id: edit.id } : {}), name: edit.name ?? "", text: edit.text ?? "" },
                { onSuccess: () => setEdit(null) },
              );
            }}
          >
            <input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Название, например «Хэштеги: установка»" maxLength={100} className={input} />
            <textarea value={edit.text ?? ""} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={5} placeholder="Текст вставки" className={input} />
            {save.isError ? <p className="text-sm text-error">{save.error.message}</p> : null}
            <div className="flex gap-3">
              <button type="submit" disabled={save.isPending} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary disabled:opacity-40">
                {save.isPending ? "Сохраняю…" : "Сохранить"}
              </button>
              <button type="button" onClick={() => setEdit(null)} className="text-sm text-on-surface-variant">
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setEdit({})} className="rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-on-primary">
            + Новая вставка
          </button>
        )}
        <ul className="space-y-2">
          {(list.data?.items ?? []).map((s) => (
            <li key={s.id} className="rounded-xl border border-outline-variant p-2.5">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{s.name}</p>
                <button type="button" onClick={() => setEdit(s)} className="ml-auto text-xs font-semibold text-primary">
                  Изменить
                </button>
                <button
                  type="button"
                  disabled={del.isPending}
                  onClick={() => window.confirm(`Удалить вставку «${s.name}»?`) && del.mutate(s.id)}
                  className="text-xs font-semibold text-error"
                >
                  Удалить
                </button>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-on-surface-variant">{s.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
