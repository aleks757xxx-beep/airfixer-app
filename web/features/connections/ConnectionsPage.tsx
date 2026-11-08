import { useState, type ReactNode } from "react";
import type { Channel } from "../../../shared/schemas";
import { useSaveSettings, useSettings } from "../../api/settings";
import { useBufferLimits, useChannels, useConnectTelegram, useDirectAccounts, useDisconnect } from "../../api/publish";
import { Banner, Button, Chip, Dialog, Icon, LinkButton, M3Card, SectionTitle, TextField } from "../../components/m3";
import { serviceInfo } from "../publish/channels";

/**
 * «Подключения» — как раздел Channels в Buffer: каждая соцсеть карточкой и сетка «Подключить канал».
 * Напрямую: Instagram, Facebook (Meta), Telegram. Через Buffer: TikTok, Google, YouTube (пока).
 */

const DAY_RU: Record<string, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };

/** Аватар канала со значком соцсети в углу. */
function Avatar({ channel, size = 48 }: { channel: Pick<Channel, "avatar" | "service" | "name">; size?: number }) {
  const i = serviceInfo(channel.service);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {channel.avatar ? (
        <img src={channel.avatar} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span className={`type-title-m flex size-full items-center justify-center rounded-full text-white ${i.cls}`}>{channel.name.slice(0, 1).toUpperCase()}</span>
      )}
      <span className={`absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full text-[8px] font-black text-white ring-2 ring-surface-container-highest ${i.cls}`}>
        {i.short}
      </span>
    </span>
  );
}

/** Время публикаций (слоты) коротко: «09:19, 19:41 · каждый день». */
function slotsText(c: Channel): string {
  const active = c.schedule.filter((d) => !d.paused && d.times.length > 0);
  if (active.length === 0) return "Время публикаций не задано";
  const times = [...new Set(active.flatMap((d) => d.times))].sort();
  const days = active.length === 7 ? "каждый день" : active.map((d) => DAY_RU[d.day.slice(0, 3).toLowerCase()] ?? d.day).join(", ");
  return `${times.slice(0, 4).join(", ")}${times.length > 4 ? "…" : ""} · ${days}`;
}

function ChannelCard({ channel, direct, locked, actions, extra }: { channel: Channel; direct: boolean; locked?: boolean; actions?: ReactNode; extra?: ReactNode }) {
  return (
    <M3Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar channel={channel} />
        <div className="min-w-0 flex-1">
          <div className="type-title-m truncate text-on-surface">{channel.displayName || channel.name}</div>
          <div className="type-body-m text-on-surface-variant">{serviceInfo(channel.service).label}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {direct ? <Chip icon="bolt" tone="primary">Напрямую</Chip> : <Chip icon="cloud">Через Buffer</Chip>}
        {locked ? (
          <Chip icon="lock" tone="warning">
            Заблокирован тарифом
          </Chip>
        ) : (
          <Chip icon="check_circle" tone="success">
            Работает
          </Chip>
        )}
      </div>
      <div className="type-body-m flex items-center gap-2 text-on-surface-variant">
        <Icon name="schedule" size={18} />
        {slotsText(channel)}
      </div>
      {extra}
      {actions ? <div className="-mb-1 mt-auto flex flex-wrap justify-end gap-1 pt-1">{actions}</div> : null}
    </M3Card>
  );
}

/** Кнопка под постами в Telegram (по умолчанию «📅 Записаться» → бот записи). */
function TelegramButtonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
            onClick={() => save.mutate({ tgButtonText: t.trim(), tgButtonUrl: u.trim() }, { onSuccess: () => (setText(null), setUrl(null), onClose()) })}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <p className="mb-4">Кнопка появляется под каждым постом в канале. Сотрите ссылку — посты будут без кнопки.</p>
      <div className="space-y-4">
        <TextField label="Текст кнопки" value={t} onChange={setText} maxLength={40} />
        <TextField label="Ссылка" value={u} onChange={setUrl} inputMode="url" placeholder="https://t.me/…" />
      </div>
      {save.isError ? <p className="mt-3 text-error">{save.error.message}</p> : null}
    </Dialog>
  );
}

function TelegramConnectDialog({ open, onClose, bot }: { open: boolean; onClose: () => void; bot: string | null | undefined }) {
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
            <Button variant="text" disabled={conn.isPending} onClick={() => conn.mutate(address.trim())}>
              {conn.isPending ? "Ищу…" : "Подключить"}
            </Button>
          ) : null}
        </>
      }
    >
      <ol className="mb-4 list-decimal space-y-1 pl-5">
        <li>
          Откройте канал → «Изменить» → «Администраторы» → «Добавить администратора» → {bot ? <b className="text-on-surface">@{bot}</b> : "бот PostFixer"}.
        </li>
        <li>Оставьте право «Публикация сообщений».</li>
        <li>Впишите адрес канала ниже (или оставьте пустым — бот найдёт сам) и нажмите «Подключить».</li>
      </ol>
      <TextField label="Адрес канала" value={address} onChange={setAddress} placeholder="@alexfixer" />
      <div className="mt-3 space-y-2">
        {conn.isError ? <Banner tone="error">{conn.error.message}</Banner> : null}
        {conn.isSuccess ? <Banner tone="success">Подключено: {conn.data.join(", ")}</Banner> : null}
      </div>
    </Dialog>
  );
}

/** Плитка «Подключить …» в сетке. */
function AddTile({ service, title, note, children }: { service: string; title: string; note: string; children: ReactNode }) {
  const i = serviceInfo(service);
  return (
    <M3Card variant="outlined" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className={`flex size-10 items-center justify-center rounded-full text-xs font-black text-white ${i.cls}`}>{i.short}</span>
        <div className="type-title-m text-on-surface">{title}</div>
      </div>
      <p className="type-body-m flex-1 text-on-surface-variant">{note}</p>
      <div>{children}</div>
    </M3Card>
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
  const bufferChannels = (channels.data?.items ?? []).filter((c) => !/^(ig|fb|yt|tg|th):/.test(c.id));
  const hasMeta = accounts.some((a) => a.service === "instagram" || a.service === "facebook");
  const lim = limits.data;
  const bufferAll = lim?.connected ?? [];
  const over = lim ? bufferAll.length > lim.channels : false;

  return (
    <div className="pt-2">
      <p className="type-body-l mb-4 text-on-surface-variant">Соцсети, куда PostFixer публикует ролики. Одни работают напрямую, другие — через Buffer.</p>
      <div className="mb-4 space-y-2">
        {connected === "meta" ? (
          <Banner tone="success">
            Подключено аккаунтов: {params.get("n")}, из них Instagram: {params.get("ig")}
          </Banner>
        ) : null}
        {connected === "instagram" ? <Banner tone="success">Instagram подключён: {params.get("name")}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {direct.isError ? <Banner tone="error">{direct.error.message}</Banner> : null}
        {channels.isError ? <Banner tone="error">{channels.error.message}</Banner> : null}
      </div>

      <SectionTitle>Каналы</SectionTitle>
      {direct.isPending || channels.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((k) => (
            <div key={k} className="h-48 animate-pulse rounded-m3m bg-surface-container-high" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <ChannelCard
              key={a.id}
              channel={a}
              direct
              extra={
                a.service === "telegram" ? (
                  <button type="button" onClick={() => setTgButtonOpen(true)} className="type-body-m flex items-center gap-2 text-left text-on-surface-variant">
                    <Icon name="link" size={18} />
                    Кнопка под постами — изменить
                  </button>
                ) : a.replaces ? (
                  <p className="type-body-s text-on-surface-variant">Вместо канала в Buffer</p>
                ) : null
              }
              actions={
                <Button
                  variant="danger"
                  icon="link_off"
                  disabled={disc.isPending}
                  onClick={() => window.confirm(`Отключить ${a.name}? Запланированные прямые посты этого канала удалятся.`) && disc.mutate(a.id)}
                >
                  Отключить
                </Button>
              }
            />
          ))}
          {bufferChannels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              direct={false}
              locked={c.isLocked}
              actions={
                <LinkButton variant="text" icon="open_in_new" href="https://publish.buffer.com/" external>
                  Открыть Buffer
                </LinkButton>
              }
            />
          ))}
        </div>
      )}

      <SectionTitle>Подключить канал</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AddTile service="instagram" title="Instagram и Facebook" note="Страница Facebook и привязанные к ней Instagram. Публикуются напрямую, без Buffer.">
          {direct.data?.meta.configured ? (
            <LinkButton variant={hasMeta ? "tonal" : "filled"} icon={hasMeta ? "sync" : "add_link"} href="/api/v2/connect/meta/start">
              {hasMeta ? "Переподключить" : "Подключить"}
            </LinkButton>
          ) : (
            <Chip tone="warning">Нужны ключи Meta в Cloudflare</Chip>
          )}
        </AddTile>
        <AddTile service="instagram" title="Instagram без страницы" note="Для Instagram, не привязанного к странице Facebook (например, airfixertbls).">
          {direct.data?.instagram?.configured ? (
            <LinkButton variant="tonal" icon="add_link" href="/api/v2/connect/instagram/start">
              Подключить
            </LinkButton>
          ) : (
            <Chip>Ждёт настройки в Meta</Chip>
          )}
        </AddTile>
        <AddTile service="telegram" title="Telegram-канал" note="Ролики уходят в канал через бота, под постом — кнопка «Записаться».">
          {direct.data?.telegram?.configured ? (
            <Button variant="tonal" icon="add_link" onClick={() => setTgOpen(true)}>
              Подключить
            </Button>
          ) : (
            <Chip tone="warning">Нужен ключ бота в Cloudflare</Chip>
          )}
        </AddTile>
        <AddTile service="youtube" title="YouTube" note="Сейчас через Buffer. Напрямую — следующим шагом (точное название и теги).">
          <LinkButton variant="outlined" icon="open_in_new" href={BUFFER_CONNECT} external>
            Через Buffer
          </LinkButton>
        </AddTile>
        <AddTile service="tiktok" title="TikTok" note="Через Buffer: напрямую TikTok разрешает только после долгой проверки.">
          <LinkButton variant="outlined" icon="open_in_new" href={BUFFER_CONNECT} external>
            Через Buffer
          </LinkButton>
        </AddTile>
        <AddTile service="googlebusiness" title="Google (Бизнес-профиль)" note="Через Buffer: доступ напрямую Google выдаёт по заявке.">
          <LinkButton variant="outlined" icon="open_in_new" href={BUFFER_CONNECT} external>
            Через Buffer
          </LinkButton>
        </AddTile>
      </div>

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
            <p className="type-body-m text-on-surface-variant">{bufferAll.map((c) => c.name).join(", ")}</p>
            {over ? (
              <Banner tone="warning">
                Лишние каналы Buffer блокирует ({bufferAll.filter((c) => c.isLocked).map((c) => c.name).join(", ")}). Отключите в Buffer те, что уже работают
                напрямую.
              </Banner>
            ) : null}
            <p className="type-body-m text-on-surface-variant">
              Запланировано постов: {lim.scheduledNow} из {lim.scheduledPosts}
            </p>
          </div>
        ) : null}
      </M3Card>

      <TelegramConnectDialog open={tgOpen} onClose={() => setTgOpen(false)} bot={direct.data?.telegram?.bot} />
      <TelegramButtonDialog open={tgButtonOpen} onClose={() => setTgButtonOpen(false)} />
    </div>
  );
}
