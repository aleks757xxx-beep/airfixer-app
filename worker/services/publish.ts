import { z } from "zod";
import type { BufferPost, Channel, ComposeInput, ComposeResult, ShareMode } from "../../shared/schemas";
import { BufferError, bufferQuery } from "./buffer";

/** Публикация через Buffer: каналы, посты, создание, перенос, удаление. */

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
  postingSchedule: z.array(z.object({ day: z.string(), times: z.array(z.string()), paused: z.boolean() })),
});

let channelsCache: { at: number; items: Channel[] } | null = null;
export async function listChannels(apiKey: string, fresh = false): Promise<Channel[]> {
  if (!fresh && channelsCache && Date.now() - channelsCache.at < 5 * 60_000) return channelsCache.items;
  const org = await organizationId(apiKey);
  const d = await bufferQuery(
    apiKey,
    `query($org: OrganizationId!) { channels(input: { organizationId: $org }) {
      id name displayName service avatar timezone isQueuePaused isDisconnected postingSchedule { day times paused } } }`,
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
    schedule: c.postingSchedule,
  }));
  channelsCache = { at: Date.now(), items };
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
export async function listPosts(apiKey: string, db: D1Database, from: number, to: number): Promise<{ items: BufferPost[]; drafts: BufferPost[] }> {
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

/** Настройки поста под каждую сеть: ролик как Reels/Shorts. */
function metadataFor(service: string, title: string | undefined): Record<string, unknown> | undefined {
  switch (service) {
    case "instagram":
      return { instagram: { type: "reel", shouldShareToFeed: true } };
    case "facebook":
      return { facebook: { type: "reel" } };
    case "youtube":
      return { youtube: { title: title || "AirFixer", categoryId: "26", privacy: "public", madeForKids: false, notifySubscribers: true } };
    case "tiktok":
      return title ? { tiktok: { title } } : undefined;
    case "googlebusiness":
      return { google: { type: "whats_new", ...(title ? { title } : {}) } };
    default:
      return undefined;
  }
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
  const channels = await listChannels(apiKey);
  const results: ComposeResult["results"] = [];
  for (const t of input.targets) {
    const ch = channels.find((c) => c.id === t.channelId);
    if (!ch) {
      results.push({ channelId: t.channelId, ok: false, postId: null, error: "Канал не найден в Buffer" });
      continue;
    }
    const metadata = metadataFor(ch.service, t.title);
    const variables = {
      input: {
        channelId: ch.id,
        text: t.text,
        schedulingType: "automatic",
        needsApproval: false,
        source: "postfixer",
        assets: [{ video: { url: videoUrl, ...(t.title ? { metadata: { title: t.title } } : {}) } }],
        ...(metadata ? { metadata } : {}),
        ...modeFields(input.mode, input.dueAt),
      },
    };
    try {
      const d = await bufferQuery(
        apiKey,
        `mutation($input: CreatePostInput!) { createPost(input: $input) { ${RESULT_FRAGMENT} } }`,
        z.object({ createPost: ActionResult }),
        variables,
      );
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
  return { results };
}

async function oneResult(apiKey: string, db: D1Database, query: string, field: string, variables: Record<string, unknown>): Promise<BufferPost> {
  const d = await bufferQuery(apiKey, query, z.record(z.string(), ActionResult), variables);
  const r = d[field];
  if (!r?.post) throw new BufferError(r?.message ?? "Buffer не выполнил действие");
  const media = await mediaForPosts(db, [r.post.id]);
  return toPost(r.post, media);
}

const CurrentPost = z.object({
  post: z.object({
    id: z.string(),
    channelService: z.string(),
    text: z.string(),
    assets: z.array(z.object({ source: z.string(), type: z.string(), video: z.object({ title: z.string().nullable() }).optional() })),
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
  change: { text?: string; title?: string; mode?: string; dueAt?: number },
): Promise<Record<string, unknown>> {
  const d = await bufferQuery(
    apiKey,
    `query($id: PostId!) { post(input: { id: $id }) { id channelService text
      assets { source type ... on VideoAsset { video { title } } }
      metadata { __typename
        ... on YoutubePostMetadata { title privacy madeForKids notifySubscribers }
        ... on TiktokPostMetadata { title }
        ... on InstagramPostMetadata { type shouldShareToFeed firstComment }
        ... on FacebookPostMetadata { type firstComment }
        ... on GoogleBusinessPostMetadata { type title } } } }`,
    CurrentPost,
    { id },
  );
  const p = d.post;
  const m = p.metadata;
  const title = change.title ?? m?.title ?? p.assets.find((a) => a.video?.title)?.video?.title ?? undefined;
  const assets = p.assets.map((a) =>
    a.type === "video" ? { video: { url: a.source, ...(title ? { metadata: { title } } : {}) } } : { image: { url: a.source } },
  );
  let metadata: Record<string, unknown> | undefined;
  switch (p.channelService) {
    case "instagram":
      metadata = { instagram: { type: m?.type ?? "reel", shouldShareToFeed: m?.shouldShareToFeed ?? true, ...(m?.firstComment ? { firstComment: m.firstComment } : {}) } };
      break;
    case "facebook":
      metadata = { facebook: { type: m?.type ?? "reel", ...(m?.firstComment ? { firstComment: m.firstComment } : {}) } };
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
      metadata = { google: { type: m?.type ?? "whats_new", ...(title ? { title } : {}) } };
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
): Promise<BufferPost> {
  return oneResult(apiKey, db, EDIT, "editPost", { input: await fullEditInput(apiKey, id, { text, ...(title ? { title: title.title } : {}) }) });
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
}
