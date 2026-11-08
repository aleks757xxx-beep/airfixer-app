import { StatPostSchema, type PostMetric, type StatPost, type Stats } from "../../shared/schemas";
import type { Env } from "../env";
import { listAccounts } from "./direct";
import { loadBufferStats, postStats } from "./publish";

/**
 * История и статистика без привязки к Buffer:
 * - копия опубликованных постов Buffer с цифрами (buffer_archive) — Buffer стирает её при отключении канала;
 * - цифры прямых постов (direct_posts.metrics);
 * - посты канала Buffer, который заменён прямым аккаунтом, показываются под прямым аккаунтом.
 */

const DAY = 86_400_000;
const WINDOW = 90 * DAY;

/** Сохранить опубликованные посты Buffer за последние `days` дней (по 90 дней за запрос). */
export async function archiveBufferHistory(apiKey: string, db: D1Database, days: number): Promise<number> {
  let saved = 0;
  const now = Date.now();
  for (let to = now; to > now - days * DAY; to -= WINDOW) {
    const from = Math.max(to - WINDOW, now - days * DAY);
    const s = await loadBufferStats(apiKey, db, from, to);
    if (s.items.length === 0) continue;
    const at = Date.now();
    await db.batch(
      s.items.map((p) =>
        db
          .prepare(
            `INSERT INTO buffer_archive (id, channel_id, service, due_at, post, archived_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET post = excluded.post, due_at = excluded.due_at, archived_at = excluded.archived_at`,
          )
          .bind(p.id, p.channelId, p.service, p.dueAt, JSON.stringify(p), at),
      ),
    );
    saved += s.items.length;
  }
  return saved;
}

async function archived(db: D1Database, from: number, to: number): Promise<StatPost[]> {
  const r = await db.prepare("SELECT post FROM buffer_archive WHERE due_at >= ? AND due_at < ? ORDER BY due_at DESC").bind(from, to).all<{ post: string }>();
  const out: StatPost[] = [];
  for (const row of r.results) {
    const p = StatPostSchema.safeParse(JSON.parse(row.post));
    if (p.success) out.push(p.data);
  }
  return out;
}

interface DirectStatRow {
  id: string;
  account_id: string;
  service: string;
  text: string;
  due_at: number | null;
  sent_at: number | null;
  external_link: string | null;
  media_id: string;
  r2_key: string | null;
  metrics: string | null;
  metrics_updated_at: number | null;
}
async function directStats(db: D1Database, from: number, to: number): Promise<StatPost[]> {
  const r = await db
    .prepare(
      `SELECT p.id, p.account_id, a.service, p.text, p.due_at, p.sent_at, p.external_link, p.media_id, p.metrics, p.metrics_updated_at,
              CASE WHEN m.deleted_at IS NULL THEN m.r2_key END AS r2_key
       FROM direct_posts p JOIN direct_accounts a ON a.id = p.account_id LEFT JOIN media m ON m.id = p.media_id
       WHERE p.status = 'sent' AND p.sent_at >= ? AND p.sent_at < ? ORDER BY p.sent_at DESC`,
    )
    .bind(from, to)
    .all<DirectStatRow>();
  return r.results.map((p) => {
    let metrics: PostMetric[] = [];
    try {
      metrics = p.metrics ? (JSON.parse(p.metrics) as PostMetric[]) : [];
    } catch {
      metrics = [];
    }
    return {
      id: p.id,
      channelId: p.account_id,
      service: p.service,
      status: "sent",
      text: p.text,
      dueAt: p.due_at,
      sentAt: p.sent_at,
      error: null,
      isCustomScheduled: true,
      externalLink: p.external_link,
      thumbnail: null,
      mediaId: p.media_id,
      mediaUrl: p.r2_key ? `/media/${p.r2_key}` : null,
      metrics,
      metricsUpdatedAt: p.metrics_updated_at,
    };
  });
}

/** Статистика за период: Buffer (если доступен) + сохранённая копия + прямые посты. */
export async function allStats(env: Env, from: number, to: number): Promise<Stats> {
  const key = env.BUFFER_API_KEY?.trim();
  const live = key ? await postStats(key, env.DB, from, to).catch((e: unknown) => (console.error("buffer stats", e), null)) : null;
  const seen = new Set(live?.items.map((p) => p.id) ?? []);
  const old = (await archived(env.DB, from, to)).filter((p) => !seen.has(p.id));
  const direct = await directStats(env.DB, from, to);
  // канал Buffer, переехавший напрямую → показываем под прямым аккаунтом
  const moved = new Map((await listAccounts(env.DB)).filter((a) => a.replaces).map((a) => [a.replaces as string, a.id]));
  const items = [...(live?.items ?? []), ...old].map((p) => ({ ...p, channelId: moved.get(p.channelId) ?? p.channelId }));
  return { items: [...items, ...direct].sort((a, b) => (b.sentAt ?? b.dueAt ?? 0) - (a.sentAt ?? a.dueAt ?? 0)), updatedAt: Date.now() };
}
