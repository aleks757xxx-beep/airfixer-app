import { useHealth } from "../../api/hooks";
import { Card, Skeleton, StatusDot } from "../../components/ui/Card";
import { useLogout } from "../../api/auth";
import { useState } from "react";
import { useSaveSettings, useSettings } from "../../api/settings";
import { useBufferLimits, useChannels, useConnectTelegram, useDirectAccounts, useDisconnect } from "../../api/publish";
import { ServiceSquare } from "../publish/PostCard";

/** Соцсети напрямую (без Buffer): подключить Instagram и Facebook, список, отключить. */
function DirectConnections() {
  const q = useDirectAccounts();
  const disc = useDisconnect();
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const connected = params.get("connected");
  const error = params.get("connect_error");
  return (
    <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
      <p className="font-semibold">Публикация напрямую (без Buffer)</p>
      <p className="text-xs text-white/50">
        Instagram и Facebook публикуются прямо из PostFixer, без Buffer. Кнопка ниже откроет вход в Facebook: отметьте страницу и оба Instagram — после
        этого они появятся здесь списком. «Вместо Buffer» — этот канал больше не идёт через Buffer.
      </p>
      {connected === "meta" ? (
        <p className="rounded-lg bg-wa/15 p-2 text-wa">
          ✓ Подключено: {params.get("n")} аккаунт(ов), из них Instagram: {params.get("ig")}
        </p>
      ) : null}
      {error ? <p className="rounded-lg bg-red-500/15 p-2 text-red-300">⚠️ {error}</p> : null}
      {q.isError ? <p className="text-red-400">{q.error.message}</p> : null}
      <ul className="space-y-1.5">
        {(q.data?.items ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <ServiceSquare service={a.service} />
            <span>{a.displayName || a.name}</span>
            {a.replaces ? <span className="text-xs text-white/40">вместо Buffer</span> : null}
            <button
              type="button"
              disabled={disc.isPending}
              onClick={() => window.confirm(`Отключить ${a.name}? Запланированные прямые посты этого аккаунта удалятся.`) && disc.mutate(a.id)}
              className="ml-auto text-xs font-semibold text-red-400"
            >
              Отключить
            </button>
          </li>
        ))}
      </ul>
      {q.data && !q.data.meta.configured ? (
        <p className="text-amber-300">Чтобы подключить Instagram и Facebook, в Cloudflare нужны секреты META_APP_SECRET и TOKEN_KEY.</p>
      ) : null}
      <a
        href="/api/v2/connect/meta/start"
        className={`inline-block rounded-full px-4 py-2 font-bold text-white ${q.data?.meta.configured ? "bg-[#1877f2]" : "pointer-events-none bg-white/10 text-white/40"}`}
      >
        {(q.data?.items ?? []).some((a) => a.service === "instagram" || a.service === "facebook") ? "Переподключить Instagram и Facebook" : "Подключить Instagram и Facebook"}
      </a>
    </div>
  );
}

/** Telegram-канал: бот публикует ролики в канал. */
function TelegramConnect() {
  const q = useDirectAccounts();
  const conn = useConnectTelegram();
  const [address, setAddress] = useState("");
  const configured = q.data?.telegram?.configured ?? false;
  const channels = (q.data?.items ?? []).filter((a) => a.service === "telegram");
  return (
    <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
      <p className="font-semibold">Telegram-канал</p>
      <p className="text-xs text-white/50">
        Ролики уходят в ваш канал через бота. Бот принимает видео до 50 МБ: для больших роликов Claude при монтаже кладёт в «Готовое» лёгкую копию
        «имя.tg.mp4» — PostFixer возьмёт её сам. Подключённые каналы видны выше в списке «Публикация напрямую».
      </p>
      {!configured ? (
        <p className="text-amber-300">
          Нужен ключ бота: создайте бота у @BotFather в Telegram и добавьте ключ в Cloudflare как секрет TG_BOT_TOKEN.
        </p>
      ) : (
        <>
          <p className="text-xs text-white/50">
            Сделайте бота админом канала (право «Публикация сообщений»), затем нажмите кнопку. Если канал не найдётся — впишите его адрес, например @airfixer.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              conn.mutate(address.trim(), { onSuccess: () => setAddress("") });
            }}
          >
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="@адрес канала (можно пусто)"
              aria-label="Адрес канала Telegram"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-ink-deep p-2 text-sm text-white focus:border-brand focus:outline-none"
            />
            <button type="submit" disabled={conn.isPending} className="rounded-full bg-[#229ed9] px-4 py-2 font-bold text-white disabled:opacity-50">
              {conn.isPending ? "Ищу…" : channels.length ? "Подключить ещё канал" : "Подключить Telegram"}
            </button>
          </form>
        </>
      )}
      {conn.isError ? <p className="rounded-lg bg-red-500/15 p-2 text-red-300">⚠️ {conn.error.message}</p> : null}
      {conn.isSuccess ? <p className="rounded-lg bg-wa/15 p-2 text-wa">✓ Подключено: {conn.data.join(", ")}</p> : null}
      <TelegramButtonSetting />
    </div>
  );
}

/** Кнопка под каждым постом в Telegram (по умолчанию — «📅 Записаться» в бот записи). */
function TelegramButtonSetting() {
  const q = useSettings();
  const save = useSaveSettings();
  const [text, setText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const t = text ?? q.data?.tgButtonText ?? "";
  const u = url ?? q.data?.tgButtonUrl ?? "";
  const dirty = text !== null || url !== null;
  return (
    <form
      className="space-y-1.5 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ tgButtonText: t.trim(), tgButtonUrl: u.trim() }, { onSuccess: () => (setText(null), setUrl(null)) });
      }}
    >
      <p className="text-xs text-white/50">Кнопка под каждым постом в канале. Сотрите ссылку — постов без кнопки.</p>
      <div className="flex flex-wrap gap-2">
        <input
          value={t}
          onChange={(e) => setText(e.target.value)}
          aria-label="Текст кнопки"
          maxLength={40}
          className="w-40 rounded-lg border border-white/15 bg-ink-deep p-2 text-sm text-white focus:border-brand focus:outline-none"
        />
        <input
          value={u}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Ссылка кнопки"
          inputMode="url"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-ink-deep p-2 text-sm text-white focus:border-brand focus:outline-none"
        />
        <button type="submit" disabled={!dirty || save.isPending} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40">
          Сохранить
        </button>
      </div>
      {save.isError ? <p className="text-sm text-red-400">{save.error.message}</p> : null}
    </form>
  );
}

/** Тариф Buffer: сколько каналов разрешено, заблокированные каналы, запланированные посты. */
function BufferPlan() {
  const lim = useBufferLimits();
  const ch = useChannels();
  if (lim.isPending || ch.isPending) return <p className="mt-5 border-t border-white/10 pt-4 text-sm text-white/50">Тариф Buffer: загружаю…</p>;
  if (lim.isError) return <p className="mt-5 border-t border-white/10 pt-4 text-sm text-red-400">Тариф Buffer: {lim.error.message}</p>;
  const chans = (ch.data?.items ?? []).filter((c) => !/^(ig|fb|yt|tg|th):/.test(c.id));
  const locked = chans.filter((c) => c.isLocked);
  const over = chans.length > lim.data.channels;
  return (
    <div className="mt-5 space-y-1.5 border-t border-white/10 pt-4 text-sm">
      <p className="font-semibold">Тариф Buffer</p>
      <p className="text-xs text-white/50">
        Сколько соцсетей разрешает ваш тариф Buffer. Заблокированные каналы Buffer публиковать не даёт. Когда Instagram и Facebook переедут напрямую, их
        можно отключить в Buffer — блокировка уйдёт.
      </p>
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
        Сюда ведёт кнопка «💬 Claude» вверху. Если начнёте новый чат с Claude: откройте его, скопируйте адрес из строки браузера (или «Поделиться» → «Скопировать ссылку»)
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
  const rows: ReadonlyArray<{ ok: boolean; label: string; hint: string }> = [
    { ok: h.db.ok, label: `База данных (схема v${h.db.migration})`, hint: "где хранятся ролики, заказы, задания, посты" },
    { ok: h.storage.ok, label: "Хранилище видео", hint: "сами файлы роликов (до 10 ГБ бесплатно)" },
    { ok: h.buffer.ok, label: h.buffer.ok ? "Связь с Buffer" : `Связь с Buffer: ${h.buffer.error ?? "нет"}`, hint: "через него идут TikTok и Google" },
    { ok: h.secrets.appPassword, label: "Пароль входа (APP_PASSWORD)", hint: "пароль для входа в PostFixer" },
    { ok: h.secrets.bufferApiKey, label: "Ключ Buffer (BUFFER_API_KEY)", hint: "пропуск PostFixer в ваш Buffer" },
    { ok: h.secrets.uploadToken, label: "Ключ автозагрузки (UPLOAD_TOKEN)", hint: "для Mac («Готовое» → библиотека) и для Claude" },
  ];
  return (
    <Card title={`Состояние · версия ${h.version}`}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2">
            <span className="mt-1.5">
              <StatusDot ok={r.ok} />
            </span>
            <span>
              {r.label}
              <span className="block text-xs text-white/45">{r.hint}</span>
            </span>
            <span className="ml-auto text-sm text-slate-500 dark:text-white/60">{r.ok ? "в порядке" : "нет"}</span>
          </li>
        ))}
      </ul>
      <DirectConnections />
      <TelegramConnect />
      <BufferPlan />
      <ClaudeLinkSetting />
      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-white/10">
        <p className="mb-1 text-xs text-white/45">Если потеряли телефон или вошли с чужого устройства — выйдет со всех устройств, войти можно заново.</p>
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
