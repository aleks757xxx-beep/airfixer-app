import type { BufferPost, Channel, ComposeInput, ComposeResult } from "../../shared/schemas";
import { TBILISI_OFFSET_MS, TEXT_LIMITS, TG_MAX_BYTES } from "../../shared/schemas";
import type { Env } from "../env";
import { open, seal } from "../lib/secretbox";
import {
  MetaError,
  fbPublishReel,
  fbVideoStatus,
  igComment,
  igContainerStatus,
  igCreateContainer,
  igPublish,
  type MetaPage,
} from "./meta";
import { TelegramError, sendVideo, type TgChat } from "./telegram";
import { readSettings } from "../routes/settings";

/** Прямая публикация (без Buffer): аккаунты, своя очередь со слотами, отправка к сроку (cron). */

export const PUBLIC_ORIGIN = "https://app.airfixer.ge";
const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DEFAULT_SLOTS = DAY_CODES.map((day) => ({ day, times: ["10:00", "19:00"], paused: false }));
const PROCESS_TIMEOUT_MS = 45 * 60_000;

interface AccountRow {
  id: string;
  service: "instagram" | "facebook" | "youtube" | "telegram" | "threads";
  name: string;
  external_id: string;
  page_id: string | null;
  token_enc: string;
  token_expires_at: number | null;
  replaces: string | null;
  slots: string | null;
  created_at: number;
  updated_at: number;
}
interface PostRow {
  id: string;
  account_id: string;
  media_id: string;
  text: string;
  title: string | null;
  first_comment: string | null;
  thumb_ms: number | null;
  due_at: number | null;
  status: "draft" | "scheduled" | "processing" | "sent" | "error";
  attempts: number;
  container_id: string | null;
  external_id: string | null;
  external_link: string | null;
  error: string | null;
  author: "owner" | "claude";
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}
type Slot = { day: string; times: string[]; paused: boolean };

export const isDirectChannel = (id: string) => /^(ig|fb|yt|tg|th):/.test(id);
export const isDirectPost = (id: string) => id.startsWith("dp_");

function slotsOf(a: AccountRow): Slot[] {
  try {
    const s = a.slots ? (JSON.parse(a.slots) as Slot[]) : null;
    return Array.isArray(s) && s.length ? s : DEFAULT_SLOTS;
  } catch {
    return DEFAULT_SLOTS;
  }
}

export async function listAccounts(db: D1Database): Promise<AccountRow[]> {
  const r = await db.prepare("SELECT * FROM direct_accounts ORDER BY service, name").all<AccountRow>();
  return r.results;
}

export function accountToChannel(a: AccountRow): Channel {
  return {
    id: a.id,
    name: a.name,
    displayName: a.name,
    service: a.service,
    avatar: "",
    timezone: "Asia/Tbilisi",
    isQueuePaused: false,
    isDisconnected: false,
    isLocked: false,
    schedule: slotsOf(a),
  };
}

/**
 * Сохранить страницы и Instagram после входа в Meta.
 * Слоты и «какой канал Buffer заменяет» — по совпадению сети и имени с каналами Buffer.
 */
/** Аккаунты, которые владелец отключил: при «Переподключить» они не возвращаются. */
const HIDDEN_KEY = "direct_hidden";
async function hiddenIds(db: D1Database): Promise<string[]> {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(HIDDEN_KEY).first<{ value: string }>();
  try {
    const v: unknown = r ? JSON.parse(r.value) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveMetaAccounts(env: Env, pages: ReadonlyArray<MetaPage>, bufferChannels: ReadonlyArray<Channel>): Promise<number> {
  const now = Date.now();
  let n = 0;
  const hidden = new Set(await hiddenIds(env.DB));
  const match = (service: string, name: string) =>
    bufferChannels.find((c) => c.service === service && (c.name.toLowerCase() === name.toLowerCase() || (c.displayName ?? "").toLowerCase() === name.toLowerCase()));
  const upsert = async (id: string, service: "instagram" | "facebook", name: string, externalId: string, pageId: string | null, token: string) => {
    if (hidden.has(id)) return;
    const buf = match(service, name);
    await env.DB.prepare(
      `INSERT INTO direct_accounts (id, service, name, external_id, page_id, token_enc, token_expires_at, replaces, slots, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, token_enc = excluded.token_enc, page_id = excluded.page_id,
         replaces = COALESCE(direct_accounts.replaces, excluded.replaces), updated_at = excluded.updated_at`,
    )
      .bind(id, service, name, externalId, pageId, await seal(env.TOKEN_KEY, token), buf?.id ?? null, JSON.stringify(buf?.schedule ?? DEFAULT_SLOTS), now, now)
      .run();
    n++;
  };
  for (const p of pages) {
    await upsert(`fb:${p.id}`, "facebook", p.name, p.id, p.id, p.access_token);
    const ig = p.instagram_business_account;
    if (ig) await upsert(`ig:${ig.id}`, "instagram", ig.username ?? `Instagram ${ig.id}`, ig.id, p.id, p.access_token);
  }
  return n;
}

/** Сохранить канал Telegram (бот — админ). Слоты — как у Instagram airfixer.ge, если он подключён. */
export async function saveTelegramChannel(db: D1Database, chat: TgChat): Promise<void> {
  const now = Date.now();
  const ig = await db.prepare("SELECT slots FROM direct_accounts WHERE service = 'instagram' ORDER BY created_at LIMIT 1").first<{ slots: string | null }>();
  await db
    .prepare(
      `INSERT INTO direct_accounts (id, service, name, external_id, page_id, token_enc, token_expires_at, replaces, slots, created_at, updated_at)
       VALUES (?, 'telegram', ?, ?, ?, '', NULL, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, page_id = excluded.page_id, updated_at = excluded.updated_at`,
    )
    .bind(`tg:${chat.id}`, chat.title ?? chat.username ?? `Канал ${chat.id}`, String(chat.id), chat.username ?? null, ig?.slots ?? JSON.stringify(DEFAULT_SLOTS), now, now)
    .run();
}

/** Сохранить Instagram после единого входа (без страницы Facebook, page_id пустой). Канал Buffer с тем же именем скрывается («вместо Buffer»). */
export async function saveInstagramLogin(
  env: Env,
  acc: { userId: string; username: string; token: string },
  bufferChannels: ReadonlyArray<Channel>,
): Promise<boolean> {
  const id = `ig:${acc.userId}`;
  // Instagram, уже подключённый через страницу Facebook, не трогаем (у него свой ключ страницы)
  const existing = await env.DB.prepare("SELECT page_id FROM direct_accounts WHERE id = ?").bind(id).first<{ page_id: string | null }>();
  if (existing?.page_id) return false;
  const hidden = new Set(await hiddenIds(env.DB));
  hidden.delete(id); // владелец сам вошёл этим аккаунтом — значит, хочет его вернуть
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(HIDDEN_KEY, JSON.stringify([...hidden]), Date.now())
    .run();
  const name = acc.username.toLowerCase();
  const buf = bufferChannels.find((c) => c.service === "instagram" && (c.name.toLowerCase() === name || (c.displayName ?? "").toLowerCase() === name));
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO direct_accounts (id, service, name, external_id, page_id, token_enc, token_expires_at, replaces, slots, created_at, updated_at)
     VALUES (?, 'instagram', ?, ?, NULL, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, token_enc = excluded.token_enc, page_id = NULL, token_expires_at = excluded.token_expires_at,
       replaces = COALESCE(direct_accounts.replaces, excluded.replaces), updated_at = excluded.updated_at`,
  )
    .bind(id, acc.username, acc.userId, await seal(env.TOKEN_KEY, acc.token), null, buf?.id ?? null, JSON.stringify(buf?.schedule ?? DEFAULT_SLOTS), now, now)
    .run();
  return true;
}

export async function disconnectAccount(db: D1Database, id: string): Promise<void> {
  const hidden = [...new Set([...(await hiddenIds(db)), id])];
  await db.batch([
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(HIDDEN_KEY, JSON.stringify(hidden), Date.now()),
    db.prepare("DELETE FROM direct_posts WHERE account_id = ? AND status IN ('draft','scheduled')").bind(id),
    db.prepare("DELETE FROM direct_accounts WHERE id = ?").bind(id),
  ]);
}

export async function setSlots(db: D1Database, id: string, slots: ReadonlyArray<Slot>): Promise<void> {
  await db.prepare("UPDATE direct_accounts SET slots = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(slots), Date.now(), id).run();
}

/** Ближайший свободный слот очереди этого аккаунта (как «Add to queue» в Buffer). */
async function nextSlot(db: D1Database, a: AccountRow, taken: number[]): Promise<number> {
  const rows = await db
    .prepare("SELECT due_at FROM direct_posts WHERE account_id = ? AND status IN ('scheduled','processing') AND due_at > ?")
    .bind(a.id, Date.now())
    .all<{ due_at: number }>();
  const busy = [...rows.results.map((r) => r.due_at), ...taken];
  const slots = slotsOf(a);
  const minAt = Date.now() + 5 * 60_000;
  for (let i = 0; i < 28; i++) {
    const t = new Date(Date.now() + TBILISI_OFFSET_MS + i * 86_400_000);
    const code = DAY_CODES[(t.getUTCDay() + 6) % 7];
    const s = slots.find((x) => x.day === code);
    if (!s || s.paused) continue;
    for (const hm of [...s.times].sort()) {
      const [hh, mm] = hm.split(":").map(Number);
      const at = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hh ?? 0, mm ?? 0) - TBILISI_OFFSET_MS;
      if (at < minAt || busy.some((b) => Math.abs(b - at) < 60_000)) continue;
      return at;
    }
  }
  return Date.now() + 86_400_000;
}

/** Создать прямые посты по целям окна поста. */
export async function createDirectPosts(
  db: D1Database,
  input: ComposeInput,
  targets: ComposeInput["targets"],
  author: "owner" | "claude",
): Promise<ComposeResult["results"]> {
  const out: ComposeResult["results"] = [];
  const takenByAccount = new Map<string, number[]>();
  for (const t of targets) {
    const a = await db.prepare("SELECT * FROM direct_accounts WHERE id = ?").bind(t.channelId).first<AccountRow>();
    if (!a) {
      out.push({ channelId: t.channelId, ok: false, postId: null, error: "Аккаунт не подключён" });
      continue;
    }
    const limit = TEXT_LIMITS[a.service];
    if (limit && t.text.length > limit) {
      out.push({ channelId: a.id, ok: false, postId: null, error: `Подпись длиннее ${limit} знаков` });
      continue;
    }
    let due: number | null;
    if (input.mode === "draft") due = null;
    else if (input.mode === "schedule") due = input.dueAt ?? Date.now();
    else if (input.mode === "now") due = Date.now();
    else {
      const taken = takenByAccount.get(a.id) ?? [];
      due = await nextSlot(db, a, taken);
      takenByAccount.set(a.id, [...taken, due]);
    }
    const id = `dp_${crypto.randomUUID()}`;
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO direct_posts (id, account_id, media_id, text, title, first_comment, thumb_ms, due_at, status, author, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, a.id, input.mediaId, t.text, t.title ?? null, t.firstComment?.trim() || null, input.thumbnailMs ?? null, due, due === null ? "draft" : "scheduled", author, now, now)
      .run();
    out.push({ channelId: a.id, ok: true, postId: id, error: null });
  }
  return out;
}

const STATUS: Record<PostRow["status"], BufferPost["status"]> = { draft: "draft", scheduled: "scheduled", processing: "sending", sent: "sent", error: "error" };

async function toPosts(db: D1Database, rows: ReadonlyArray<PostRow>): Promise<BufferPost[]> {
  if (rows.length === 0) return [];
  const accounts = new Map((await listAccounts(db)).map((a) => [a.id, a]));
  const ids = [...new Set(rows.map((r) => r.media_id))];
  const media = new Map<string, string | null>();
  const m = await db
    .prepare(`SELECT id, r2_key, deleted_at FROM media WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: string; r2_key: string; deleted_at: number | null }>();
  for (const r of m.results) media.set(r.id, r.deleted_at ? null : `/media/${r.r2_key}`);
  return rows.map((r) => ({
    id: r.id,
    channelId: r.account_id,
    service: accounts.get(r.account_id)?.service ?? "instagram",
    status: STATUS[r.status],
    text: r.text,
    dueAt: r.due_at,
    sentAt: r.sent_at,
    error: r.error,
    isCustomScheduled: true,
    externalLink: r.external_link,
    thumbnail: null,
    mediaId: r.media_id,
    mediaUrl: media.get(r.media_id) ?? null,
  }));
}

export async function listDirectPosts(db: D1Database, from: number, to: number): Promise<{ items: BufferPost[]; drafts: BufferPost[] }> {
  const ranged = await db
    .prepare("SELECT * FROM direct_posts WHERE due_at >= ? AND due_at < ? ORDER BY due_at")
    .bind(from, to)
    .all<PostRow>();
  const drafts = await db.prepare("SELECT * FROM direct_posts WHERE due_at IS NULL ORDER BY created_at DESC LIMIT 100").all<PostRow>();
  return { items: await toPosts(db, ranged.results), drafts: await toPosts(db, drafts.results) };
}

async function getPost(db: D1Database, id: string): Promise<PostRow> {
  const r = await db.prepare("SELECT * FROM direct_posts WHERE id = ?").bind(id).first<PostRow>();
  if (!r) throw new MetaError("Пост не найден");
  return r;
}
async function one(db: D1Database, id: string): Promise<BufferPost> {
  const [p] = await toPosts(db, [await getPost(db, id)]);
  if (!p) throw new MetaError("Пост не найден");
  return p;
}
const editable = (p: PostRow) => p.status === "draft" || p.status === "scheduled" || p.status === "error";

export async function moveDirect(db: D1Database, id: string, dueAt: number): Promise<BufferPost> {
  const p = await getPost(db, id);
  if (!editable(p)) throw new MetaError("Пост уже отправляется или вышел");
  await db.prepare("UPDATE direct_posts SET due_at = ?, status = 'scheduled', error = NULL, updated_at = ? WHERE id = ?").bind(dueAt, Date.now(), id).run();
  return one(db, id);
}
export async function textDirect(db: D1Database, id: string, text: string, title?: string, firstComment?: string): Promise<BufferPost> {
  const p = await getPost(db, id);
  if (!editable(p)) throw new MetaError("Пост уже отправляется или вышел");
  await db
    .prepare("UPDATE direct_posts SET text = ?, title = COALESCE(?, title), first_comment = COALESCE(?, first_comment), updated_at = ? WHERE id = ?")
    .bind(text, title ?? null, firstComment === undefined ? null : firstComment.trim() || null, Date.now(), id)
    .run();
  return one(db, id);
}
export async function shareNowDirect(db: D1Database, id: string): Promise<BufferPost> {
  return moveDirect(db, id, Date.now());
}
export async function retryDirect(db: D1Database, id: string): Promise<BufferPost> {
  const p = await getPost(db, id);
  const a = await db.prepare("SELECT * FROM direct_accounts WHERE id = ?").bind(p.account_id).first<AccountRow>();
  if (!a) throw new MetaError("Аккаунт не подключён");
  const due = await nextSlot(db, a, []);
  await db
    .prepare("UPDATE direct_posts SET due_at = ?, status = 'scheduled', error = NULL, attempts = 0, container_id = NULL, updated_at = ? WHERE id = ?")
    .bind(due, Date.now(), id)
    .run();
  return one(db, id);
}
export async function deleteDirect(db: D1Database, id: string): Promise<void> {
  const p = await getPost(db, id);
  if (p.status === "processing") throw new MetaError("Пост сейчас отправляется — подождите минуту");
  await db.prepare("DELETE FROM direct_posts WHERE id = ?").bind(id).run();
}

// ---- Отправка к сроку (cron раз в минуту) ----
async function fail(db: D1Database, p: PostRow, message: string): Promise<void> {
  await db.prepare("UPDATE direct_posts SET status = 'error', error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), Date.now(), p.id).run();
}

async function step(env: Env, p: PostRow): Promise<void> {
  const db = env.DB;
  const a = await db.prepare("SELECT * FROM direct_accounts WHERE id = ?").bind(p.account_id).first<AccountRow>();
  if (!a) return fail(db, p, "Аккаунт отключён");
  const now = Date.now();
  if (a.service === "telegram") return stepTelegram(env, p, a);
  const token = await open(env.TOKEN_KEY, a.token_enc);

  if (p.status === "scheduled") {
    const m = await db.prepare("SELECT r2_key FROM media WHERE id = ? AND deleted_at IS NULL").bind(p.media_id).first<{ r2_key: string }>();
    if (!m) return fail(db, p, "Ролик удалён из библиотеки");
    const videoUrl = `${PUBLIC_ORIGIN}/media/${m.r2_key}`;
    const caption = p.text;
    let container: string;
    if (a.service === "instagram") container = await igCreateContainer(a.external_id, token, { videoUrl, caption, thumbMs: p.thumb_ms ?? undefined });
    else if (a.service === "facebook") container = await fbPublishReel(a.external_id, token, videoUrl, caption);
    else return fail(db, p, "YouTube напрямую ещё не подключён");
    await db
      .prepare("UPDATE direct_posts SET status = 'processing', container_id = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?")
      .bind(container, now, p.id)
      .run();
    return;
  }

  // processing: ждём обработку и публикуем
  if (!p.container_id) return fail(db, p, "Нет id загрузки");
  if (now - p.updated_at > PROCESS_TIMEOUT_MS) return fail(db, p, "Соцсеть слишком долго обрабатывает ролик — нажмите «Повторить»");
  if (a.service === "instagram") {
    const st = await igContainerStatus(p.container_id, token);
    if (st.status === "ERROR" || st.status === "EXPIRED") return fail(db, p, `Instagram не принял ролик${st.message ? `: ${st.message}` : ""}`);
    if (st.status !== "FINISHED") return;
    const pub = await igPublish(a.external_id, token, p.container_id);
    await db
      .prepare("UPDATE direct_posts SET status = 'sent', external_id = ?, external_link = ?, sent_at = ?, error = NULL, updated_at = ? WHERE id = ?")
      .bind(pub.id, pub.link, now, now, p.id)
      .run();
    if (p.first_comment) {
      await igComment(pub.id, token, p.first_comment).catch(async (e: unknown) => {
        await db.prepare("UPDATE direct_posts SET error = ? WHERE id = ?").bind(`Вышел, но первый комментарий не добавился: ${e instanceof Error ? e.message : ""}`, p.id).run();
      });
    }
    return;
  }
  if (a.service === "facebook") {
    const st = await fbVideoStatus(p.container_id, token);
    if (st.error) return fail(db, p, st.error);
    if (!st.done) return;
    await db
      .prepare("UPDATE direct_posts SET status = 'sent', external_id = ?, external_link = ?, sent_at = ?, error = NULL, updated_at = ? WHERE id = ?")
      .bind(p.container_id, st.link, now, now, p.id)
      .run();
  }
}

/** Telegram: отправка в один шаг. Ролик больше 50 МБ — берём лёгкую копию «имя.tg.mp4». */
async function stepTelegram(env: Env, p: PostRow, a: AccountRow): Promise<void> {
  const db = env.DB;
  if (p.status === "processing") {
    // отправка идёт в другом запуске; если зависла — не шлём второй раз, чтобы не было дубля
    if (Date.now() - p.updated_at > 15 * 60_000) return fail(db, p, "Не удалось подтвердить отправку в Telegram — проверьте канал; если поста нет, нажмите «Повторить»");
    return;
  }
  const token = env.TG_BOT_TOKEN?.trim();
  if (!token) return fail(db, p, "Не задан ключ бота Telegram (TG_BOT_TOKEN)");
  const m = await db.prepare("SELECT r2_key, name, size FROM media WHERE id = ? AND deleted_at IS NULL").bind(p.media_id).first<{ r2_key: string; name: string; size: number }>();
  if (!m) return fail(db, p, "Ролик удалён из библиотеки");
  let key = m.r2_key;
  let name = m.name;
  if (m.size > TG_MAX_BYTES) {
    const v = await db.prepare("SELECT r2_key, name, size FROM media_variants WHERE media_id = ? AND kind = 'tg'").bind(p.media_id).first<{ r2_key: string; name: string; size: number }>();
    if (!v) return fail(db, p, "Ролик больше 50 МБ, а лёгкой копии для Telegram нет. Claude делает её при монтаже («имя.tg.mp4» в «Готовое») — потом нажмите «Повторить»");
    if (v.size > TG_MAX_BYTES) return fail(db, p, "Лёгкая копия для Telegram тоже больше 50 МБ — нужна сильнее сжатая");
    key = v.r2_key;
    name = v.name;
  }
  const obj = await env.BUCKET.get(key);
  if (!obj) return fail(db, p, "Файл ролика не найден в хранилище");
  await db.prepare("UPDATE direct_posts SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?").bind(Date.now(), p.id).run();
  const blob = new Blob([await obj.arrayBuffer()], { type: obj.httpMetadata?.contentType ?? "video/mp4" });
  let sent: { messageId: number; link: string };
  try {
    const s = await readSettings(db);
    sent = await sendVideo(token, a.external_id, blob, name, p.text, s.tgButtonUrl ? { text: s.tgButtonText || "📅 Записаться", url: s.tgButtonUrl } : null);
  } catch (e: unknown) {
    if (e instanceof TelegramError) return fail(db, p, e.message);
    return fail(db, p, "Связь с Telegram прервалась — проверьте канал; если поста нет, нажмите «Повторить»");
  }
  const now = Date.now();
  await db
    .prepare("UPDATE direct_posts SET status = 'sent', external_id = ?, external_link = ?, sent_at = ?, error = NULL, updated_at = ? WHERE id = ?")
    .bind(String(sent.messageId), sent.link, now, now, p.id)
    .run();
}

/** Обработать созревшие посты (не больше 5 за раз, чтобы уложиться в лимиты Worker). */
export async function processDirectQueue(env: Env): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT * FROM direct_posts WHERE (status = 'scheduled' AND due_at <= ?) OR status = 'processing' ORDER BY due_at LIMIT 5",
  )
    .bind(Date.now())
    .all<PostRow>();
  for (const p of rows.results) {
    try {
      await step(env, p);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "ошибка";
      // сетевые сбои — повторим на следующей минуте (до 3 попыток), ошибки Meta — сразу показываем
      if (e instanceof MetaError || e instanceof TelegramError || p.attempts >= 3) await fail(env.DB, p, msg);
      else await env.DB.prepare("UPDATE direct_posts SET attempts = attempts + 1 WHERE id = ?").bind(p.id).run();
    }
  }
  return rows.results.length;
}
