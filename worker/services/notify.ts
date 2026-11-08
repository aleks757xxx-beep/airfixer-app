import type { Env } from "../env";
import { open } from "../lib/secretbox";
import { MetaError, metaObject } from "./meta";
import { listChannels, listPosts } from "./publish";
import { TelegramError, chatByAddress, sendMessage } from "./telegram";
import { ThreadsError, threadsMe } from "./threads";
import { YoutubeError, googleClientId, refreshGoogleToken } from "./youtube";

/**
 * Уведомления владельцу в Telegram от бота @fixerairbot (решение владельца 08.11.2026):
 * пост не вышел / вышел, подключение сломалось, Claude выполнил задание или смонтировал ролик.
 * Устроено как «почтовый ящик»: cron сам находит новое по базе и отмечает отправленное — код публикации не трогаем.
 */

const APP = "https://app.airfixer.ge";
const SERVICE: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  telegram: "Telegram",
  threads: "Threads",
  tiktok: "TikTok",
  googlebusiness: "Google Бизнес",
};
export const NOTIFY_KINDS = ["failed", "sent", "connection", "claude"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function setting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string | null }>();
  return r?.value ?? null;
}

/** Куда и о чём сообщать. Чат — ID личного чата владельца с ботом (из CRM). */
export async function notifyConfig(env: Env): Promise<{ chatId: string | null; kinds: Record<NotifyKind, boolean> }> {
  const chatId = (await setting(env.DB, "notify_chat_id"))?.trim() || null;
  let off: string[] = [];
  try {
    off = JSON.parse((await setting(env.DB, "notify_off")) ?? "[]") as string[];
  } catch {
    off = [];
  }
  const kinds = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, !off.includes(k)])) as Record<NotifyKind, boolean>;
  return { chatId, kinds };
}

/** Отправить одно уведомление (если такой вид включён). Ошибки Telegram не мешают остальному. */
export async function notify(env: Env, kind: NotifyKind | "test", html: string, button?: { text: string; url: string }): Promise<boolean> {
  const token = env.TG_BOT_TOKEN?.trim();
  const cfg = await notifyConfig(env);
  if (!token || !cfg.chatId) return false;
  if (kind !== "test" && !cfg.kinds[kind]) return false;
  try {
    await sendMessage(token, cfg.chatId, html, button);
    return true;
  } catch (e: unknown) {
    console.error("notify", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Пометить ключ отправленным; true — если раньше не отправляли. */
async function once(db: D1Database, key: string): Promise<boolean> {
  const r = await db.prepare("INSERT OR IGNORE INTO notify_log (key, at) VALUES (?, ?)").bind(key, Date.now()).run();
  return r.meta.changes > 0;
}

interface PostNote {
  id: string;
  status: "sent" | "error";
  text: string;
  error: string | null;
  external_link: string | null;
  service: string;
  name: string;
}

/** Каждую минуту: прямые посты, которые только что вышли или упали. */
export async function notifyDirectPosts(env: Env): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.status, p.text, p.error, p.external_link, a.service, a.name
     FROM direct_posts p JOIN direct_accounts a ON a.id = p.account_id
     WHERE p.status IN ('sent', 'error') AND (p.notified_status IS NULL OR p.notified_status != p.status)
     ORDER BY p.updated_at LIMIT 10`,
  ).all<PostNote>();
  let n = 0;
  for (const p of rows.results) {
    // сначала отмечаем — чтобы при сбое Telegram не прислать дважды
    await env.DB.prepare("UPDATE direct_posts SET notified_status = ? WHERE id = ?").bind(p.status, p.id).run();
    const where = `${SERVICE[p.service] ?? p.service} ${esc(p.name)}`;
    const ok =
      p.status === "error"
        ? await notify(env, "failed", `❌ <b>Пост не вышел</b> — ${where}\n${esc(p.error ?? "ошибка")}\n«${esc(short(p.text))}»`, { text: "Открыть в PostFixer", url: `${APP}/#/posts` })
        : await notify(env, "sent", `✅ <b>Вышло</b> — ${where}\n«${esc(short(p.text))}»`, p.external_link ? { text: "Открыть пост", url: p.external_link } : undefined);
    if (ok) n++;
  }
  return n;
}

/** Раз в час: посты Buffer (TikTok, Google Бизнес) за последние сутки. */
export async function notifyBufferPosts(env: Env): Promise<number> {
  const key = env.BUFFER_API_KEY?.trim();
  if (!key) return 0;
  const since = Number((await setting(env.DB, "notify_since")) ?? "0");
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const { items } = await listPosts(key, env.DB, hour - 24 * 3_600_000, hour + 3_600_000);
  const channels = new Map((await listChannels(key, env.DB)).map((c) => [c.id, c]));
  let n = 0;
  for (const p of items) {
    if (p.status !== "sent" && p.status !== "error") continue;
    if ((p.sentAt ?? p.dueAt ?? 0) < since) continue;
    if (!(await once(env.DB, `buffer:${p.id}:${p.status}`))) continue;
    const ch = channels.get(p.channelId);
    const where = `${SERVICE[p.service] ?? p.service} ${esc(ch?.displayName || ch?.name || "")} (Buffer)`;
    const ok =
      p.status === "error"
        ? await notify(env, "failed", `❌ <b>Пост не вышел</b> — ${where}\n${esc(p.error ?? "ошибка")}\n«${esc(short(p.text))}»`, { text: "Открыть в PostFixer", url: `${APP}/#/posts` })
        : await notify(env, "sent", `✅ <b>Вышло</b> — ${where}\n«${esc(short(p.text))}»`, p.externalLink ? { text: "Открыть пост", url: p.externalLink } : undefined);
    if (ok) n++;
  }
  return n;
}

/** Каждую минуту: Claude ответил на задание у ролика или прислал смонтированный ролик по заказу. */
export async function notifyClaudeWork(env: Env): Promise<number> {
  let n = 0;
  const tasks = await env.DB.prepare(
    "SELECT id, name, note_reply, note_at FROM media WHERE note_status = 'done' AND note_at > ? AND deleted_at IS NULL ORDER BY note_at LIMIT 10",
  )
    .bind(Date.now() - 6 * 3_600_000)
    .all<{ id: string; name: string; note_reply: string | null; note_at: number }>();
  for (const t of tasks.results) {
    if (!(await once(env.DB, `task:${t.id}:${t.note_at}`))) continue;
    if (await notify(env, "claude", `🤖 <b>Claude выполнил задание</b> — ролик «${esc(t.name)}»\n${esc(short(t.note_reply ?? "", 300))}`, { text: "Открыть библиотеку", url: `${APP}/#/library` })) n++;
  }
  const drafts = await env.DB.prepare(
    "SELECT e.id, e.order_id, e.text FROM edit_events e WHERE e.author = 'claude' AND e.kind = 'draft' AND e.created_at > ? ORDER BY e.id LIMIT 10",
  )
    .bind(Date.now() - 6 * 3_600_000)
    .all<{ id: number; order_id: number; text: string | null }>();
  for (const d of drafts.results) {
    if (!(await once(env.DB, `order:${d.id}`))) continue;
    if (await notify(env, "claude", `🎬 <b>Монтаж готов</b> — заказ #${d.order_id}\n${esc(short(d.text ?? "Посмотрите черновик и примите или напишите правки", 300))}`, { text: "Посмотреть", url: `${APP}/#/library` })) n++;
  }
  return n;
}

interface AccountCheck {
  id: string;
  service: string;
  name: string;
  external_id: string;
  page_id: string | null;
  token_enc: string;
  token_expires_at: number | null;
}

/** Раз в сутки: живо ли каждое подключение. Сломано (доступ отозван) — сообщить. Сбой сети — не тревожим. */
export async function checkConnections(env: Env): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT id, service, name, external_id, page_id, token_enc, token_expires_at FROM direct_accounts").all<AccountCheck>();
  const broken: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const a of rows.results) {
    let problem: string | null = null;
    try {
      if (a.service === "telegram") {
        const token = env.TG_BOT_TOKEN?.trim();
        if (!token) problem = "не задан ключ бота";
        else await chatByAddress(token, a.external_id);
      } else if (a.service === "youtube") {
        const secret = env.GOOGLE_CLIENT_SECRET?.trim();
        if (secret) await refreshGoogleToken(googleClientId(env), secret, await open(env.TOKEN_KEY, a.token_enc));
      } else if (a.service === "threads") {
        if (a.token_expires_at !== null && a.token_expires_at < Date.now()) problem = "доступ истёк";
        else await threadsMe(await open(env.TOKEN_KEY, a.token_enc));
      } else {
        await metaObject(a.external_id, await open(env.TOKEN_KEY, a.token_enc));
      }
    } catch (e: unknown) {
      if (e instanceof MetaError || e instanceof YoutubeError || e instanceof ThreadsError || e instanceof TelegramError) problem = e.message;
      else console.error("check", a.id, e);
    }
    if (!problem) continue;
    broken.push(`${a.id}: ${problem}`);
    if (await once(env.DB, `conn:${a.id}:${day}`)) {
      await notify(env, "connection", `🔌 <b>Нужно переподключить</b> — ${SERVICE[a.service] ?? a.service} ${esc(a.name)}\n${esc(short(problem, 300))}\nПосты в эту соцсеть не выйдут, пока не войдёте заново.`, {
        text: "Открыть «Подключения»",
        url: `${APP}/#/connections`,
      });
    }
  }
  // каналы Buffer, которые Buffer пометил отключёнными
  const key = env.BUFFER_API_KEY?.trim();
  if (key) {
    const channels = await listChannels(key, env.DB, true).catch(() => []);
    for (const c of channels.filter((x) => x.isDisconnected)) {
      broken.push(`buffer:${c.id}`);
      if (await once(env.DB, `conn:buffer:${c.id}:${day}`)) {
        await notify(env, "connection", `🔌 <b>Нужно переподключить в Buffer</b> — ${SERVICE[c.service] ?? c.service} ${esc(c.displayName || c.name)}`, { text: "Открыть Buffer", url: "https://publish.buffer.com/settings/channels" });
      }
    }
  }
  await env.DB.prepare("DELETE FROM notify_log WHERE at > 0 AND at < ?").bind(Date.now() - 60 * 86_400_000).run();
  return broken;
}
