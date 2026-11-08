import { z } from "zod";

/** Telegram Bot API: найти каналы, где бот — админ, и отправить ролик в канал. */

let API = "https://api.telegram.org";
/** Только для локальной проверки (заглушка Bot API). */
export function setTgApiUrl(url: string | undefined): void {
  if (url) API = url.replace(/\/$/, "");
}

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

const Reply = z.object({ ok: z.boolean(), result: z.unknown().optional(), description: z.string().optional() });

/** Понятные сообщения вместо английских ошибок Telegram. */
function explain(d: string): string {
  if (/chat not found/i.test(d)) return "Telegram: канал не найден — проверьте адрес и что бот добавлен в канал";
  if (/member list is inaccessible/i.test(d)) return "Telegram: бот ещё не админ этого канала — добавьте его в администраторы канала и нажмите ещё раз";
  if (/not enough rights|need administrator|have no rights/i.test(d)) return "Telegram: у бота нет права публиковать — сделайте его админом канала с правом «Публикация сообщений»";
  if (/too big|entity too large/i.test(d)) return "Telegram: ролик больше 50 МБ";
  if (/unauthorized/i.test(d)) return "Telegram: неверный ключ бота (TG_BOT_TOKEN)";
  if (/caption is too long/i.test(d)) return "Telegram: подпись длиннее 1024 знаков";
  return `Telegram: ${d}`;
}

async function call<S extends z.ZodType>(token: string, method: string, body: Record<string, unknown> | FormData, schema: S): Promise<z.infer<S>> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const raw = Reply.safeParse(await res.json().catch(() => null));
  if (!raw.success) throw new Error(`Telegram ответил ${res.status}`); // сетевой сбой — повторим
  if (!raw.data.ok) throw new TelegramError(explain(raw.data.description ?? `ошибка ${res.status}`));
  return schema.parse(raw.data.result);
}

const Chat = z.object({ id: z.number(), type: z.string(), title: z.string().optional(), username: z.string().optional() });
export type TgChat = z.infer<typeof Chat>;

export async function getMe(token: string): Promise<{ id: number; username: string }> {
  return call(token, "getMe", {}, z.object({ id: z.number(), username: z.string() }));
}

/** Канал по адресу (@name или ссылка t.me/name) + проверка, что бот может в нём публиковать. */
export async function chatByAddress(token: string, address: string): Promise<TgChat> {
  const a = address.trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/^@/, "").split(/[/?#]/)[0] ?? "";
  if (!a) throw new TelegramError("Укажите адрес канала, например @airfixer");
  const chat = await call(token, "getChat", { chat_id: /^-?\d+$/.test(a) ? Number(a) : `@${a}` }, Chat);
  await ensureCanPost(token, chat.id);
  return chat;
}

async function ensureCanPost(token: string, chatId: number): Promise<void> {
  const me = await getMe(token);
  const notAdmin = `Telegram: бот @${me.username} ещё не админ этого канала — добавьте в администраторы канала именно его (@${me.username}) и нажмите ещё раз`;
  const m = await call(
    token,
    "getChatMember",
    { chat_id: chatId, user_id: me.id },
    z.object({ status: z.string(), can_post_messages: z.boolean().optional() }),
  ).catch((e: unknown) => {
    throw e instanceof TelegramError && /не админ|member list/i.test(e.message) ? new TelegramError(notAdmin) : e;
  });
  if (m.status !== "administrator" && m.status !== "creator") throw new TelegramError(notAdmin);
  if (m.can_post_messages === false) throw new TelegramError("Telegram: у бота нет права «Публикация сообщений» в канале");
}

/** Каналы, куда бота недавно добавили админом (Telegram хранит эти события сутки). */
export async function recentChannels(token: string): Promise<TgChat[]> {
  const updates = await call(
    token,
    "getUpdates",
    { allowed_updates: ["my_chat_member", "channel_post"], limit: 100 },
    z.array(
      z.object({
        my_chat_member: z.object({ chat: Chat, new_chat_member: z.object({ status: z.string() }) }).optional(),
        channel_post: z.object({ chat: Chat }).optional(),
      }),
    ),
  );
  const found = new Map<number, TgChat>();
  for (const u of updates) {
    const mc = u.my_chat_member;
    if (mc && mc.chat.type === "channel") {
      if (mc.new_chat_member.status === "administrator") found.set(mc.chat.id, mc.chat);
      else found.delete(mc.chat.id);
    }
    if (u.channel_post) found.set(u.channel_post.chat.id, u.channel_post.chat);
  }
  const ok: TgChat[] = [];
  for (const chat of found.values()) {
    try {
      await ensureCanPost(token, chat.id);
      ok.push(chat);
    } catch {
      /* бота уже убрали или нет прав */
    }
  }
  return ok;
}

/** Ссылка на сообщение в канале. */
export function messageLink(chat: { id: number; username?: string }, messageId: number): string {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  return `https://t.me/c/${String(chat.id).replace(/^-100/, "")}/${messageId}`;
}

/** Отправить ролик в канал (файл до 50 МБ). */
export async function sendVideo(
  token: string,
  chatId: string,
  video: Blob,
  fileName: string,
  caption: string,
  button?: { text: string; url: string } | null,
): Promise<{ messageId: number; link: string }> {
  const fd = new FormData();
  if (button?.text && button.url) fd.set("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: button.text, url: button.url }]] }));
  fd.set("chat_id", chatId);
  fd.set("video", video, fileName);
  fd.set("supports_streaming", "true");
  if (caption) fd.set("caption", caption);
  const msg = await call(token, "sendVideo", fd, z.object({ message_id: z.number(), chat: Chat }));
  return { messageId: msg.message_id, link: messageLink(msg.chat, msg.message_id) };
}
