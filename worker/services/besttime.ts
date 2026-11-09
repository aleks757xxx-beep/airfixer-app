import { StatPostSchema, TBILISI_OFFSET_MS, type BestTimes } from "../../shared/schemas";

/**
 * «Лучшее время» (решение владельца 08.11.2026): по просмотрам за первые 24 часа, отдельно по каждой соцсети,
 * нормировано к среднему канала; карта день × час; «В очередь» сам ставит пост в лучший час,
 * примерно каждый 5-й пост — в пробный (мало данных), чтобы карта уточнялась. Выкладка только 8:00–22:00 по Тбилиси.
 *
 * Данные: прямые посты (views_24h — точные 24 ч; иначе последние цифры с меньшим весом) + копия истории Buffer (последние цифры).
 * Данных мало, поэтому карта = профиль дней × профиль часов, каждый сглажен к общему профилю всех каналов.
 */

export const HOUR_FROM = 8;
export const HOUR_TO = 22; // последний разрешённый час (22:00)
const HOURS = HOUR_TO - HOUR_FROM + 1;
const MIN_SAMPLES = 6; // меньше — канал считаем по общему профилю
const SHRINK = 3; // «вес» общего профиля при сглаживании
const GAP_MS = 3 * 3_600_000; // посты одного канала — не чаще раза в 3 часа
const HORIZON_DAYS = 7;
const SOON_BONUS = 0.97; // чем позже день, тем чуть хуже — чтобы не откладывать на неделю ради +3 %

interface Sample {
  channelId: string;
  at: number;
  views: number;
  w: number; // 1 — просмотры за 24 ч, 0.5 — последние цифры
}

const local = (t: number) => new Date(t + TBILISI_OFFSET_MS);
const dayOf = (t: number) => (local(t).getUTCDay() + 6) % 7; // пн = 0
const hourOf = (t: number) => local(t).getUTCHours();

/** Все посты с просмотрами: прямые + копия истории Buffer (каналы, переехавшие напрямую, — под прямым аккаунтом). */
async function samples(db: D1Database): Promise<Sample[]> {
  const out: Sample[] = [];
  const now = Date.now();
  const direct = await db
    .prepare("SELECT account_id, sent_at, views_24h, metrics FROM direct_posts WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?")
    .bind(now - 24 * 3_600_000)
    .all<{ account_id: string; sent_at: number; views_24h: number | null; metrics: string | null }>();
  for (const r of direct.results) {
    if (r.views_24h !== null) {
      out.push({ channelId: r.account_id, at: r.sent_at, views: r.views_24h, w: 1 });
      continue;
    }
    try {
      const v = (JSON.parse(r.metrics ?? "[]") as Array<{ type: string; value: number }>).find((m) => m.type === "views")?.value;
      if (typeof v === "number") out.push({ channelId: r.account_id, at: r.sent_at, views: v, w: 0.5 });
    } catch {
      /* без цифр */
    }
  }
  const moved = new Map(
    (await db.prepare("SELECT id, replaces FROM direct_accounts WHERE replaces IS NOT NULL").all<{ id: string; replaces: string }>()).results.map((a) => [a.replaces, a.id]),
  );
  const arch = await db.prepare("SELECT post FROM buffer_archive").all<{ post: string }>();
  for (const row of arch.results) {
    const p = StatPostSchema.safeParse(JSON.parse(row.post));
    if (!p.success) continue;
    const at = p.data.sentAt ?? p.data.dueAt;
    const v = p.data.metrics.find((m) => m.type === "views")?.value;
    if (!at || typeof v !== "number") continue;
    out.push({ channelId: moved.get(p.data.channelId) ?? p.data.channelId, at, views: v, w: 0.5 });
  }
  return out;
}

interface Profile {
  day: number[]; // 7
  hour: number[]; // 24
  count: number[][]; // [7][24] — сколько постов было в эту клетку
  samples: number;
}

/** Профиль: средняя «доля от обычного» по дням и часам (1 = как обычно), сглаженная к base. */
function profile(list: Sample[], base: Profile | null): Profile {
  const byCh = new Map<string, { s: number; w: number }>();
  for (const x of list) {
    const c = byCh.get(x.channelId) ?? { s: 0, w: 0 };
    c.s += x.views * x.w;
    c.w += x.w;
    byCh.set(x.channelId, c);
  }
  const dayS = Array<number>(7).fill(0);
  const dayW = Array<number>(7).fill(0);
  const hourS = Array<number>(24).fill(0);
  const hourW = Array<number>(24).fill(0);
  const count = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let n = 0;
  for (const x of list) {
    const c = byCh.get(x.channelId);
    if (!c || c.w < 1.5) continue; // у канала слишком мало постов, чтобы понять «обычно»
    const mean = c.s / c.w;
    if (mean <= 0) continue;
    const r = Math.min(x.views / mean, 5); // вирусный пост не должен перевешивать всё
    const d = dayOf(x.at);
    const h = hourOf(x.at);
    dayS[d] = (dayS[d] ?? 0) + r * x.w;
    dayW[d] = (dayW[d] ?? 0) + x.w;
    // соседние часы тоже немного «знают» о посте
    for (const [dh, k] of [[0, 1], [-1, 0.5], [1, 0.5]] as const) {
      const hh = h + dh;
      if (hh < 0 || hh > 23) continue;
      hourS[hh] = (hourS[hh] ?? 0) + r * x.w * k;
      hourW[hh] = (hourW[hh] ?? 0) + x.w * k;
    }
    const row = count[d];
    if (row) row[h] = (row[h] ?? 0) + 1;
    n++;
  }
  const smooth = (s: number, w: number, prior: number) => (s + SHRINK * prior) / (w + SHRINK);
  return {
    day: dayS.map((s, i) => smooth(s, dayW[i] ?? 0, base?.day[i] ?? 1)),
    hour: hourS.map((s, i) => smooth(s, hourW[i] ?? 0, base?.hour[i] ?? 1)),
    count,
    samples: n,
  };
}

const score = (p: Profile, d: number, h: number) => (p.day[d] ?? 1) * (p.hour[h] ?? 1);

/** Профили всех каналов с данными + общий. */
async function profiles(db: D1Database): Promise<{ global: Profile; byChannel: Map<string, Profile> }> {
  const all = await samples(db);
  const global = profile(all, null);
  const byChannel = new Map<string, Profile>();
  for (const ch of new Set(all.map((x) => x.channelId))) {
    const own = all.filter((x) => x.channelId === ch);
    if (own.length >= MIN_SAMPLES) byChannel.set(ch, profile(own, global));
  }
  return { global, byChannel };
}

/** Карта для экрана «Статистика». */
export async function bestTimes(db: D1Database, channels: ReadonlyArray<{ id: string; name: string; service: string }>): Promise<BestTimes> {
  const { global, byChannel } = await profiles(db);
  const items = channels.map((c) => {
    const own = byChannel.get(c.id);
    const p = own ?? (global.samples >= MIN_SAMPLES ? global : null);
    const cells = Array.from({ length: 7 }, (_, d) => Array.from({ length: HOURS }, (_, i) => (p ? Math.round(score(p, d, HOUR_FROM + i) * 100) / 100 : 0)));
    const counts = Array.from({ length: 7 }, (_, d) => Array.from({ length: HOURS }, (_, i) => own?.count[d]?.[HOUR_FROM + i] ?? 0));
    const best = p
      ? cells
          .flatMap((row, d) => row.map((v, i) => ({ day: d, hour: HOUR_FROM + i, v })))
          .sort((a, b) => b.v - a.v)
          .slice(0, 3)
          .map(({ day, hour }) => ({ day, hour }))
      : [];
    return { channelId: c.id, name: c.name, service: c.service, samples: own?.samples ?? 0, source: own ? ("own" as const) : p ? ("all" as const) : ("none" as const), cells, counts, best };
  });
  return { hourFrom: HOUR_FROM, hourTo: HOUR_TO, items };
}

/**
 * Время для «В очередь»: лучший свободный час в ближайшую неделю (8:00–22:00, не ближе 3 ч к другим постам канала).
 * explore — пробный пост: час, где постов было меньше всего (в ближайшие 3 дня).
 * null — данных нет, пусть работает обычное расписание слотов.
 */
export async function bestSlot(
  db: D1Database,
  channelId: string,
  busy: ReadonlyArray<number>,
  explore: boolean,
  now = Date.now(),
): Promise<number | null> {
  const { global, byChannel } = await profiles(db);
  const p = byChannel.get(channelId) ?? (global.samples >= MIN_SAMPLES ? global : null);
  if (!p) return null;
  const start = now + 15 * 60_000;
  const dayStart = Date.UTC(local(now).getUTCFullYear(), local(now).getUTCMonth(), local(now).getUTCDate()) - TBILISI_OFFSET_MS;
  let best: { at: number; v: number } | null = null;
  for (let day = 0; day < (explore ? 3 : HORIZON_DAYS); day++) {
    for (let h = HOUR_FROM; h <= HOUR_TO; h++) {
      const at = dayStart + day * 86_400_000 + h * 3_600_000;
      if (at < start || busy.some((b) => Math.abs(b - at) < GAP_MS)) continue;
      const d = dayOf(at);
      // пробный: меньше всего данных; при равенстве — раньше
      const v = explore ? -(p.count[d]?.[h] ?? 0) - day * 0.001 : score(p, d, h) * SOON_BONUS ** day;
      if (!best || v > best.v) best = { at, v };
    }
  }
  return best?.at ?? null;
}

/** Каждый 5-й пост канала — пробный (для каналов Buffer счёта постов у нас нет — с вероятностью 1/5). */
export async function isExploreTurn(db: D1Database, channelId: string): Promise<boolean> {
  if (!/^(ig|fb|yt|tg|th):/.test(channelId)) return Math.random() < 0.2;
  const r = await db.prepare("SELECT COUNT(*) AS n FROM direct_posts WHERE account_id = ? AND status != 'draft'").bind(channelId).first<{ n: number }>();
  return ((r?.n ?? 0) + 1) % 5 === 0;
}

/** Средние просмотры поста по каналам (для порядка «сначала где больше смотрят»). */
async function reach(db: D1Database): Promise<Map<string, number>> {
  const out = new Map<string, { s: number; w: number }>();
  for (const x of await samples(db)) {
    const c = out.get(x.channelId) ?? { s: 0, w: 0 };
    out.set(x.channelId, { s: c.s + x.views * x.w, w: c.w + x.w });
  }
  return new Map([...out].map(([k, v]) => [k, v.w ? v.s / v.w : 0]));
}

/**
 * «В очередь» в несколько соцсетей (решение владельца 09.11.2026): один ролик — по одной соцсети в день,
 * чтобы человек, подписанный на несколько, не видел его везде сразу. Порядок — сначала где больше просмотров,
 * время — лучший час соцсети в её день (8:00–22:00, не ближе 3 ч к другим её постам).
 */
export async function spreadSlots(
  db: D1Database,
  channelIds: ReadonlyArray<string>,
  busyOf: (channelId: string) => ReadonlyArray<number>,
  now = Date.now(),
): Promise<Map<string, number>> {
  const { global, byChannel } = await profiles(db);
  const views = await reach(db);
  const order = [...channelIds].sort((a, b) => (views.get(b) ?? -1) - (views.get(a) ?? -1));
  const start = now + 15 * 60_000;
  const dayStart = Date.UTC(local(now).getUTCFullYear(), local(now).getUTCMonth(), local(now).getUTCDate()) - TBILISI_OFFSET_MS;
  const out = new Map<string, number>();
  let day = 0;
  for (const ch of order) {
    const p = byChannel.get(ch) ?? (global.samples >= MIN_SAMPLES ? global : null);
    const busy = busyOf(ch);
    for (let tries = 0; tries < 30; tries++, day++) {
      let best: { at: number; v: number } | null = null;
      for (let h = HOUR_FROM; h <= HOUR_TO; h++) {
        const at = dayStart + day * 86_400_000 + h * 3_600_000;
        if (at < start || busy.some((b) => Math.abs(b - at) < GAP_MS)) continue;
        const v = p ? score(p, dayOf(at), h) : -Math.abs(h - 12); // нет данных — ближе к полудню
        if (!best || v > best.v) best = { at, v };
      }
      if (best) {
        out.set(ch, best.at);
        day++;
        break;
      }
    }
  }
  return out;
}
