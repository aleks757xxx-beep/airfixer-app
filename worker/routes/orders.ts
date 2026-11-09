import { z } from "zod";
import { connectAgent } from "./connect";
import { Hono, type Context } from "hono";
import type { AppBindings } from "../env";
import {
  OrderAgentInputSchema,
  OrderInputSchema,
  OrderTextInputSchema,
  MediaRenameInputSchema,
  MediaSourcesInputSchema,
  SourceRenamedInputSchema,
  SourcesIndexInputSchema,
  SourcesIndexSchema,
  type Order,
  type OrderEvent,
  type OrderEventKind,
  type OrderList,
  type OrderStatus,
  type SourceRenames,
  type SourcesIndex,
} from "../../shared/schemas";
import { audit } from "../middleware/auth";
import { BufferError, bufferIntrospectType } from "../services/buffer";
import { MEDIA_COLS, cleanName, migrated, toItem, uploadToken, type MediaRow } from "./media";
import { markPublishedOutside, markRenamed, renameMedia, setSources, sourceRenames } from "../services/sources";

interface OrderRow {
  id: number;
  status: OrderStatus;
  shoot_date: string | null;
  folder: string | null;
  brief: string;
  duration_sec: number | null;
  style: string | null;
  created_at: number;
  updated_at: number;
}
interface EventRow {
  id: number;
  order_id: number;
  kind: OrderEventKind;
  author: "owner" | "claude";
  text: string | null;
  media_id: string | null;
  created_at: number;
}

const ORDER_COLS = "id, status, shoot_date, folder, brief, duration_sec, style, created_at, updated_at";
const OPEN: ReadonlyArray<OrderStatus> = ["new", "in_work", "draft", "revise"];
type Ctx = Context<AppBindings>;

/** Заказы с историей и роликами-черновиками. */
async function loadOrders(db: D1Database, where: string, binds: ReadonlyArray<string | number>): Promise<Order[]> {
  const orders = await db
    .prepare(`SELECT ${ORDER_COLS} FROM edit_orders WHERE ${where} ORDER BY (status IN ('accepted','cancelled')), updated_at DESC LIMIT 50`)
    .bind(...binds)
    .all<OrderRow>();
  if (orders.results.length === 0) return [];
  const ids = orders.results.map((o) => o.id);
  const marks = ids.map(() => "?").join(",");
  const events = await db
    .prepare(`SELECT id, order_id, kind, author, text, media_id, created_at FROM edit_events WHERE order_id IN (${marks}) ORDER BY id`)
    .bind(...ids)
    .all<EventRow>();
  const mediaIds = [...new Set(events.results.map((e) => e.media_id).filter((m): m is string => m !== null))];
  const media = new Map<string, MediaRow>();
  if (mediaIds.length > 0) {
    const rows = await db
      .prepare(`SELECT ${MEDIA_COLS} FROM media WHERE deleted_at IS NULL AND id IN (${mediaIds.map(() => "?").join(",")})`)
      .bind(...mediaIds)
      .all<MediaRow>();
    for (const r of rows.results) media.set(r.id, r);
  }
  const byOrder = new Map<number, OrderEvent[]>();
  for (const e of events.results) {
    const m = e.media_id ? media.get(e.media_id) : undefined;
    const ev: OrderEvent = { id: e.id, kind: e.kind, author: e.author, text: e.text, media: m ? toItem(m) : null, createdAt: e.created_at };
    byOrder.set(e.order_id, [...(byOrder.get(e.order_id) ?? []), ev]);
  }
  return orders.results.map((o) => ({
    id: o.id,
    status: o.status,
    shootDate: o.shoot_date,
    folder: o.folder,
    brief: o.brief,
    durationSec: o.duration_sec,
    style: o.style,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    events: byOrder.get(o.id) ?? [],
  }));
}

async function oneOrder(db: D1Database, id: number): Promise<Order | null> {
  return (await loadOrders(db, "id = ?", [id]))[0] ?? null;
}

/** Сменить статус (если текущий допустим) и записать событие — одной транзакцией. */
async function transition(
  c: Ctx,
  opts: { from: ReadonlyArray<OrderStatus>; to: OrderStatus | null; kind: OrderEventKind; author: "owner" | "claude"; text?: string | null; mediaId?: string | null },
): Promise<Response> {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: "Неверный номер заказа" }, 400);
  const cur = await c.env.DB.prepare("SELECT status FROM edit_orders WHERE id = ?").bind(id).first<{ status: OrderStatus }>();
  if (!cur) return c.json({ error: "Заказ не найден" }, 404);
  if (!opts.from.includes(cur.status)) return c.json({ error: "Сейчас это действие недоступно — обновите страницу" }, 409);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE edit_orders SET status = ?, updated_at = ? WHERE id = ?").bind(opts.to ?? cur.status, now, id),
    c.env.DB.prepare("INSERT INTO edit_events (order_id, kind, author, text, media_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      opts.kind,
      opts.author,
      opts.text || null,
      opts.mediaId ?? null,
      now,
    ),
  ]);
  await audit(c.env.DB, `order ${opts.kind}`, `#${id}`);
  const order = await oneOrder(c.env.DB, id);
  return order ? c.json({ order }) : c.json({ error: "Заказ не найден" }, 404);
}

async function readSources(db: D1Database): Promise<SourcesIndex> {
  const row = await db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'sources_index'").first<{ value: string | null; updated_at: number | null }>();
  if (!row?.value) return { updatedAt: null, folders: [] };
  const parsed = SourcesIndexSchema.safeParse({ updatedAt: row.updated_at, folders: (JSON.parse(row.value) as { folders?: unknown }).folders });
  return parsed.success ? parsed.data : { updatedAt: null, folders: [] };
}

/** Заказы монтажа (только после входа). */
export const orders = new Hono<AppBindings>()
  .use("*", migrated)
  .get("/", async (c) => {
    const body: OrderList = { items: await loadOrders(c.env.DB, "1 = 1", []) };
    return c.json(body);
  })
  .get("/sources", async (c) => c.json(await readSources(c.env.DB)))
  .post("/", async (c) => {
    const parsed = OrderInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля заказа" }, 400);
    const d = parsed.data;
    const now = Date.now();
    const res = await c.env.DB.prepare(
      "INSERT INTO edit_orders (status, shoot_date, folder, brief, duration_sec, style, created_at, updated_at) VALUES ('new', ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(d.shootDate, d.folder || null, d.brief, d.durationSec, d.style || null, now, now)
      .run();
    const id = Number(res.meta.last_row_id);
    await c.env.DB.prepare("INSERT INTO edit_events (order_id, kind, author, text, media_id, created_at) VALUES (?, 'created', 'owner', NULL, NULL, ?)")
      .bind(id, now)
      .run();
    await audit(c.env.DB, "order created", `#${id}`);
    const order = await oneOrder(c.env.DB, id);
    return order ? c.json({ order }) : c.json({ error: "Не сохранилось" }, 500);
  })
  .post("/:id/revise", async (c) => {
    const p = OrderTextInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Напишите, что поправить" }, 400);
    const r = await transition(c, { from: ["draft"], to: "revise", kind: "revise", author: "owner", text: p.data.text });
    return r;
  })
  .post("/:id/comment", async (c) => {
    const p = OrderTextInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Напишите текст" }, 400);
    const r = await transition(c, { from: OPEN, to: null, kind: "comment", author: "owner", text: p.data.text });
    return r;
  })
  .post("/:id/accept", (c) => transition(c, { from: ["draft"], to: "accepted", kind: "accepted", author: "owner" }))
  .post("/:id/cancel", (c) => transition(c, { from: OPEN, to: "cancelled", kind: "cancelled", author: "owner" }));

/** Для Claude (по токену): открытые заказы, ответы, черновики, оглавление «Исходников». */
export const ordersAgent = new Hono<AppBindings>()
  .use("*", uploadToken)
  .use("*", migrated)
  .route("/connect", connectAgent)
  // Для Claude: журнал действий (входы, публикации) — разбирать проблемы. Только чтение, без IP.
  .get("/audit", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 40, 1), 200);
    const rows = await c.env.DB.prepare("SELECT at, action, details FROM audit_log ORDER BY at DESC LIMIT ?").bind(limit).all<{ at: number; action: string; details: string | null }>();
    const fails = await c.env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT ip) AS ips, MAX(at) AS last FROM login_attempts WHERE at > ?")
      .bind(Date.now() - 15 * 60_000)
      .first<{ n: number; ips: number; last: number | null }>();
    return c.json({ items: rows.results, failedLast15min: fails ?? { n: 0, ips: 0, last: null } });
  })
  .get("/orders", async (c) => {
    const all = c.req.query("all") === "1";
    const body: OrderList = {
      items: await loadOrders(c.env.DB, all ? "1 = 1" : "status IN ('new','in_work','revise')", []),
    };
    return c.json(body);
  })
  .post("/orders/:id", async (c) => {
    const p = OrderAgentInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверные данные" }, 400);
    const d = p.data;
    if (d.kind === "in_work") return transition(c, { from: ["new", "revise", "draft"], to: "in_work", kind: "in_work", author: "claude", text: d.text });
    if (d.kind === "comment") return transition(c, { from: OPEN, to: null, kind: "comment", author: "claude", text: d.text });
    const m = await c.env.DB.prepare("SELECT id FROM media WHERE id = ? AND deleted_at IS NULL").bind(d.mediaId).first<{ id: string }>();
    if (!m) return c.json({ error: "Ролик-черновик не найден в библиотеке" }, 404);
    return transition(c, { from: ["new", "in_work", "revise", "draft"], to: "draft", kind: "draft", author: "claude", text: d.text, mediaId: d.mediaId });
  })
  // Схема Buffer (только чтение): какие поля есть у постов, каналов и т.п.
  .get("/buffer/type/:name", async (c) => {
    const key = c.env.BUFFER_API_KEY?.trim();
    if (!key) return c.json({ error: "Нет ключа Buffer" }, 503);
    try {
      return c.json(await bufferIntrospectType(key, c.req.param("name")));
    } catch (e: unknown) {
      return c.json({ error: e instanceof BufferError ? e.message : "Ошибка Buffer" }, 502);
    }
  })
  // Для Claude: личный чат владельца с ботом для уведомлений (ID из CRM)
  .put("/notify-chat", async (c) => {
    const p = z.object({ chatId: z.string().regex(/^-?\d{5,20}$/) }).safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверный ID чата" }, 400);
    await c.env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('notify_chat_id', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(p.data.chatId, Date.now())
      .run();
    await audit(c.env.DB, "notify chat set (claude)");
    return c.json({ ok: true as const });
  })
  .put("/sources", async (c) => {
    const p = SourcesIndexInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверное оглавление" }, 400);
    await c.env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('sources_index', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(JSON.stringify(p.data), Date.now())
      .run();
    return c.json(await readSources(c.env.DB));
  })
  // Пометка использованных исходников (решение владельца 09.11.2026): после монтажа — список исходников ролика
  .put("/media/:id/sources", async (c) => {
    const p = MediaSourcesInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Неверный список исходников" }, 400);
    const m = await c.env.DB.prepare("SELECT id FROM media WHERE id = ?").bind(c.req.param("id")).first();
    if (!m) return c.json({ error: "Ролик не найден" }, 404);
    await setSources(c.env.DB, c.req.param("id"), p.data.items);
    return c.json({ ok: true as const });
  })
  // Ролик вышел мимо PostFixer — номер в «Готовом», исходники помечаются
  .put("/media/:id/published", async (c) => {
    const p = z.object({ number: z.number().int().min(1).max(100_000) }).safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверный номер" }, 400);
    try {
      if (!(await markPublishedOutside(c.env.DB, c.req.param("id"), p.data.number))) return c.json({ error: "Ролик не найден" }, 404);
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Ошибка" }, 409);
    }
    return c.json({ ok: true as const });
  })
  // Что переименовать на Mac (gotovoeMax — наибольший номер ролика в папке «Готовое» на диске)
  .get("/sources/renames", async (c) => {
    const max = Number(c.req.query("gotovoeMax") ?? 0);
    const r: SourceRenames = await sourceRenames(c.env.DB, Number.isFinite(max) && max > 0 ? Math.floor(max) : 0);
    return c.json(r);
  })
  .post("/sources/renamed", async (c) => {
    const p = SourceRenamedInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверные данные" }, 400);
    const n = await markRenamed(c.env.DB, p.data.folder, p.data.from, p.data.to);
    if (!n) return c.json({ error: "Такого исходника нет в списке" }, 404);
    return c.json({ ok: true as const });
  })
  // Ролик в «Готовом» переименован (сначала сюда, потом mv — чтобы автозагрузка не приняла его за новый)
  .post("/media/:id/rename", async (c) => {
    const p = MediaRenameInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверное имя" }, 400);
    if (!(await renameMedia(c.env.DB, c.req.param("id"), cleanName(p.data.name)))) return c.json({ error: "Ролик не найден" }, 404);
    await audit(c.env.DB, `media renamed (claude): ${p.data.name}`);
    return c.json({ ok: true as const });
  });
