import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import { ComposeInputSchema, MovePostInputSchema, PostTextInputSchema, SnippetInputSchema, type ComposeInput, type ComposeResult, type SnippetList, type BufferPostList, type ChannelList } from "../../shared/schemas";
import { audit } from "../middleware/auth";
import { BufferError } from "../services/buffer";
import {
  createPosts,
  createSnippet,
  deletePost,
  deleteSnippet,
  editPostText,
  listChannels,
  listPosts,
  listSnippets,
  movePost,
  bufferLimits,
  retryPost,
  sharePostNow,
  updateSnippet,
} from "../services/publish";
import { migrated, uploadToken } from "./media";
import { allStats, archiveBufferHistory } from "../services/history";
import { bestSlot, bestTimes, isExploreTurn, spreadSlots } from "../services/besttime";
import { listReposts } from "../services/reposts";
import { MetaError } from "../services/meta";
import { TelegramError } from "../services/telegram";
import {
  accountToChannel,
  createDirectPosts,
  deleteDirect,
  disconnectAccount,
  isDirectChannel,
  isDirectPost,
  listAccounts,
  listDirectPosts,
  moveDirect,
  retryDirect,
  shareNowDirect,
  textDirect,
} from "../services/direct";

type Ctx = Context<AppBindings>;
const MAX_RANGE_MS = 62 * 24 * 3600 * 1000;

function apiKey(c: Ctx): string | null {
  return c.env.BUFFER_API_KEY?.trim() || null;
}
const fail = (c: Ctx, e: unknown) => {
  console.error("publish", e);
  const msg = e instanceof BufferError ? `Buffer: ${e.message}` : e instanceof MetaError || e instanceof TelegramError ? e.message : "Ошибка связи с Buffer";
  return c.json({ error: msg }, 502);
};
const needKey: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!apiKey(c)) return c.json({ error: "Нет ключа Buffer (BUFFER_API_KEY)" }, 503);
  await next();
};

/** Соцсеть канала (instagram, tiktok…) — для нормы постов в неделю. */
async function channelServices(c: Ctx): Promise<Map<string, string>> {
  const accounts = await listAccounts(c.env.DB);
  const key = apiKey(c);
  const buffer = key ? await listChannels(key, c.env.DB).catch(() => []) : [];
  return new Map([...accounts.map((a) => [a.id, a.service] as const), ...buffer.map((b) => [b.id, b.service] as const)]);
}
/** Занятое время каналов Buffer: запланированные и вышедшие за последние 8 дней. */
async function bufferBusy(key: string, db: D1Database, now: number): Promise<Array<{ channelId: string; t: number }>> {
  const r = await listPosts(key, db, now - 8 * 86_400_000, now + 50 * 86_400_000).catch(() => ({ items: [], drafts: [] }));
  return r.items
    .filter((p) => p.status === "scheduled" || p.status === "sent" || p.status === "sending")
    .map((p) => ({ channelId: p.channelId, t: (p.sentAt ?? p.dueAt) as number }))
    .filter((p) => typeof p.t === "number");
}

/** «В очередь» в несколько соцсетей: по одной соцсети в день, сначала где больше просмотров (решение владельца 09.11.2026). */
async function composeSpread(
  c: Ctx,
  input: ComposeInput,
  directTargets: ComposeInput["targets"],
  bufferTargets: ComposeInput["targets"],
  videoUrl: string,
  author: "owner" | "claude",
  mediaName: string,
): Promise<ComposeResult> {
  const now = Date.now();
  const key = apiKey(c);
  const directBusy = await c.env.DB.prepare(
    "SELECT account_id, COALESCE(sent_at, due_at) AS t FROM direct_posts WHERE status IN ('scheduled','processing','sent') AND COALESCE(sent_at, due_at) > ?",
  )
    .bind(now - 8 * 86_400_000)
    .all<{ account_id: string; t: number }>();
  const planned = key && bufferTargets.length ? await bufferBusy(key, c.env.DB, now) : [];
  const busyOf = (ch: string) => [...directBusy.results.filter((r) => r.account_id === ch).map((r) => r.t), ...planned.filter((p) => p.channelId === ch).map((p) => p.t)];
  const services = await channelServices(c);
  const slots = await spreadSlots(c.env.DB, input.targets.map((t) => ({ id: t.channelId, service: services.get(t.channelId) ?? "" })), busyOf, now);
  const results: ComposeResult["results"] = [];
  for (const t of directTargets) {
    const at = slots.get(t.channelId);
    results.push(...(await createDirectPosts(c.env.DB, at ? { ...input, mode: "schedule", dueAt: at } : input, [t], author)));
  }
  for (const t of bufferTargets) {
    if (!key) {
      results.push({ channelId: t.channelId, ok: false, postId: null, error: "Нет ключа Buffer" });
      continue;
    }
    const at = slots.get(t.channelId);
    results.push(...(await createPosts(key, c.env.DB, at ? { ...input, mode: "schedule", dueAt: at, targets: [t] } : { ...input, targets: [t] }, videoUrl, author)).results);
  }
  await audit(c.env.DB, `publish queue-spread (${author})`, `${mediaName}: ${results.filter((r) => r.ok).length}/${results.length}`);
  return { results };
}

/** Одни и те же действия — для владельца (после входа) и для Claude (по токену). */
function build(author: "owner" | "claude") {
  return new Hono<AppBindings>()
    // Каналы: подключённые напрямую (Instagram, Facebook…) + каналы Buffer, которые они не заменяют
    .get("/channels", async (c) => {
      try {
        const accounts = await listAccounts(c.env.DB);
        const replaced = new Set(accounts.map((a) => a.replaces).filter((x): x is string => !!x));
        const buffer = apiKey(c) ? await listChannels(apiKey(c) ?? "", c.env.DB, c.req.query("fresh") === "1") : [];
        const body: ChannelList = { items: [...accounts.map(accountToChannel), ...buffer.filter((b) => !replaced.has(b.id))] };
        return c.json(body);
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/posts", async (c) => {
      const from = Number(c.req.query("from"));
      const to = Number(c.req.query("to"));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_RANGE_MS) {
        return c.json({ error: "Неверный период" }, 400);
      }
      try {
        const direct = await listDirectPosts(c.env.DB, from, to);
        const buf = apiKey(c) ? await listPosts(apiKey(c) ?? "", c.env.DB, from, to) : { items: [], drafts: [] };
        const body: BufferPostList = {
          items: [...buf.items, ...direct.items].sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)),
          drafts: [...direct.drafts, ...buf.drafts],
        };
        return c.json(body);
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts", async (c) => {
      const parsed = ComposeInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Проверьте пост" }, 400);
      const m = await c.env.DB.prepare("SELECT r2_key, name FROM media WHERE id = ? AND deleted_at IS NULL")
        .bind(parsed.data.mediaId)
        .first<{ r2_key: string; name: string }>();
      if (!m) return c.json({ error: "Ролик не найден в библиотеке" }, 404);
      const videoUrl = `https://${new URL(c.req.url).host}/media/${m.r2_key}`; // Buffer забирает ролик по https
      try {
        const directTargets = parsed.data.targets.filter((t) => isDirectChannel(t.channelId));
        const bufferTargets = parsed.data.targets.filter((t) => !isDirectChannel(t.channelId));
        if (parsed.data.mode === "queue" && parsed.data.targets.length > 1) {
          return c.json(await composeSpread(c, parsed.data, directTargets, bufferTargets, videoUrl, author, m.name));
        }
        const results = await createDirectPosts(c.env.DB, parsed.data, directTargets, author);
        if (bufferTargets.length) {
          const key = apiKey(c);
          if (!key) results.push(...bufferTargets.map((t) => ({ channelId: t.channelId, ok: false, postId: null, error: "Нет ключа Buffer" })));
          else if (parsed.data.mode === "queue") {
            // «В очередь» для TikTok / Google — тоже в лучший час (свободный от других постов канала); нет данных — очередь Buffer
            const now = Date.now();
            const planned = await bufferBusy(key, c.env.DB, now);
            const services = await channelServices(c);
            for (const t of bufferTargets) {
              const busy = planned.filter((p) => p.channelId === t.channelId).map((p) => p.t);
              const at = await bestSlot(c.env.DB, t.channelId, services.get(t.channelId) ?? "", busy, await isExploreTurn(c.env.DB, t.channelId));
              const one = at ? { ...parsed.data, mode: "schedule" as const, dueAt: at, targets: [t] } : { ...parsed.data, targets: [t] };
              results.push(...(await createPosts(key, c.env.DB, one, videoUrl, author)).results);
            }
          } else results.push(...(await createPosts(key, c.env.DB, { ...parsed.data, targets: bufferTargets }, videoUrl, author)).results);
        }
        const result = { results };
        const ok = result.results.filter((r) => r.ok).length;
        await audit(c.env.DB, `publish ${parsed.data.mode} (${author})`, `${m.name}: ${ok}/${result.results.length}`);
        return c.json(result);
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts/:id/move", async (c) => {
      const parsed = MovePostInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || parsed.data.dueAt < Date.now() - 60_000) return c.json({ error: "Выберите время в будущем" }, 400);
      try {
        const id = c.req.param("id");
        const post = isDirectPost(id) ? await moveDirect(c.env.DB, id, parsed.data.dueAt) : await movePost(apiKey(c) ?? "", c.env.DB, id, parsed.data.dueAt);
        await audit(c.env.DB, `post move (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts/:id/text", async (c) => {
      const parsed = PostTextInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Слишком длинная подпись" }, 400);
      try {
        const id = c.req.param("id");
        const post = isDirectPost(id)
          ? await textDirect(c.env.DB, id, parsed.data.text, parsed.data.title?.title, parsed.data.firstComment)
          : await editPostText(apiKey(c) ?? "", c.env.DB, id, parsed.data.text, parsed.data.title, parsed.data.firstComment);
        await audit(c.env.DB, `post text (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts/:id/retry", async (c) => {
      try {
        const id = c.req.param("id");
        const post = isDirectPost(id) ? await retryDirect(c.env.DB, id) : await retryPost(apiKey(c) ?? "", c.env.DB, id);
        await audit(c.env.DB, `post retry (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    // Повтор роликов с галочкой «можно повторять»
    .get("/reposts", async (c) => {
      try {
        const accounts = await listAccounts(c.env.DB);
        const replaced = new Set(accounts.map((a) => a.replaces).filter((x): x is string => !!x));
        const buffer = apiKey(c) ? await listChannels(apiKey(c) ?? "", c.env.DB).catch(() => []) : [];
        const channels = [...accounts.map((a) => ({ id: a.id, replaces: a.replaces })), ...buffer.filter((b) => !replaced.has(b.id)).map((b) => ({ id: b.id, replaces: null }))];
        return c.json(await listReposts(c.env.DB, channels));
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    // «Лучшее время»: карта день × час по каждому каналу
    .get("/best-times", async (c) => {
      try {
        const accounts = await listAccounts(c.env.DB);
        const replaced = new Set(accounts.map((a) => a.replaces).filter((x): x is string => !!x));
        const buffer = apiKey(c) ? await listChannels(apiKey(c) ?? "", c.env.DB).catch(() => []) : [];
        const channels = [...accounts.map(accountToChannel), ...buffer.filter((b) => !replaced.has(b.id))].map((ch) => ({ id: ch.id, name: ch.displayName || ch.name, service: ch.service }));
        return c.json(await bestTimes(c.env.DB, channels));
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/stats", async (c) => {
      const from = Number(c.req.query("from"));
      const to = Number(c.req.query("to"));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 93 * 24 * 3600 * 1000) return c.json({ error: "Неверный период" }, 400);
      try {
        return c.json(await allStats(c.env, from, to));
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/limits", needKey, async (c) => {
      try {
        return c.json(await bufferLimits(apiKey(c) ?? "", c.env.DB));
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/snippets", async (c) => {
      try {
        const body: SnippetList = { items: await listSnippets(apiKey(c), c.env.DB) };
        return c.json(body);
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/snippets", async (c) => {
      const p = SnippetInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Проверьте вставку" }, 400);
      try {
        return c.json({ snippet: await createSnippet(c.env.DB, p.data) });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .put("/snippets/:id", async (c) => {
      const p = SnippetInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Проверьте вставку" }, 400);
      try {
        await updateSnippet(c.env.DB, c.req.param("id"), p.data);
        return c.json({ ok: true as const });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .delete("/snippets/:id", async (c) => {
      try {
        await deleteSnippet(c.env.DB, c.req.param("id"));
        return c.json({ ok: true as const });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts/:id/share-now", async (c) => {
      try {
        const id = c.req.param("id");
        const post = isDirectPost(id) ? await shareNowDirect(c.env.DB, id) : await sharePostNow(apiKey(c) ?? "", c.env.DB, id);
        await audit(c.env.DB, `post share now (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    // Подключённые напрямую аккаунты (для Claude — посмотреть и отключить по просьбе владельца)
    .get("/accounts", async (c) => c.json({ items: (await listAccounts(c.env.DB)).map((a) => ({ ...accountToChannel(a), replaces: a.replaces })) }))
    .delete("/accounts/:id", async (c) => {
      await disconnectAccount(c.env.DB, c.req.param("id"));
      await audit(c.env.DB, `direct disconnect (${author})`, c.req.param("id"));
      return c.json({ ok: true as const });
    })
    .delete("/posts/:id", async (c) => {
      try {
        const id = c.req.param("id");
        if (isDirectPost(id)) await deleteDirect(c.env.DB, id);
        else await deletePost(apiKey(c) ?? "", c.env.DB, id);
        await audit(c.env.DB, `post delete (${author})`, c.req.param("id"));
        return c.json({ ok: true as const });
      } catch (e: unknown) {
        return fail(c, e);
      }
    });
}

/** Для владельца (после входа). */
export const publish = new Hono<AppBindings>().use("*", migrated).route("/", build("owner"));
/** Для Claude (по токену). */
export const publishAgent = new Hono<AppBindings>()
  .use("*", uploadToken)
  .use("*", migrated)
  // Для Claude: сохранить историю постов Buffer с цифрами (перед отключением каналов в Buffer)
  .post("/archive", needKey, async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days")) || 1100, 1), 1500);
    try {
      const n = await archiveBufferHistory(apiKey(c) ?? "", c.env.DB, days);
      const total = await c.env.DB.prepare("SELECT COUNT(*) AS n, MIN(due_at) AS first FROM buffer_archive").first<{ n: number; first: number | null }>();
      await audit(c.env.DB, "buffer archive (claude)", `${n} постов за ${days} дн., всего в копии ${total?.n ?? 0}`);
      return c.json({ saved: n, total: total?.n ?? 0, first: total?.first ?? null });
    } catch (e: unknown) {
      return fail(c, e);
    }
  })
  .route("/", build("claude"));
