import { StatPostSchema, type RepostList } from "../../shared/schemas";
import { MEDIA_COLS, toItem, type MediaRow } from "../routes/media";

/**
 * Повтор роликов (решение владельца 08.11.2026): повторяем только ролики с галочкой «можно повторять».
 * В соцсеть, где ролика ещё не было, — сразу; туда, где был, — не раньше чем через GAP_DAYS.
 * Показываем списком в «Библиотеке» с лучшим результатом ролика.
 */
export const GAP_DAYS = 90;
const DAY = 86_400_000;

interface Shown {
  channelId: string;
  at: number;
  views: number | null;
  link: string | null;
  text: string;
  title: string | null;
}

export async function listReposts(db: D1Database, channels: ReadonlyArray<{ id: string; replaces: string | null }>): Promise<RepostList> {
  const media = await db.prepare(`SELECT ${MEDIA_COLS} FROM media WHERE deleted_at IS NULL AND repostable = 1 ORDER BY created_at DESC LIMIT 200`).all<MediaRow>();
  if (media.results.length === 0) return { gapDays: GAP_DAYS, items: [] };
  const moved = new Map(channels.filter((c) => c.replaces).map((c) => [c.replaces as string, c.id]));
  const ids = media.results.map((m) => m.id);
  const marks = ids.map(() => "?").join(",");

  const history = new Map<string, Shown[]>();
  const add = (mediaId: string, s: Shown) => history.set(mediaId, [...(history.get(mediaId) ?? []), s]);
  const views = (metrics: string | null) => {
    try {
      const v = (JSON.parse(metrics ?? "[]") as Array<{ type: string; value: number }>).find((m) => m.type === "views")?.value;
      return typeof v === "number" ? v : null;
    } catch {
      return null;
    }
  };

  // прямые публикации
  const direct = await db
    .prepare(`SELECT media_id, account_id, sent_at, external_link, text, title, metrics, views_24h FROM direct_posts WHERE status = 'sent' AND media_id IN (${marks})`)
    .bind(...ids)
    .all<{ media_id: string; account_id: string; sent_at: number; external_link: string | null; text: string; title: string | null; metrics: string | null; views_24h: number | null }>();
  for (const r of direct.results) add(r.media_id, { channelId: r.account_id, at: r.sent_at, views: views(r.metrics) ?? r.views_24h, link: r.external_link, text: r.text, title: r.title });

  // через Buffer (связь пост ↔ ролик — post_media, цифры — копия истории)
  const buf = await db
    .prepare(`SELECT pm.media_id, a.post FROM post_media pm JOIN buffer_archive a ON a.id = pm.buffer_post_id WHERE pm.media_id IN (${marks})`)
    .bind(...ids)
    .all<{ media_id: string; post: string }>();
  for (const r of buf.results) {
    const p = StatPostSchema.safeParse(JSON.parse(r.post));
    if (!p.success) continue;
    const at = p.data.sentAt ?? p.data.dueAt;
    if (!at) continue;
    add(r.media_id, {
      channelId: moved.get(p.data.channelId) ?? p.data.channelId,
      at,
      views: p.data.metrics.find((m) => m.type === "views")?.value ?? null,
      link: p.data.externalLink,
      text: p.data.text,
      title: null,
    });
  }

  // «обычно» для канала — средние просмотры его постов
  const avg = new Map<string, number>();
  {
    const sums = new Map<string, { s: number; n: number }>();
    const bump = (ch: string, v: number) => {
      const c = sums.get(ch) ?? { s: 0, n: 0 };
      sums.set(ch, { s: c.s + v, n: c.n + 1 });
    };
    const d = await db
      .prepare("SELECT account_id, metrics, views_24h FROM direct_posts WHERE status = 'sent' AND (metrics IS NOT NULL OR views_24h IS NOT NULL)")
      .all<{ account_id: string; metrics: string | null; views_24h: number | null }>();
    for (const r of d.results) {
      const v = views(r.metrics) ?? r.views_24h;
      if (v !== null) bump(r.account_id, v);
    }
    const arch = await db.prepare("SELECT post FROM buffer_archive").all<{ post: string }>();
    for (const row of arch.results) {
      const p = StatPostSchema.safeParse(JSON.parse(row.post));
      const v = p.success ? p.data.metrics.find((m) => m.type === "views")?.value : undefined;
      if (p.success && typeof v === "number") bump(moved.get(p.data.channelId) ?? p.data.channelId, v);
    }
    for (const [ch, { s, n }] of sums) if (n >= 3 && s > 0) avg.set(ch, s / n);
  }

  const now = Date.now();
  const items = media.results.map((m) => {
    const h = (history.get(m.id) ?? []).sort((a, b) => b.at - a.at);
    let best: RepostList["items"][number]["best"] = null;
    for (const s of h) {
      if (s.views === null) continue;
      const a = avg.get(s.channelId);
      const ratio = a ? Math.round((s.views / a) * 10) / 10 : null;
      if (!best || (ratio ?? 0) > (best.ratio ?? 0) || (best.ratio === null && ratio === null && s.views > best.views)) best = { channelId: s.channelId, views: s.views, ratio };
    }
    const last = new Map<string, number>();
    for (const s of h) last.set(s.channelId, Math.max(last.get(s.channelId) ?? 0, s.at));
    const ready: string[] = [];
    const later: Array<{ channelId: string; from: number }> = [];
    for (const c of channels) {
      const t = last.get(c.id);
      if (t === undefined || now - t >= GAP_DAYS * DAY) ready.push(c.id);
      else later.push({ channelId: c.id, from: t + GAP_DAYS * DAY });
    }
    return {
      media: toItem(m),
      best,
      history: h.map(({ channelId, at, views: v, link }) => ({ channelId, at, views: v, link })),
      ready,
      later,
      lastText: h[0]?.text ?? null,
      lastTitle: h.find((s) => s.title)?.title ?? null,
    };
  });
  // сначала самые удачные
  items.sort((a, b) => (b.best?.ratio ?? 0) - (a.best?.ratio ?? 0) || (b.best?.views ?? 0) - (a.best?.views ?? 0));
  return { gapDays: GAP_DAYS, items };
}
