import { Hono } from "hono";
import type { AppBindings } from "../env";
import {
  DEFAULT_VOICE,
  ReviewAnswerInputSchema,
  ReviewNoteInputSchema,
  SendReviewInputSchema,
  VoiceInputSchema,
  VoiceSettingsSchema,
  voiceFfmpeg,
  voiceSummary,
  type ReviewKind,
  type ReviewNote,
  type ReviewNoteStatus,
  type ReviewRound,
  type ReviewState,
  type VoiceSettings,
} from "../../shared/review";
import { audit } from "../middleware/auth";
import { MEDIA_COLS, migrated, toItem, uploadToken, type MediaRow } from "./media";

/**
 * «Работа с видео» (решение владельца 11.11.2026): заметки к ролику (точка или отрезок, тип),
 * раунды правок с ответами Claude, звук — «мои настройки по умолчанию» и свои для ролика.
 */

interface NoteRow {
  id: string;
  media_id: string;
  round_id: number | null;
  kind: ReviewKind;
  t_from: number | null;
  t_to: number | null;
  text: string;
  status: ReviewNoteStatus;
  reply: string | null;
  created_at: number;
}
interface RoundRow {
  id: number;
  media_id: string;
  sent_at: number;
  voice: string | null;
  reply: string | null;
  replied_at: number | null;
}

const toNote = (r: NoteRow): ReviewNote => ({
  id: r.id,
  kind: r.kind,
  tFrom: r.t_from,
  tTo: r.t_to,
  text: r.text,
  status: r.status,
  reply: r.reply,
  roundId: r.round_id,
  createdAt: r.created_at,
});
const parseVoice = (raw: string | null | undefined): VoiceSettings | null => {
  if (!raw) return null;
  try {
    const p = VoiceSettingsSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
};
const sameVoice = (a: VoiceSettings | null, b: VoiceSettings | null) => JSON.stringify(a) === JSON.stringify(b);

async function voiceDefault(db: D1Database): Promise<VoiceSettings> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'voice_default'").first<{ value: string | null }>();
  return parseVoice(row?.value) ?? DEFAULT_VOICE;
}
async function mediaRow(db: D1Database, id: string) {
  return db.prepare(`SELECT ${MEDIA_COLS}, voice FROM media WHERE id = ? AND deleted_at IS NULL`).bind(id).first<MediaRow & { voice: string | null }>();
}
async function rounds(db: D1Database, where: string, binds: unknown[]): Promise<Array<ReviewRound & { mediaId: string }>> {
  const rs = (await db.prepare(`SELECT * FROM review_rounds WHERE ${where} ORDER BY id DESC LIMIT 100`).bind(...binds).all<RoundRow>()).results;
  if (!rs.length) return [];
  const ids = rs.map((r) => r.id);
  const notes = (await db.prepare(`SELECT * FROM review_notes WHERE round_id IN (${ids.map(() => "?").join(",")}) ORDER BY t_from IS NULL, t_from, created_at`).bind(...ids).all<NoteRow>()).results;
  return rs.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    sentAt: r.sent_at,
    voice: parseVoice(r.voice),
    reply: r.reply,
    repliedAt: r.replied_at,
    notes: notes.filter((n) => n.round_id === r.id).map(toNote),
  }));
}

async function state(db: D1Database, mediaId: string, voiceRaw: string | null): Promise<ReviewState> {
  const drafts = (await db.prepare("SELECT * FROM review_notes WHERE media_id = ? AND status = 'draft' ORDER BY t_from IS NULL, t_from, created_at").bind(mediaId).all<NoteRow>()).results.map(toNote);
  const rs = await rounds(db, "media_id = ?", [mediaId]);
  const voice = parseVoice(voiceRaw);
  const def = await voiceDefault(db);
  const effective = voice ?? def;
  const last = rs[0]?.voice ?? null;
  // звук «изменился» — если владелец задал свой звук ролику и он отличается от отправленного в прошлый раз
  const voiceChanged = voice !== null && !sameVoice(last, effective);
  return { mediaId, drafts, rounds: rs.map(({ mediaId: _m, ...r }) => r), voice, voiceDefault: def, canSend: drafts.length > 0 || voiceChanged };
}

/** Для владельца (после входа). */
export const review = new Hono<AppBindings>()
  .use("*", migrated)
  .put("/voice-default", async (c) => {
    const p = VoiceInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success || !p.data.voice) return c.json({ error: "Неверные настройки звука" }, 400);
    await c.env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('voice_default', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(JSON.stringify(p.data.voice), Date.now())
      .run();
    return c.json({ voice: p.data.voice });
  })
  .get("/:mediaId", async (c) => {
    const m = await mediaRow(c.env.DB, c.req.param("mediaId"));
    if (!m) return c.json({ error: "Ролик не найден" }, 404);
    return c.json(await state(c.env.DB, m.id, m.voice));
  })
  .post("/:mediaId/notes", async (c) => {
    const p = ReviewNoteInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Проверьте заметку" }, 400);
    const m = await mediaRow(c.env.DB, c.req.param("mediaId"));
    if (!m) return c.json({ error: "Ролик не найден" }, 404);
    const now = Date.now();
    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO review_notes (id, media_id, kind, t_from, t_to, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
      .bind(id, m.id, p.data.kind, p.data.tFrom, p.data.tTo, p.data.text, now, now)
      .run();
    const row = await c.env.DB.prepare("SELECT * FROM review_notes WHERE id = ?").bind(id).first<NoteRow>();
    return row ? c.json({ note: toNote(row) }) : c.json({ error: "Не сохранилось" }, 500);
  })
  .put("/:mediaId/notes/:id", async (c) => {
    const p = ReviewNoteInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Проверьте заметку" }, 400);
    const res = await c.env.DB.prepare("UPDATE review_notes SET kind = ?, t_from = ?, t_to = ?, text = ?, updated_at = ? WHERE id = ? AND media_id = ? AND status = 'draft'")
      .bind(p.data.kind, p.data.tFrom, p.data.tTo, p.data.text, Date.now(), c.req.param("id"), c.req.param("mediaId"))
      .run();
    if (!res.meta.changes) return c.json({ error: "Заметка уже отправлена или удалена" }, 409);
    const row = await c.env.DB.prepare("SELECT * FROM review_notes WHERE id = ?").bind(c.req.param("id")).first<NoteRow>();
    return row ? c.json({ note: toNote(row) }) : c.json({ error: "Не найдено" }, 404);
  })
  .delete("/:mediaId/notes/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM review_notes WHERE id = ? AND media_id = ? AND status = 'draft'").bind(c.req.param("id"), c.req.param("mediaId")).run();
    if (!res.meta.changes) return c.json({ error: "Заметка уже отправлена или удалена" }, 409);
    return c.json({ ok: true });
  })
  .put("/:mediaId/voice", async (c) => {
    const p = VoiceInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверные настройки звука" }, 400);
    const res = await c.env.DB.prepare("UPDATE media SET voice = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(p.data.voice ? JSON.stringify(p.data.voice) : null, c.req.param("mediaId"))
      .run();
    if (!res.meta.changes) return c.json({ error: "Ролик не найден" }, 404);
    const m = await mediaRow(c.env.DB, c.req.param("mediaId"));
    return m ? c.json(await state(c.env.DB, m.id, m.voice)) : c.json({ error: "Ролик не найден" }, 404);
  })
  // Отправить Claude: все черновики + текущий звук ролика — одним раундом
  .post("/:mediaId/send", async (c) => {
    const p = SendReviewInputSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: "Неверный запрос" }, 400);
    const m = await mediaRow(c.env.DB, c.req.param("mediaId"));
    if (!m) return c.json({ error: "Ролик не найден" }, 404);
    const st = await state(c.env.DB, m.id, m.voice);
    if (!st.canSend) return c.json({ error: "Нечего отправлять: добавьте заметку или измените звук" }, 400);
    const now = Date.now();
    const voice = st.voice ?? st.voiceDefault;
    const r = await c.env.DB.prepare("INSERT INTO review_rounds (media_id, sent_at, voice) VALUES (?, ?, ?)").bind(m.id, now, JSON.stringify(voice)).run();
    const roundId = Number(r.meta.last_row_id);
    await c.env.DB.prepare("UPDATE review_notes SET status = 'sent', round_id = ?, updated_at = ? WHERE media_id = ? AND status = 'draft'").bind(roundId, now, m.id).run();
    // черновик заказа монтажа → заказ переходит в «Правки — ждёт Claude»
    if (p.data.orderId) {
      const o = await c.env.DB.prepare("SELECT status FROM edit_orders WHERE id = ?").bind(p.data.orderId).first<{ status: string }>();
      if (o?.status === "draft") {
        const text = `Правки в «Работе с видео»: ${st.drafts.length} заметок${st.voice ? ", звук" : ""} (раунд #${roundId})`;
        await c.env.DB.batch([
          c.env.DB.prepare("UPDATE edit_orders SET status = 'revise', updated_at = ? WHERE id = ?").bind(now, p.data.orderId),
          c.env.DB.prepare("INSERT INTO edit_events (order_id, kind, author, text, media_id, created_at) VALUES (?, 'revise', 'owner', ?, NULL, ?)").bind(p.data.orderId, text, now),
        ]);
      }
    }
    await audit(c.env.DB, "review sent", `${m.name} #${roundId}`);
    const fresh = await mediaRow(c.env.DB, m.id);
    return c.json(await state(c.env.DB, m.id, fresh?.voice ?? null));
  });

/** Для Claude (по токену): открытые раунды правок и ответы на них. */
export const reviewAgent = new Hono<AppBindings>()
  .use("*", uploadToken)
  .use("*", migrated)
  .get("/", async (c) => {
    const all = c.req.query("all") === "1";
    const rs = await rounds(c.env.DB, all ? "1 = 1" : "replied_at IS NULL", []);
    const items = [];
    for (const r of rs) {
      const m = await mediaRow(c.env.DB, r.mediaId);
      if (!m) continue;
      const voice = r.voice ?? (await voiceDefault(c.env.DB));
      const { mediaId: _m, ...round } = r;
      items.push({ media: toItem(m), round, voice, voiceFfmpeg: voiceFfmpeg(voice), voiceText: voiceSummary(voice) });
    }
    return c.json({ items });
  })
  .post("/:roundId", async (c) => {
    const p = ReviewAnswerInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Неверный ответ" }, 400);
    const roundId = Number(c.req.param("roundId"));
    const r = await c.env.DB.prepare("SELECT * FROM review_rounds WHERE id = ?").bind(roundId).first<RoundRow>();
    if (!r) return c.json({ error: "Раунд не найден" }, 404);
    const now = Date.now();
    const stmts = p.data.notes.map((n) =>
      c.env.DB.prepare("UPDATE review_notes SET status = ?, reply = ?, updated_at = ? WHERE id = ? AND round_id = ?").bind(n.status, n.reply || null, now, n.id, roundId),
    );
    stmts.push(c.env.DB.prepare("UPDATE review_rounds SET reply = COALESCE(?, reply), replied_at = ? WHERE id = ?").bind(p.data.reply || null, now, roundId));
    await c.env.DB.batch(stmts);
    await audit(c.env.DB, "review answered", `#${roundId}`);
    const [round] = await rounds(c.env.DB, "id = ?", [roundId]);
    return c.json({ round });
  });
