import { useState, type ReactNode } from "react";
import type { Channel } from "../../../shared/schemas";
import { useSaveSettings, useSettings } from "../../api/settings";
import {
  useBufferLimits,
  useChannels,
  useConnectTelegram,
  useDirectAccounts,
  useDisconnect,
} from "../../api/publish";
import {
  Banner,
  Button,
  Chip,
  Dialog,
  Icon,
  LinkButton,
  M3Card,
  OverflowMenu,
  SectionTitle,
  TextField,
} from "../../components/m3";
import { serviceInfo } from "../publish/channels";

/**
 * «Подключения» — как раздел Channels в Buffer: каждая соцсеть карточкой и сетка «Подключить канал».
 * Напрямую: Instagram, Facebook (Meta), Telegram, YouTube (Google). Через Buffer: TikTok, Google Бизнес.
 */

const DAY_RU: Record<string, string> = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};

/** Аватар канала со значком соцсети в углу. */
function Avatar({
  channel,
  size = 48,
}: {
  channel: Pick<Channel, "avatar" | "service" | "name">;
  size?: number;
}) {
  const i = serviceInfo(channel.service);
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      {channel.avatar && !broken ? (
        <img
          onError={() => setBroken(true)}
          src={channel.avatar}
          alt=""
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span
          className={`type-title-m flex size-full items-center justify-center rounded-full text-white ${i.cls}`}
        >
          {channel.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full text-[8px] font-black text-white ring-2 ring-surface ${i.cls}`}
      >
        {i.short}
      </span>
    </span>
  );
}

/** Время публикаций коротко: «6 раз в день · 06:08–21:49». */
function slotsText(c: Channel): string {
  const active = c.schedule.filter((d) => !d.paused && d.times.length > 0);
  if (active.length === 0) return "время не задано";
  const times = [...new Set(active.flatMap((d) => d.times))].sort();
  const perDay = Math.max(...active.map((d) => d.times.length));
  const days =
    active.length === 7
      ? "в день"
      : `· ${active.map((d) => DAY_RU[d.day.slice(0, 3).toLowerCase()] ?? d.day).join(", ")}`;
  const range =
    times.length > 1
      ? `${times[0]}–${times[times.length - 1]}`
      : (times[0] ?? "");
  return `${perDay} ${perDay === 1 ? "раз" : perDay < 5 ? "раза" : "раз"} ${days} · ${range}`;
}

interface Row {
  channel: Channel;
  direct: boolean;
  locked: boolean;
  note: string | null;
  onTgButton?: () => void;
  onDisconnect?: () => void;
}

function Status({ row, short }: { row: Row; short?: boolean }) {
  return row.locked ? (
    <span className="type-label-m inline-flex items-center gap-1 text-warning">
      <Icon name="lock_fill" size={16} />
      {short ? "блок" : "Заблокирован"}
    </span>
  ) : (
    <span className="type-label-m inline-flex items-center gap-1 text-success">
      <Icon name="check_circle_fill" size={16} />
      {short ? "" : "Работает"}
    </span>
  );
}

function Via({ direct }: { direct: boolean }) {
  return (
    <span
      className={`type-label-m inline-flex items-center gap-1 ${direct ? "text-primary" : "text-on-surface-variant"}`}
    >
      <Icon name={direct ? "bolt" : "cloud"} size={16} />
      {direct ? "Напрямую" : "Buffer"}
    </span>
  );
}

function RowActions({ row }: { row: Row }) {
  const name = row.channel.displayName || row.channel.name;
  const items = [
    ...(row.onTgButton ? [{ icon: "link" as const, text: "Кнопка под постами", onClick: row.onTgButton }] : []),
    ...(row.onDisconnect
      ? [{ icon: "link_off" as const, text: "Отключить", onClick: row.onDisconnect, danger: true }]
      : [{ icon: "open_in_new" as const, text: "Открыть в Buffer", href: "https://publish.buffer.com/" }]),
  ];
  return (
    <div className="flex justify-end">
      <OverflowMenu label={`Действия: ${name}`} items={items} />
    </div>
  );
}

/** Каналы: на телефоне — список строк, на компьютере — таблица. */
function ChannelsTable({ rows }: { rows: Row[] }) {
  return (
    <M3Card variant="outlined">
      {/* телефон */}
      <ul className="divide-y divide-outline-variant md:hidden">
        {rows.map((r) => (
          <li
            key={r.channel.id}
            className="flex items-center gap-3 py-2.5 pl-3 pr-1"
          >
            <Avatar channel={r.channel} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="type-title-s truncate text-on-surface">
                  {r.channel.displayName || r.channel.name}
                </span>
                <Status row={r} short />
              </div>
              <div className="flex flex-wrap items-center gap-x-2">
                <Via direct={r.direct} />
                <span className="type-body-s truncate text-on-surface-variant">
                  {slotsText(r.channel)}
                </span>
              </div>
              {r.note ? (
                <div className="type-body-s text-on-surface-variant">
                  {r.note}
                </div>
              ) : null}
            </div>
            <RowActions row={r} />
          </li>
        ))}
      </ul>
      {/* компьютер */}
      <table className="hidden w-full md:table">
        <thead>
          <tr className="type-label-l border-b border-outline-variant text-left text-on-surface-variant">
            <th className="py-3 pl-4 font-medium">Канал</th>
            <th className="font-medium">Как публикуется</th>
            <th className="font-medium">Статус</th>
            <th className="font-medium">Время публикаций</th>
            <th className="pr-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {rows.map((r) => (
            <tr key={r.channel.id} className="type-body-m">
              <td className="py-2.5 pl-4">
                <div className="flex items-center gap-3">
                  <Avatar channel={r.channel} size={36} />
                  <div className="min-w-0">
                    <div className="type-title-s text-on-surface">
                      {r.channel.displayName || r.channel.name}
                    </div>
                    <div className="type-body-s text-on-surface-variant">
                      {serviceInfo(r.channel.service).label}
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <Via direct={r.direct} />
              </td>
              <td>
                <Status row={r} />
              </td>
              <td className="text-on-surface-variant">
                {slotsText(r.channel)}
              </td>
              <td className="pr-2">
                <RowActions row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </M3Card>
  );
}

/** Кнопка под постами в Telegram (по умолчанию «📅 Записаться» → бот записи). */
function TelegramButtonDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const q = useSettings();
  const save = useSaveSettings();
  const [text, setText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const t = text ?? q.data?.tgButtonText ?? "";
  const u = url ?? q.data?.tgButtonUrl ?? "";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Кнопка под постами"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="text"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { tgButtonText: t.trim(), tgButtonUrl: u.trim() },
                { onSuccess: () => (setText(null), setUrl(null), onClose()) },
              )
            }
          >
            Сохранить
          </Button>
        </>
      }
    >
      <p className="mb-4">
        Кнопка появляется под каждым постом в канале. Сотрите ссылку — посты
        будут без кнопки.
      </p>
      <div className="space-y-4">
        <TextField
          label="Текст кнопки"
          value={t}
          onChange={setText}
          maxLength={40}
        />
        <TextField
          label="Ссылка"
          value={u}
          onChange={setUrl}
          inputMode="url"
          placeholder="https://t.me/…"
        />
      </div>
      {save.isError ? (
        <p className="mt-3 text-error">{save.error.message}</p>
      ) : null}
    </Dialog>
  );
}

function TelegramConnectDialog({
  open,
  onClose,
  bot,
}: {
  open: boolean;
  onClose: () => void;
  bot: string | null | undefined;
}) {
  const conn = useConnectTelegram();
  const [address, setAddress] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Подключить Telegram-канал"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {conn.isSuccess ? "Готово" : "Отмена"}
          </Button>
          {!conn.isSuccess ? (
            <Button
              variant="text"
              disabled={conn.isPending}
              onClick={() => conn.mutate(address.trim())}
            >
              {conn.isPending ? "Ищу…" : "Подключить"}
            </Button>
          ) : null}
        </>
      }
    >
      <ol className="mb-4 list-decimal space-y-1 pl-5">
        <li>
          Откройте канал → «Изменить» → «Администраторы» → «Добавить
          администратора» →{" "}
          {bot ? <b className="text-on-surface">@{bot}</b> : "бот PostFixer"}.
        </li>
        <li>Оставьте право «Публикация сообщений».</li>
        <li>
          Впишите адрес канала ниже (или оставьте пустым — бот найдёт сам) и
          нажмите «Подключить».
        </li>
      </ol>
      <TextField
        label="Адрес канала"
        value={address}
        onChange={setAddress}
        placeholder="@alexfixer"
      />
      <div className="mt-3 space-y-2">
        {conn.isError ? (
          <Banner tone="error">{conn.error.message}</Banner>
        ) : null}
        {conn.isSuccess ? (
          <Banner tone="success">Подключено: {conn.data.join(", ")}</Banner>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Строка «Подключить …»: значок, название и пояснение, кнопка справа. */
function AddTile({
  service,
  title,
  note,
  children,
}: {
  service: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  const i = serviceInfo(service);
  return (
    <li className="flex items-center gap-3 py-3 pl-3 pr-3">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-black text-white ${i.cls}`}
      >
        {i.short}
      </span>
      <div className="min-w-0 flex-1">
        <div className="type-title-s text-on-surface">{title}</div>
        <div className="type-body-s text-on-surface-variant">{note}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

const BUFFER_CONNECT = "https://publish.buffer.com/channels/connect";

export function ConnectionsPage() {
  const direct = useDirectAccounts();
  const channels = useChannels();
  const limits = useBufferLimits();
  const disc = useDisconnect();
  const [tgOpen, setTgOpen] = useState(false);
  const [tgButtonOpen, setTgButtonOpen] = useState(false);

  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const connected = params.get("connected");
  const error = params.get("connect_error");

  const accounts = direct.data?.items ?? [];
  const bufferChannels = (channels.data?.items ?? []).filter(
    (c) => !/^(ig|fb|yt|tg|th):/.test(c.id),
  );
  const hasMeta = accounts.some(
    (a) => a.service === "instagram" || a.service === "facebook",
  );
  const lim = limits.data;
  const bufferAll = lim?.connected ?? [];
  const over = lim ? bufferAll.length > lim.channels : false;

  return (
    <div className="pt-2">
      <p className="type-body-l mb-4 text-on-surface-variant">
        Соцсети, куда PostFixer публикует ролики. Одни работают напрямую, другие
        — через Buffer.
      </p>
      <div className="mb-4 space-y-2">
        {connected === "meta" ? (
          <Banner tone="success">
            Подключено аккаунтов: {params.get("n")}, из них Instagram:{" "}
            {params.get("ig")}
          </Banner>
        ) : null}
        {connected === "instagram" ? (
          <Banner tone="success">
            Instagram подключён: {params.get("name")}
          </Banner>
        ) : null}
        {connected === "youtube" ? (
          <Banner tone="success">
            YouTube подключён: {params.get("name")}
          </Banner>
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {direct.isError ? (
          <Banner tone="error">{direct.error.message}</Banner>
        ) : null}
        {channels.isError ? (
          <Banner tone="error">{channels.error.message}</Banner>
        ) : null}
      </div>

      <SectionTitle>Каналы</SectionTitle>
      <ul className="type-body-s mb-3 grid gap-x-4 gap-y-1 text-on-surface-variant sm:grid-cols-2">
        <li className="flex items-center gap-1.5">
          <Icon name="bolt" size={16} className="text-primary" />
          Напрямую — PostFixer публикует сам
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="cloud" size={16} />
          Buffer — публикуется через Buffer
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="check_circle_fill" size={16} className="text-success" />
          работает
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="lock_fill" size={16} className="text-warning" />
          блок — Buffer заблокировал по тарифу
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="more_vert" size={16} />
          действия: отключить, кнопка под постом, Buffer
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="schedule" size={16} />
          «2 раза в день · 06:08–22:32» — время очереди
        </li>
      </ul>
      {direct.isPending || channels.isPending ? (
        <div className="h-48 animate-pulse rounded-m3m bg-surface-container-high" />
      ) : (
        <ChannelsTable
          rows={[
            ...accounts.map((a): Row => ({
              channel: a,
              direct: true,
              locked: false,
              note:
                a.service === "telegram"
                  ? "кнопка «Записаться»"
                  : a.replaces
                    ? "вместо Buffer"
                    : null,
              onTgButton:
                a.service === "telegram"
                  ? () => setTgButtonOpen(true)
                  : undefined,
              onDisconnect: () => {
                if (
                  window.confirm(
                    `Отключить ${a.name}? Запланированные прямые посты этого канала удалятся.`,
                  )
                )
                  disc.mutate(a.id);
              },
            })),
            ...bufferChannels.map((c): Row => ({
              channel: c,
              direct: false,
              locked: c.isLocked,
              note: null,
            })),
          ]}
        />
      )}

      <SectionTitle>Подключить канал</SectionTitle>
      <M3Card variant="outlined">
        <ul className="divide-y divide-outline-variant">
          <AddTile
            service="instagram"
            title="Instagram и Facebook"
            note="Страница и привязанные Instagram — напрямую"
          >
            {direct.data?.meta.configured ? (
              <LinkButton
                variant={hasMeta ? "tonal" : "filled"}
                icon={hasMeta ? "sync" : "add_link"}
                href="/api/v2/connect/meta/start"
              >
                {hasMeta ? "Заново" : "Подключить"}
              </LinkButton>
            ) : (
              <Chip tone="warning">Нет ключей</Chip>
            )}
          </AddTile>
          <AddTile
            service="instagram"
            title="Instagram без страницы"
            note="Например, airfixertbls"
          >
            {direct.data?.instagram?.configured ? (
              <LinkButton
                variant="tonal"
                icon="add_link"
                href="/api/v2/connect/instagram/start"
              >
                Подключить
              </LinkButton>
            ) : (
              <Chip>Скоро</Chip>
            )}
          </AddTile>
          <AddTile
            service="telegram"
            title="Telegram-канал"
            note="Через бота, кнопка «Записаться»"
          >
            {direct.data?.telegram?.configured ? (
              <Button
                variant="tonal"
                icon="add_link"
                onClick={() => setTgOpen(true)}
              >
                Подключить
              </Button>
            ) : (
              <Chip tone="warning">Нет бота</Chip>
            )}
          </AddTile>
          <AddTile
            service="youtube"
            title="YouTube"
            note={direct.data?.youtube?.configured ? "Канал AirFixer — напрямую, вход через Google" : "Пока через Buffer, напрямую — скоро"}
          >
            {direct.data?.youtube?.configured ? (
              <LinkButton
                variant={accounts.some((a) => a.service === "youtube") ? "tonal" : "filled"}
                icon={accounts.some((a) => a.service === "youtube") ? "sync" : "add_link"}
                href="/api/v2/connect/youtube/start"
              >
                {accounts.some((a) => a.service === "youtube") ? "Заново" : "Подключить"}
              </LinkButton>
            ) : (
              <LinkButton
                variant="outlined"
                icon="open_in_new"
                href={BUFFER_CONNECT}
                external
              >
                Buffer
              </LinkButton>
            )}
          </AddTile>
          <AddTile service="tiktok" title="TikTok" note="Только через Buffer">
            <LinkButton
              variant="outlined"
              icon="open_in_new"
              href={BUFFER_CONNECT}
              external
            >
              Buffer
            </LinkButton>
          </AddTile>
          <AddTile
            service="googlebusiness"
            title="Google (Бизнес-профиль)"
            note="Только через Buffer"
          >
            <LinkButton
              variant="outlined"
              icon="open_in_new"
              href={BUFFER_CONNECT}
              external
            >
              Buffer
            </LinkButton>
          </AddTile>
        </ul>
      </M3Card>

      <SectionTitle>Тариф Buffer</SectionTitle>
      <M3Card className="p-4">
        {limits.isPending ? (
          <p className="type-body-m text-on-surface-variant">Загружаю…</p>
        ) : limits.isError ? (
          <Banner tone="error">{limits.error.message}</Banner>
        ) : lim ? (
          <div className="space-y-2">
            <p className="type-body-l text-on-surface">
              Каналов в Buffer: {bufferAll.length} из {lim.channels}
            </p>
            <p className="type-body-m text-on-surface-variant">
              {bufferAll.map((c) => c.name).join(", ")}
            </p>
            {over ? (
              <Banner tone="warning">
                Лишние каналы Buffer блокирует (
                {bufferAll
                  .filter((c) => c.isLocked)
                  .map((c) => c.name)
                  .join(", ")}
                ). Отключите в Buffer те, что уже работают напрямую.
              </Banner>
            ) : null}
            <p className="type-body-m text-on-surface-variant">
              Запланировано постов: {lim.scheduledNow} из {lim.scheduledPosts}
            </p>
          </div>
        ) : null}
      </M3Card>

      <TelegramConnectDialog
        open={tgOpen}
        onClose={() => setTgOpen(false)}
        bot={direct.data?.telegram?.bot}
      />
      <TelegramButtonDialog
        open={tgButtonOpen}
        onClose={() => setTgButtonOpen(false)}
      />
    </div>
  );
}
