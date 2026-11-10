import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useMutation } from "@tanstack/react-query";
import { TotpSetupSchema } from "../../../shared/schemas";
import { apiPost } from "../../api/client";
import { useHealth } from "../../api/hooks";
import { useDeletePasskey, useLogout, usePasskeyRegister, usePasskeys } from "../../api/auth";
import { useSaveNotify, useSaveSettings, useSettings, useTestNotify } from "../../api/settings";
import { Banner, Button, Icon, ListItem, M3Card, SectionTitle, Switch, TextField } from "../../components/m3";
import type { IconName } from "../../components/m3/icons";

/** «Настройки» (бывшее «Состояние»): проверка системы, вход, Claude, выход. Соцсети — в «Подключениях». */

function SystemCheck() {
  const q = useHealth();
  if (q.isPending) return <div className="h-64 animate-pulse rounded-m3m bg-surface-container-high" />;
  if (q.isError) return <Banner tone="error">{q.error.message}</Banner>;
  const h = q.data;
  const rows: ReadonlyArray<{ ok: boolean; icon: IconName; label: string; hint: string }> = [
    { ok: h.db.ok, icon: "database", label: `База данных (схема v${h.db.migration})`, hint: "ролики, заказы, задания, посты" },
    { ok: h.storage.ok, icon: "hard_drive", label: "Хранилище видео", hint: "файлы роликов (до 10 ГБ бесплатно)" },
    { ok: h.buffer.ok, icon: "cloud", label: h.buffer.ok ? "Связь с Buffer" : `Связь с Buffer: ${h.buffer.error ?? "нет"}`, hint: "через него идут TikTok и Google" },
    { ok: h.secrets.appPassword, icon: "password", label: "Пароль входа (APP_PASSWORD)", hint: "пароль для входа в PostFixer" },
    { ok: h.secrets.bufferApiKey, icon: "vpn_key", label: "Ключ Buffer (BUFFER_API_KEY)", hint: "пропуск PostFixer в ваш Buffer" },
    { ok: h.secrets.uploadToken, icon: "key", label: "Ключ автозагрузки (UPLOAD_TOKEN)", hint: "для Mac («Готовое» → библиотека) и для Claude" },
  ];
  return (
    <M3Card className="px-4 py-1">
      {rows.map((r) => (
        <ListItem
          key={r.label}
          leading={<Icon name={r.icon} />}
          headline={r.label}
          supporting={r.hint}
          trailing={<Icon name={r.ok ? "check_circle_fill" : "error_fill"} className={r.ok ? "text-success" : "text-error"} />}
        />
      ))}
      <p className="type-body-s pb-3 text-on-surface-variant">Версия {h.version}</p>
    </M3Card>
  );
}

/** Код проверки на телефоне (как в CRM): по паролю показать QR, чтобы добавить код в «Пароли». */
function PhoneCode() {
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const reveal = useMutation({ mutationFn: (p: string) => apiPost("/auth/totp/reveal", TotpSetupSchema, { password: p }) });
  const uri = reveal.data?.uri;
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    QRCode.toDataURL(uri, { margin: 1, width: 240 })
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [uri]);
  return (
    <M3Card className="space-y-3 p-4">
      <ListItem leading={<Icon name="qr_code_2" />} headline="Код проверки на телефоне" supporting="Вход как в CRM: пароль + 6 цифр из «Паролей» — iPhone подставит сам." />
      {reveal.data ? (
        <div className="space-y-3">
          <a href={reveal.data.uri} className="type-label-l block rounded-full border border-outline py-2.5 text-center text-primary md:hidden">
            Добавить код в «Пароли» на этом телефоне
          </a>
          {qr ? <img src={qr} alt="QR-код для кода проверки" className="size-60 rounded-m3m bg-white p-2" /> : null}
          <p className="type-body-s break-all font-mono text-on-surface-variant">Ключ вручную: {reveal.data.secret}</p>
          <p className="type-body-m text-on-surface-variant">Наведите камеру iPhone на QR → «Добавить код в Пароли» → запись app.airfixer.ge.</p>
          <Button variant="tonal" onClick={() => (reveal.reset(), setQr(null), setPassword(""))}>
            Скрыть
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            reveal.mutate(password);
          }}
        >
          <div className="min-w-0 flex-1">
            <TextField label="Пароль PostFixer" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          </div>
          <Button type="submit" variant="tonal" icon="qr_code_2" disabled={!password || reveal.isPending} className="mb-2">
            Показать QR
          </Button>
        </form>
      )}
      {reveal.isError ? <Banner tone="error">{reveal.error.message}</Banner> : null}
    </M3Card>
  );
}

/** Вход по Face ID / Touch ID (ключи входа). */
function Passkeys() {
  const q = usePasskeys();
  const reg = usePasskeyRegister();
  const del = useDeletePasskey();
  const items = q.data?.items ?? [];
  const fmt = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  return (
    <M3Card className="space-y-2 p-4">
      <ListItem
        leading={<Icon name="fingerprint" />}
        headline="Вход по Face ID / Touch ID"
        supporting="Необязательно. Ключ входа хранится в «Паролях» Apple и сам появляется на iPhone и Mac (создавайте в Safari)."
      />
      {items.map((k) => (
        <ListItem
          key={k.id}
          leading={<Icon name="key" />}
          headline={`Создан на ${k.device}, ${fmt(k.createdAt)}`}
          supporting={k.lastUsedAt ? `Последний вход: ${fmt(k.lastUsedAt)}` : "Ещё не входили"}
          trailing={
            <Button
              variant="danger"
              disabled={del.isPending}
              onClick={() => window.confirm("Удалить этот ключ входа? Войти им больше не получится.") && del.mutate(k.id)}
            >
              Удалить
            </Button>
          }
        />
      ))}
      <Button variant="tonal" icon="fingerprint" disabled={reg.isPending} onClick={() => reg.mutate()}>
        {reg.isPending ? "Жду Face ID / Touch ID…" : "Создать ключ входа на этом устройстве"}
      </Button>
      {reg.isSuccess ? <Banner tone="success">Ключ входа создан. Через минуту он появится и на iPhone.</Banner> : null}
      {reg.isError && reg.error.message !== "Отменено" ? <Banner tone="error">{reg.error.message}</Banner> : null}
    </M3Card>
  );
}

/** Claude: проверка заданий по расписанию и ссылка на рабочий чат. */
function ClaudeSettings() {
  const q = useSettings();
  const save = useSaveSettings();
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? q.data?.claudeUrl ?? "";
  return (
    <M3Card className="space-y-3 p-4">
      <ListItem
        leading={<Icon name="smart_toy" />}
        headline="Claude берётся за задания сам"
        supporting="Каждый час с 9 до 21 Claude проверяет задания, заказы и правки и сразу выполняет. Mac должен быть включён, Claude открыт."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ claudeUrl: current.trim() }, { onSuccess: () => setValue(null) });
        }}
      >
        <div className="min-w-0 flex-1">
          <TextField label="Чат с Claude (кнопка «Claude» вверху)" value={current} onChange={setValue} inputMode="url" />
        </div>
        <Button type="submit" variant="tonal" disabled={save.isPending || value === null} className="mb-2">
          Сохранить
        </Button>
      </form>
      <p className="type-body-s text-on-surface-variant">Начали новый чат с Claude — скопируйте его адрес из строки браузера и вставьте сюда.</p>
      {save.isError ? <Banner tone="error">{save.error.message}</Banner> : null}
      {save.isSuccess && value === null ? <Banner tone="success">Сохранено</Banner> : null}
    </M3Card>
  );
}

/** Уведомления в Telegram от @fixerairbot (в тот же чат, куда пишет CRM). */
const NOTIFY: ReadonlyArray<{ kind: string; label: string; supporting: string }> = [
  { kind: "failed", label: "Пост не вышел", supporting: "Соцсеть, причина и кнопка «Открыть в PostFixer»" },
  { kind: "connection", label: "Подключение сломалось", supporting: "Соцсеть отозвала доступ — нужно войти заново (проверка раз в сутки)" },
  { kind: "sent", label: "Пост вышел", supporting: "Короткое сообщение со ссылкой на пост" },
  { kind: "claude", label: "Claude выполнил задание", supporting: "Ответ на задание у ролика, готовый монтаж по заказу" },
  { kind: "idle", label: "Давно не было постов", supporting: "В соцсети 7 дней без постов и ничего не запланировано (раз в неделю)" },
];
function NotifySettings() {
  const q = useSettings();
  const save = useSaveNotify();
  const test = useTestNotify();
  const n = q.data?.notify;
  const off = new Set(n?.off ?? []);
  const toggle = (kind: string, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(kind);
    else next.add(kind);
    save.mutate({ off: [...next] });
  };
  const [chat, setChat] = useState("");
  return (
    <M3Card className="space-y-1 p-4">
      <ListItem
        leading={<Icon name="send" />}
        headline="Уведомления в Telegram"
        supporting={n?.connected ? "Приходят от @fixerairbot в ваш чат с ботом (тот же, где пишет CRM)" : "Чат не привязан — впишите ID чата (его даст Claude)"}
      />
      {!n?.connected ? (
        <form
          className="flex flex-wrap items-end gap-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ chatId: chat.trim() }, { onSuccess: () => setChat("") });
          }}
        >
          <div className="min-w-0 flex-1">
            <TextField label="ID чата в Telegram" value={chat} onChange={setChat} inputMode="numeric" />
          </div>
          <Button type="submit" variant="tonal" disabled={!chat.trim() || save.isPending} className="mb-2">
            Сохранить
          </Button>
        </form>
      ) : null}
      {NOTIFY.map((x) => (
        <Switch key={x.kind} label={x.label} supporting={x.supporting} checked={!off.has(x.kind)} disabled={!n?.connected || save.isPending} onChange={(v) => toggle(x.kind, v)} />
      ))}
      <Button variant="tonal" icon="send" disabled={!n?.connected || test.isPending} onClick={() => test.mutate()} className="mt-2">
        {test.isPending ? "Отправляю…" : "Прислать проверочное"}
      </Button>
      {test.isSuccess ? <Banner tone="success">Отправлено — проверьте Telegram</Banner> : null}
      {test.isError ? <Banner tone="error">{test.error.message}</Banner> : null}
      {save.isError ? <Banner tone="error">{save.error.message}</Banner> : null}
    </M3Card>
  );
}

export function SettingsPage() {
  const logoutAll = useLogout(true);
  return (
    <div className="pt-2">
      <SectionTitle>Проверка системы</SectionTitle>
      <SystemCheck />
      <SectionTitle>Вход</SectionTitle>
      <div className="space-y-3">
        <PhoneCode />
        <Passkeys />
      </div>
      <SectionTitle>Публикация</SectionTitle>
      <a href="#/rules" className="block">
        <M3Card className="p-1">
          <ListItem leading={<Icon name="article" />} headline="Правила публикации" supporting="Как часто, когда и куда выкладывать — по исследованиям. По ним работает «В очередь»" trailing={<span className="text-on-surface-variant">›</span>} />
        </M3Card>
      </a>
      <SectionTitle>Резервная копия</SectionTitle>
      <a href="/api/v2/settings/backup" download className="block">
        <M3Card className="p-1">
          <ListItem leading={<Icon name="database" />} headline="Скачать копию данных" supporting="Ролики в библиотеке, посты, статистика, заказы, настройки — одним файлом. Без паролей и токенов" trailing={<span className="text-on-surface-variant">›</span>} />
        </M3Card>
      </a>
      <SectionTitle>Уведомления</SectionTitle>
      <NotifySettings />
      <SectionTitle>Claude</SectionTitle>
      <ClaudeSettings />
      <SectionTitle>Безопасность</SectionTitle>
      <M3Card className="space-y-3 p-4">
        <ListItem
          leading={<Icon name="logout" />}
          headline="Выйти на всех устройствах"
          supporting="Если потеряли телефон или вошли с чужого устройства. Войти можно будет заново."
        />
        <Button
          variant="danger-outlined"
          disabled={logoutAll.isPending}
          onClick={() => window.confirm("Выйти на всех устройствах? Код из «Паролей» понадобится снова везде.") && logoutAll.mutate()}
        >
          Выйти на всех устройствах
        </Button>
      </M3Card>
    </div>
  );
}
