import type { Env } from "../env";
import { randomToken, sha256Hex } from "../lib/crypto";

/**
 * Claude берётся за задания сам: при новом задании/заказе/правке PostFixer «будит» задачу Claude
 * (claude.ai/code/routines, API trigger). Сигналы копятся в agent_wakeups и раз в минуту (cron) уходят одним запуском.
 * Пауза между запусками — 3 мин (лимит Anthropic: 30 запусков в час на задачу).
 */
const MIN_GAP_MS = 3 * 60_000;
const AGENT_TOKEN_TTL_MS = 12 * 3600_000;

export const routineConfigured = (env: Env) => !!(env.CLAUDE_ROUTINE_URL?.trim() && env.CLAUDE_ROUTINE_TOKEN?.trim());

/** Отметить, что для Claude есть новое. Ошибки не мешают основному действию. */
export async function wakeClaude(db: D1Database, reason: string): Promise<void> {
  try {
    await db.prepare("INSERT INTO agent_wakeups (reason, created_at) VALUES (?, ?)").bind(reason.slice(0, 300), Date.now()).run();
  } catch (e: unknown) {
    console.error("wakeClaude", e);
  }
}

/** Временный ключ доступа Claude (вместо UPLOAD_TOKEN). */
export async function isAgentToken(db: D1Database, token: string): Promise<boolean> {
  if (!token.startsWith("pfa_")) return false;
  const row = await db.prepare("SELECT expires_at FROM agent_tokens WHERE id = ?").bind(await sha256Hex(token)).first<{ expires_at: number }>();
  return !!row && row.expires_at > Date.now();
}

export async function lastFire(db: D1Database): Promise<number | null> {
  const r = await db.prepare("SELECT MAX(fired_at) AS t FROM agent_wakeups").first<{ t: number | null }>();
  return r?.t ?? null;
}

/** Cron раз в минуту: есть сигналы и прошло 3 мин с прошлого запуска → запустить задачу Claude. */
export async function fireRoutine(env: Env): Promise<boolean> {
  if (!routineConfigured(env)) return false;
  const db = env.DB;
  const pending = await db.prepare("SELECT id, reason FROM agent_wakeups WHERE fired_at IS NULL ORDER BY id LIMIT 50").all<{ id: number; reason: string }>();
  if (pending.results.length === 0) return false;
  const last = await lastFire(db);
  if (last && Date.now() - last < MIN_GAP_MS) return false;

  const token = `pfa_${randomToken(24)}`;
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM agent_tokens WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO agent_tokens (id, created_at, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), now, now + AGENT_TOKEN_TTL_MS),
  ]);
  const reasons = [...new Set(pending.results.map((r) => r.reason))].join("\n- ");
  const text = `PostFixer: появилось новое для Claude:\n- ${reasons}\n\nВременный ключ доступа к API PostFixer (действует 12 ч, вместо UPLOAD_TOKEN): ${token}`;
  const res = await fetch(env.CLAUDE_ROUTINE_URL?.trim() ?? "", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLAUDE_ROUTINE_TOKEN?.trim() ?? ""}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    console.error("routine fire", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return false; // сигналы остаются — попробуем через минуту
  }
  const ids = pending.results.map((r) => r.id);
  await db.prepare(`UPDATE agent_wakeups SET fired_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`).bind(Date.now(), ...ids).run();
  await db.prepare("DELETE FROM agent_wakeups WHERE fired_at IS NOT NULL AND fired_at < ?").bind(Date.now() - 30 * 86_400_000).run();
  return true;
}
