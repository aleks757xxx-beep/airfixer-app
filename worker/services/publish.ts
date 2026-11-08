import { z } from "zod";
import type { BufferLimits, BufferPost, Channel, ComposeInput, ComposeResult, GoogleButton, ShareMode, Snippet, SnippetInput, StatPost, Stats } from "../../shared/schemas";
import { BufferError, bufferQuery } from "./buffer";

/** Публикация через Buffer: каналы, посты, создание, перенос, удаление. */

// ---- Кэш в D1: у Buffer лимит 100 запросов / 15 мин и 250 / сутки ----
async function cached<T>(db: D1Database, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const row = await db.prepare("SELECT value, at FROM buffer_cache WHERE key = ?").bind(key).first<{ value: string; at: number }>();
  if (row && Date.now() - row.at < ttlMs) return JSON.parse(row.value) as T;
  const value = await load();
  await db
    .prepare("INSERT INTO buffer_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at")
    .bind(key, JSON.stringify(value), Date.now())
    .run();
  return value;
}
/** После любого изменения постов — сбросить списки (каналы и вставки не трогаем). */
export async function invalidatePosts(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM buffer_cache WHERE key LIKE 'posts:%' OR key LIKE 'stats:%'").run();
}

let orgCache: { key: string; id: string } | null = null;
async function organizationId(apiKey: string): Promise<string> {
  if (orgCache?.key === apiKey) return orgCache.id;
  const d = await bufferQuery(apiKey, "query { account { organizations { id } } }", z.object({ account: z.object({ organizations: z.array(z.object({ id: z.string() })) }) }));
  const id = d.account.organizations[0]?.id;
  if (!id) throw new BufferError("В Buffer нет организации");
  orgCache = { key: apiKey, id };
  return id;
}

const RawChannel = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  service: z.string(),
  avatar: z.string(),
  timezone: z.string(),
  isQueuePaused: z.boolean(),
  isDisconnected: z.boolean(),
  isLocked: z.boolean(),
  postingSchedule: z.array(z.object({ day: z.string(), times: z.array(z.string()), paused: z.boolean() })),
});

let channelsCache: { at: number; items: Channel[] } | null = null;
export async function listChannels(apiKey: string, db: D1Database, fresh = false): Promise<Channel[]> {
  if (!fresh && channelsCache && Date.now() - channelsCache.at < 5 * 60_000) return channelsCache.items;
  if (fresh) await db.prepare("DELETE FROM buffer_cache WHERE key LIKE 'channels%'").run();
  const items = await cached(db, "channels:v2", 10 * 60_000, () => loadChannels(apiKey));
  channelsCache = { at: Date.now(), items };
  return items;
}
async function loadChannels(apiKey: string): Promise<Channel[]> {
  const org = await organizationId(apiKey);
  const d = await bufferQuery(
    apiKey,
    `query($org: OrganizationId!) { channels(input: { organizationId: $org }) {
      id name displayName service avatar timezone isQueuePaused isDisconnected isLocked postingSchedule { day times paused } } }`,
    z.object({ channels: z.array(RawChannel) }),
    { org },
  );
  const items: Channel[] = d.channels.map((c) => ({
    id: c.id,
    name: c.name,
    displayName: c.displayName,
    service: c.service,
    avatar: c.avatar,
    timezone: c.timezone,
    isQueuePaused: c.isQueuePaused,
    isDisconnected: c.isDisconnected,
    isLocked: c.isLocked,
    schedule: c.postingSchedule,
  }));
  return items;
}

const RawPost = z.object({
  id: z.string(),
  channelId: z.string(),
  channelService: z.string(),
  status: z.enum(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]),
  text: z.string(),
  dueAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  isCustomScheduled: z.boolean(),
  externalLink: z.string().nullable(),
  error: z.object({ message: z.string() }).nullable(),
  assets: z.array(z.object({ thumbnail: z.string().nullable().optional() })),
});
type RawPostT = z.infer<typeof RawPost>;
const POST_FIELDS = "id channelId channelService status text dueAt sentAt isCustomScheduled externalLink error { message } assets { thumbnail }";

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);
function toPost(p: RawPostT, media: ReadonlyMap<string, { mediaId: string; url: string | null }>): BufferPost {
  const m = media.get(p.id);
  return {
    id: p.id,
    channelId: p.channelId,
    service: p.channelService,
    status: p.status,
    text: p.text,
    dueAt: ms(p.dueAt),
    sentAt: ms(p.sentAt),
    error: p.error?.message ?? null,
    isCustomScheduled: p.isCustomScheduled,
    externalLink: p.externalLink,
    thumbnail: p.assets.find((a) => a.thumbnail)?.thumbnail ?? null,
    mediaId: m?.mediaId ?? null,
    mediaUrl: m?.url ?? null,
  };
}

/** Ролики библиотеки для постов (по нашей таблице post_media). */
async function mediaForPosts(db: D1Database, ids: ReadonlyArray<string>): Promise<Map<string, { mediaId: string; url: string | null }>> {
  const out = new Map<string, { mediaId: string; url: string | null }>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (chunk.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT pm.buffer_post_id AS pid, pm.media_id AS mid, m.r2_key AS r2_key, m.deleted_at AS deleted_at
         FROM post_media pm LEFT JOIN media m ON m.id = pm.media_id WHERE pm.buffer_post_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all<{ pid: string; mid: string; r2_key: string | null; deleted_at: number | null }>();
    for (const r of rows.results) out.set(r.pid, { mediaId: r.mid, url: r.r2_key && !r.deleted_at ? `/media/${r.r2_key}` : null });
  }
  return out;
}

const PostsPage = z.object({
  posts: z.object({
    edges: z.array(z.object({ node: RawPost })),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});

async function fetchPosts(apiKey: string, filter: Record<string, unknown>, limit: number): Promise<RawPostT[]> {
  const org = await organizationId(apiKey);
  const out: RawPostT[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5 && out.length < limit; page++) {
    const d: z.infer<typeof PostsPage> = await bufferQuery(
      apiKey,
      `query($org: OrganizationId!, $filter: PostsFiltersInput, $after: String) {
        posts(first: 100, after: $after, input: { organizationId: $org, filter: $filter, sort: [{ field: dueAt, direction: asc }] }) {
          edges { node { ${POST_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
      PostsPage,
      { org, filter, after },
    );
    out.push(...d.posts.edges.map((e) => e.node));
    if (!d.posts.pageInfo.hasNextPage || !d.posts.pageInfo.endCursor) break;
    after = d.posts.pageInfo.endCursor;
  }
  return out;
}

/** Посты за период (по времени выхода) + черновики без даты. */
export function listPosts(apiKey: string, db: D1Database, from: number, to: number): Promise<{ items: BufferPost[]; drafts: BufferPost[] }> {
  return cached(db, `posts:${from}:${to}`, 90_000, () => loadPosts(apiKey, db, from, to));
}
async function loadPosts(apiKey: string, db: D1Database, from: number, to: number): Promise<{ items: BufferPost[]; drafts: BufferPost[] }> {
  const [ranged, drafts] = await Promise.all([
    fetchPosts(apiKey, { dueAt: { start: new Date(from).toISOString(), end: new Date(to).toISOString() } }, 500),
    fetchPosts(apiKey, { status: ["draft"], dueAtPresence: "missing" }, 100).catch(() => [] as RawPostT[]),
  ]);
  const media = await mediaForPosts(db, [...ranged, ...drafts].map((p) => p.id));
  return { items: ranged.map((p) => toPost(p, media)), drafts: drafts.map((p) => toPost(p, media)) };
}

const ActionResult = z.object({
  __typename: z.string(),
  post: RawPost.optional(),
  message: z.string().optional(),
});

function modeFields(mode: ShareMode, dueAt?: number): Record<string, unknown> {
  switch (mode) {
    case "queue":
      return { mode: "addToQueue" };
    case "next":
      return { mode: "shareNext" };
    case "now":
      return { mode: "shareNow" };
    case "schedule":
      return { mode: "customScheduled", dueAt: new Date(dueAt ?? Date.now()).toISOString() };
    case "draft":
      return { mode: "addToQueue", saveToDraft: true };
  }
}

interface MetaOpts {
  title?: string;
  firstComment?: string;
  geotag?: boolean;
  googleButton?: GoogleButton;
}
const TBILISI_GEO = { text: "Tbilisi, Georgia" };

/** Настройки поста под каждую сеть: ролик как Reels/Shorts + первый комментарий, геометка, кнопка Google. */
function metadataFor(service: string, o: MetaOpts): Record<string, unknown> | undefined {
  const fc = o.firstComment?.trim() ? { firstComment: o.firstComment.trim() } : {};
  switch (service) {
    case "instagram":
      return { instagram: { type: "reel", shouldShareToFeed: true, ...fc, ...(o.geotag ? { geolocation: TBILISI_GEO } : {}) } };
    case "facebook":
      return { facebook: { type: "reel", ...fc } };
    case "youtube":
      return { youtube: { title: o.title || "AirFixer", categoryId: "26", privacy: "public", madeForKids: false, notifySubscribers: true } };
    case "tiktok":
      return o.title ? { tiktok: { title: o.title } } : undefined;
    case "googlebusiness":
      return { google: { type: "whats_new", ...(o.title ? { title: o.title } : {}), ...googleDetails(o.googleButton) } };
    default:
      return undefined;
  }
}
function googleDetails(b: GoogleButton | undefined): Record<string, unknown> {
  if (b === "call") return { detailsWhatsNew: { button: "call" } };
  if (b === "learn_more") return { detailsWhatsNew: { button: "learn_more", link: "https://airfixer.ge" } };
  return {};
}

const RESULT_FRAGMENT = `__typename ... on PostActionSuccess { post { ${POST_FIELDS} } } ... on MutationError { message }`;

/** Создать посты (по одному на соцсеть) с роликом по публичной ссылке. */
export async function createPosts(
  apiKey: string,
  db: D1Database,
  input: ComposeInput,
  videoUrl: string,
  author: "owner" | "claude",
): Promise<ComposeResult> {
  const channels = await listChannels(apiKey, db);
  const results: ComposeResult["results"] = [];
  for (const t of input.targets) {
    const ch = channels.find((c) => c.id === t.channelId);
    if (!ch) {
      results.push({ channelId: t.channelId, ok: false, postId: null, error: "Канал не найден в Buffer" });
      continue;
    }
    const opts: MetaOpts = { title: t.title, firstComment: t.firstComment, geotag: input.geotag, googleButton: input.googleButton };
    const videoMeta = { ...(t.title ? { title: t.title } : {}), ...(input.thumbnailMs !== undefined ? { thumbnailOffset: input.thumbnailMs } : {}) };
    const build = (o: MetaOpts) => {
      const metadata = metadataFor(ch.service, o);
      return {
        input: {
          channelId: ch.id,
          text: t.text,
          schedulingType: "automatic",
          needsApproval: false,
          source: "postfixer",
          assets: [{ video: { url: videoUrl, ...(Object.keys(videoMeta).length ? { metadata: videoMeta } : {}) } }],
          ...(metadata ? { metadata } : {}),
          ...modeFields(input.mode, input.dueAt),
        },
      };
    };
    const send = (variables: Record<string, unknown>) =>
      bufferQuery(apiKey, `mutation($input: CreatePostInput!) { createPost(input: $input) { ${RESULT_FRAGMENT} } }`, z.object({ createPost: ActionResult }), variables);
    try {
      let d = await send(build(opts));
      // Если Buffer не принял геометку — повторяем без неё, чтобы пост не потерялся
      if (!d.createPost.post && opts.geotag && /geo|location/i.test(d.createPost.message ?? "")) d = await send(build({ ...opts, geotag: false }));
      const post = d.createPost.post;
      if (!post) {
        results.push({ channelId: ch.id, ok: false, postId: null, error: d.createPost.message ?? d.createPost.__typename });
        continue;
      }
      await db
        .prepare("INSERT OR REPLACE INTO post_media (buffer_post_id, media_id, channel_id, author, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(post.id, input.mediaId, ch.id, author, Date.now())
        .run();
      results.push({ channelId: ch.id, ok: true, postId: post.id, error: null });
    } catch (e: unknown) {
      results.push({ channelId: ch.id, ok: false, postId: null, error: e instanceof Error ? e.message.slice(0, 300) : "Ошибка Buffer" });
    }
  }
  await invalidatePosts(db);
  return { results };
}

async function oneResult(apiKey: string, db: D1Database, query: string, field: string, variables: Record<string, unknown>): Promise<BufferPost> {
  const d = await bufferQuery(apiKey, query, z.record(z.string(), ActionResult), variables);
  const r = d[field];
  if (!r?.post) throw new BufferError(r?.message ?? "Buffer не выполнил действие");
  await invalidatePosts(db);
  const media = await mediaForPosts(db, [r.post.id]);
  return toPost(r.post, media);
}

const CurrentPost = z.object({
  post: z.object({
    id: z.string(),
    channelService: z.string(),
    text: z.string(),
    assets: z.array(
      z.object({
        source: z.string(),
        type: z.string(),
        video: z.object({ title: z.string().nullable(), thumbnailOffset: z.number().nullable().optional() }).optional(),
      }),
    ),
    metadata: z
      .object({
        __typename: z.string(),
        title: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        privacy: z.string().nullable().optional(),
        madeForKids: z.boolean().nullable().optional(),
        notifySubscribers: z.boolean().nullable().optional(),
        shouldShareToFeed: z.boolean().nullable().optional(),
        firstComment: z.string().nullable().optional(),
        geolocation: z.object({ id: z.string().nullable(), text: z.string().nullable() }).nullable().optional(),
        details: z.object({ button: z.string().nullable().optional(), link: z.string().nullable().optional() }).nullable().optional(),
      })
      .nullable(),
  }),
});

/**
 * Buffer при правке требует пост целиком (ролик + тип), поэтому берём текущий пост
 * и отправляем его обратно с изменениями.
 */
async function fullEditInput(
  apiKey: string,
  id: string,
  change: { text?: string; title?: string; firstComment?: string; mode?: string; dueAt?: number },
): Promise<Record<string, unknown>> {
  const d = await bufferQuery(
    apiKey,
    `query($id: PostId!) { post(input: { id: $id }) { id channelService text
      assets { source type ... on VideoAsset { video { title thumbnailOffset } } }
      metadata { __typename
        ... on YoutubePostMetadata { title privacy madeForKids notifySubscribers }
        ... on TiktokPostMetadata { title }
        ... on InstagramPostMetadata { type shouldShareToFeed firstComment geolocation { id text } }
        ... on FacebookPostMetadata { type firstComment }
        ... on GoogleBusinessPostMetadata { type title details { ... on GoogleBusinessWhatsNewMetaData { button link } } } } } }`,
    CurrentPost,
    { id },
  );
  const p = d.post;
  const m = p.metadata;
  const title = change.title ?? m?.title ?? p.assets.find((a) => a.video?.title)?.video?.title ?? undefined;
  const assets = p.assets.map((a) => {
    if (a.type !== "video") return { image: { url: a.source } };
    const vm = { ...(title ? { title } : {}), ...(typeof a.video?.thumbnailOffset === "number" ? { thumbnailOffset: a.video.thumbnailOffset } : {}) };
    return { video: { url: a.source, ...(Object.keys(vm).length ? { metadata: vm } : {}) } };
  });
  const fcText = change.firstComment !== undefined ? change.firstComment.trim() : (m?.firstComment ?? "");
  const fc = fcText ? { firstComment: fcText } : {};
  let metadata: Record<string, unknown> | undefined;
  switch (p.channelService) {
    case "instagram":
      metadata = {
        instagram: {
          type: m?.type ?? "reel",
          shouldShareToFeed: m?.shouldShareToFeed ?? true,
          ...fc,
          ...(m?.geolocation?.text || m?.geolocation?.id ? { geolocation: { ...(m.geolocation.id ? { id: m.geolocation.id } : {}), ...(m.geolocation.text ? { text: m.geolocation.text } : {}) } } : {}),
        },
      };
      break;
    case "facebook":
      metadata = { facebook: { type: m?.type ?? "reel", ...fc } };
      break;
    case "youtube":
      metadata = {
        youtube: {
          title: title || "AirFixer",
          categoryId: "26",
          privacy: m?.privacy ?? "public",
          madeForKids: m?.madeForKids ?? false,
          notifySubscribers: m?.notifySubscribers ?? true,
        },
      };
      break;
    case "tiktok":
      metadata = title ? { tiktok: { title } } : undefined;
      break;
    case "googlebusiness":
      metadata = {
        google: {
          type: m?.type ?? "whats_new",
          ...(title ? { title } : {}),
          ...(m?.details?.button ? { detailsWhatsNew: { button: m.details.button, ...(m.details.link ? { link: m.details.link } : {}) } } : {}),
        },
      };
      break;
  }
  return {
    id,
    text: change.text ?? p.text,
    assets,
    schedulingType: "automatic",
    ...(metadata ? { metadata } : {}),
    ...(change.mode ? { mode: change.mode } : {}),
    ...(change.dueAt !== undefined ? { dueAt: new Date(change.dueAt).toISOString() } : {}),
  };
}

const EDIT = `mutation($input: EditPostInput!) { editPost(input: $input) { ${RESULT_FRAGMENT} } }`;

/** Перенести пост на другое время. */
export async function movePost(apiKey: string, db: D1Database, id: string, dueAt: number): Promise<BufferPost> {
  return oneResult(apiKey, db, EDIT, "editPost", { input: await fullEditInput(apiKey, id, { mode: "customScheduled", dueAt }) });
}

/** Изменить подпись поста (и название YouTube/TikTok). */
export async function editPostText(
  apiKey: string,
  db: D1Database,
  id: string,
  text: string,
  title?: { service: string; title: string },
  firstComment?: string,
): Promise<BufferPost> {
  return oneResult(apiKey, db, EDIT, "editPost", {
    input: await fullEditInput(apiKey, id, { text, ...(title ? { title: title.title } : {}), ...(firstComment !== undefined ? { firstComment } : {}) }),
  });
}

/** Повторить пост с ошибкой — снова в очередь (ближайший слот). */
export async function retryPost(apiKey: string, db: D1Database, id: string): Promise<BufferPost> {
  return oneResult(apiKey, db, EDIT, "editPost", { input: await fullEditInput(apiKey, id, { mode: "addToQueue" }) });
}

/** Опубликовать сейчас. */
export async function sharePostNow(apiKey: string, db: D1Database, id: string): Promise<BufferPost> {
  return oneResult(apiKey, db, EDIT, "editPost", { input: await fullEditInput(apiKey, id, { mode: "shareNow" }) });
}

/** Удалить пост из Buffer. */
export async function deletePost(apiKey: string, db: D1Database, id: string): Promise<void> {
  const d = await bufferQuery(
    apiKey,
    `mutation($input: DeletePostInput!) { deletePost(input: $input) { __typename ... on DeletePostSuccess { id } ... on MutationError { message } } }`,
    z.object({ deletePost: z.object({ __typename: z.string(), id: z.string().optional(), message: z.string().optional() }) }),
    { input: { id } },
  );
  if (!d.deletePost.id) throw new BufferError(d.deletePost.message ?? "Не удалось удалить");
  await db.prepare("DELETE FROM post_media WHERE buffer_post_id = ?").bind(id).run();
  await invalidatePosts(db);
}

// ---- Статистика (Buffer: экспериментально, нужен личный ключ) ----
const MetricPost = RawPost.extend({
  metrics: z.array(z.object({ type: z.string(), name: z.string(), value: z.number(), unit: z.string() })).nullable(),
  metricsUpdatedAt: z.string().nullable(),
});
const MetricPage = z.object({
  posts: z.object({ edges: z.array(z.object({ node: MetricPost })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
});

/** Опубликованные посты Buffer за период с цифрами (кэш 30 минут). */
export function postStats(apiKey: string, db: D1Database, from: number, to: number): Promise<Stats> {
  return cached(db, `stats:${from}:${to}`, 30 * 60_000, () => loadBufferStats(apiKey, db, from, to));
}
/** То же без кэша (для копии истории). */
export async function loadBufferStats(apiKey: string, db: D1Database, from: number, to: number): Promise<Stats> {
  const org = await organizationId(apiKey);
  const nodes: z.infer<typeof MetricPost>[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const d: z.infer<typeof MetricPage> = await bufferQuery(
      apiKey,
      `query($org: OrganizationId!, $filter: PostsFiltersInput, $after: String) {
        posts(first: 100, after: $after, input: { organizationId: $org, filter: $filter, sort: [{ field: dueAt, direction: desc }] }) {
          edges { node { ${POST_FIELDS} metrics { type name value unit } metricsUpdatedAt } } pageInfo { hasNextPage endCursor } } }`,
      MetricPage,
      { org, after, filter: { status: ["sent"], dueAt: { start: new Date(from).toISOString(), end: new Date(to).toISOString() } } },
    );
    nodes.push(...d.posts.edges.map((e) => e.node));
    if (!d.posts.pageInfo.hasNextPage || !d.posts.pageInfo.endCursor) break;
    after = d.posts.pageInfo.endCursor;
  }
  const media = await mediaForPosts(db, nodes.map((n) => n.id));
  const items: StatPost[] = nodes.map((n) => ({ ...toPost(n, media), metrics: n.metrics ?? [], metricsUpdatedAt: ms(n.metricsUpdatedAt) }));
  return { items, updatedAt: Date.now() };
}

// ---- Вставки: хранятся в PostFixer (D1); старые один раз переносятся из Buffer ----
const SnippetRaw = z.object({ id: z.string(), name: z.string(), text: z.string() });
const IMPORTED_KEY = "snippets_imported";
async function importBufferSnippets(apiKey: string | null, db: D1Database): Promise<void> {
  const done = await db.prepare("SELECT 1 AS x FROM app_settings WHERE key = ?").bind(IMPORTED_KEY).first();
  if (done) return;
  let items: Snippet[] = [];
  if (apiKey) {
    const org = await organizationId(apiKey);
    const d = await bufferQuery(
      apiKey,
      `query($org: OrganizationId!) { snippets(first: 100, input: { organizationId: $org }) { edges { node { id name text } } } }`,
      z.object({ snippets: z.object({ edges: z.array(z.object({ node: SnippetRaw })) }) }),
      { org },
    );
    items = d.snippets.edges.map((e) => e.node);
  }
  const now = Date.now();
  await db.batch([
    ...items.map((i) =>
      db.prepare("INSERT OR IGNORE INTO snippets (id, name, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(`sn_${i.id}`, i.name, i.text, now, now),
    ),
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").bind(IMPORTED_KEY, String(items.length), now),
  ]);
}

export async function listSnippets(apiKey: string | null, db: D1Database): Promise<Snippet[]> {
  await importBufferSnippets(apiKey, db).catch((e: unknown) => console.error("snippets import", e)); // Buffer недоступен — повторим позже
  const r = await db.prepare("SELECT id, name, text FROM snippets ORDER BY name COLLATE NOCASE").all<Snippet>();
  return r.results;
}

export async function createSnippet(db: D1Database, input: SnippetInput): Promise<Snippet> {
  const id = `sn_${crypto.randomUUID()}`;
  const now = Date.now();
  await db.prepare("INSERT INTO snippets (id, name, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, input.name, input.text, now, now).run();
  return { id, name: input.name, text: input.text };
}

export async function updateSnippet(db: D1Database, id: string, input: SnippetInput): Promise<void> {
  const r = await db.prepare("UPDATE snippets SET name = ?, text = ?, updated_at = ? WHERE id = ?").bind(input.name, input.text, Date.now(), id).run();
  if (!r.meta.changes) throw new BufferError("Вставка не найдена");
}

export async function deleteSnippet(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM snippets WHERE id = ?").bind(id).run();
}

// ---- Лимиты тарифа (только чтение) ----
export async function bufferLimits(apiKey: string, db: D1Database): Promise<BufferLimits> {
  const org = await organizationId(apiKey);
  const channels = await listChannels(apiKey, db);
  const d = await bufferQuery(
    apiKey,
    `query($ids: [ChannelId!]!) {
      account { organizations { id limits { scheduledPosts channels } } }
      dailyPostingLimits(input: { channelIds: $ids }) { channelId limit scheduled sent isAtLimit } }`,
    z.object({
      account: z.object({ organizations: z.array(z.object({ id: z.string(), limits: z.object({ scheduledPosts: z.number(), channels: z.number() }) })) }),
      dailyPostingLimits: z.array(z.object({ channelId: z.string(), limit: z.number().nullable(), scheduled: z.number(), sent: z.number(), isAtLimit: z.boolean() })),
    }),
    { ids: channels.map((c) => c.id) },
  );
  const o = d.account.organizations.find((x) => x.id === org) ?? d.account.organizations[0];
  const scheduled = await fetchPosts(apiKey, { status: ["scheduled"] }, 500);
  return {
    scheduledPosts: o?.limits.scheduledPosts ?? 0,
    channels: o?.limits.channels ?? 0,
    scheduledNow: scheduled.length,
    daily: d.dailyPostingLimits,
    // все каналы в Buffer, включая переехавшие напрямую — они всё равно занимают место в тарифе
    connected: channels.map((c) => ({ name: c.displayName || c.name, service: c.service, isLocked: c.isLocked })),
  };
}
