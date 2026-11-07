import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import { ComposeInputSchema, MovePostInputSchema, PostTextInputSchema, SnippetInputSchema, type SnippetList, type BufferPostList, type ChannelList } from "../../shared/schemas";
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
  postStats,
  bufferLimits,
  retryPost,
  sharePostNow,
  updateSnippet,
} from "../services/publish";
import { migrated, uploadToken } from "./media";

type Ctx = Context<AppBindings>;
const MAX_RANGE_MS = 62 * 24 * 3600 * 1000;

function apiKey(c: Ctx): string | null {
  return c.env.BUFFER_API_KEY?.trim() || null;
}
const fail = (c: Ctx, e: unknown) => {
  console.error("publish", e);
  return c.json({ error: e instanceof BufferError ? `Buffer: ${e.message}` : "Ошибка связи с Buffer" }, 502);
};
const needKey: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!apiKey(c)) return c.json({ error: "Нет ключа Buffer (BUFFER_API_KEY)" }, 503);
  await next();
};

/** Одни и те же действия — для владельца (после входа) и для Claude (по токену). */
function build(author: "owner" | "claude") {
  return new Hono<AppBindings>()
    .use("*", needKey)
    .get("/channels", async (c) => {
      try {
        const body: ChannelList = { items: await listChannels(apiKey(c) ?? "", c.env.DB, c.req.query("fresh") === "1") };
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
        const body: BufferPostList = await listPosts(apiKey(c) ?? "", c.env.DB, from, to);
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
        const result = await createPosts(apiKey(c) ?? "", c.env.DB, parsed.data, videoUrl, author);
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
        const post = await movePost(apiKey(c) ?? "", c.env.DB, c.req.param("id"), parsed.data.dueAt);
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
        const post = await editPostText(apiKey(c) ?? "", c.env.DB, c.req.param("id"), parsed.data.text, parsed.data.title, parsed.data.firstComment);
        await audit(c.env.DB, `post text (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts/:id/retry", async (c) => {
      try {
        const post = await retryPost(apiKey(c) ?? "", c.env.DB, c.req.param("id"));
        await audit(c.env.DB, `post retry (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/stats", async (c) => {
      const from = Number(c.req.query("from"));
      const to = Number(c.req.query("to"));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 93 * 24 * 3600 * 1000) return c.json({ error: "Неверный период" }, 400);
      try {
        return c.json(await postStats(apiKey(c) ?? "", c.env.DB, from, to));
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/limits", async (c) => {
      try {
        return c.json(await bufferLimits(apiKey(c) ?? "", c.env.DB));
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .get("/snippets", async (c) => {
      try {
        const body: SnippetList = { items: await listSnippets(apiKey(c) ?? "", c.env.DB) };
        return c.json(body);
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/snippets", async (c) => {
      const p = SnippetInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Проверьте вставку" }, 400);
      try {
        return c.json({ snippet: await createSnippet(apiKey(c) ?? "", c.env.DB, p.data) });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .put("/snippets/:id", async (c) => {
      const p = SnippetInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Проверьте вставку" }, 400);
      try {
        await updateSnippet(apiKey(c) ?? "", c.env.DB, c.req.param("id"), p.data);
        return c.json({ ok: true as const });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .delete("/snippets/:id", async (c) => {
      try {
        await deleteSnippet(apiKey(c) ?? "", c.env.DB, c.req.param("id"));
        return c.json({ ok: true as const });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .post("/posts/:id/share-now", async (c) => {
      try {
        const post = await sharePostNow(apiKey(c) ?? "", c.env.DB, c.req.param("id"));
        await audit(c.env.DB, `post share now (${author})`, c.req.param("id"));
        return c.json({ post });
      } catch (e: unknown) {
        return fail(c, e);
      }
    })
    .delete("/posts/:id", async (c) => {
      try {
        await deletePost(apiKey(c) ?? "", c.env.DB, c.req.param("id"));
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
export const publishAgent = new Hono<AppBindings>().use("*", uploadToken).use("*", migrated).route("/", build("claude"));
