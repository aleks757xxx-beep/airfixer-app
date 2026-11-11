import init0001 from "../../migrations/0001_init.sql";
import auth0002 from "../../migrations/0002_auth.sql";
import uploads0003 from "../../migrations/0003_uploads.sql";
import notes0004 from "../../migrations/0004_notes.sql";
import settings0005 from "../../migrations/0005_settings.sql";
import orders0006 from "../../migrations/0006_orders.sql";
import postMedia0007 from "../../migrations/0007_post_media.sql";
import purge0008 from "../../migrations/0008_purge.sql";
import cache0009 from "../../migrations/0009_buffer_cache.sql";
import direct0010 from "../../migrations/0010_direct.sql";
import telegram0011 from "../../migrations/0011_telegram.sql";
import passkeys0012 from "../../migrations/0012_passkeys.sql";
import agentRuns0013 from "../../migrations/0013_agent_runs.sql";
import history0014 from "../../migrations/0014_history.sql";
import dropUnused0015 from "../../migrations/0015_drop_unused.sql";
import notify0016 from "../../migrations/0016_notify.sql";
import bestTime0017 from "../../migrations/0017_best_time.sql";
import repost0018 from "../../migrations/0018_repost.sql";
import sourcesUsed0019 from "../../migrations/0019_sources_used.sql";
import publishedOutside0020 from "../../migrations/0020_published_outside.sql";
import review0021 from "../../migrations/0021_review.sql";

/** Миграции по порядку. Новую — добавлять в конец, старые не менять. */
const MIGRATIONS: ReadonlyArray<{ id: number; name: string; sql: string }> = [
  { id: 1, name: "0001_init", sql: init0001 },
  { id: 2, name: "0002_auth", sql: auth0002 },
  { id: 3, name: "0003_uploads", sql: uploads0003 },
  { id: 4, name: "0004_notes", sql: notes0004 },
  { id: 5, name: "0005_settings", sql: settings0005 },
  { id: 6, name: "0006_orders", sql: orders0006 },
  { id: 7, name: "0007_post_media", sql: postMedia0007 },
  { id: 8, name: "0008_purge", sql: purge0008 },
  { id: 9, name: "0009_buffer_cache", sql: cache0009 },
  { id: 10, name: "0010_direct", sql: direct0010 },
  { id: 11, name: "0011_telegram", sql: telegram0011 },
  { id: 12, name: "0012_passkeys", sql: passkeys0012 },
  { id: 13, name: "0013_agent_runs", sql: agentRuns0013 },
  { id: 14, name: "0014_history", sql: history0014 },
  { id: 15, name: "0015_drop_unused", sql: dropUnused0015 },
  { id: 16, name: "0016_notify", sql: notify0016 },
  { id: 17, name: "0017_best_time", sql: bestTime0017 },
  { id: 18, name: "0018_repost", sql: repost0018 },
  { id: 19, name: "0019_sources_used", sql: sourcesUsed0019 },
  { id: 20, name: "0020_published_outside", sql: publishedOutside0020 },
  { id: 21, name: "0021_review", sql: review0021 },
];

let applied: Promise<number> | null = null;

/** Разбить SQL-файл на отдельные запросы (без комментариев). */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function run(db: D1Database): Promise<number> {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  ).run();
  const done = await db.prepare("SELECT id FROM _migrations").all<{ id: number }>();
  const doneIds = new Set(done.results.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (doneIds.has(m.id)) continue;
    const batch = statements(m.sql).map((s) => db.prepare(s));
    batch.push(db.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").bind(m.id, m.name, Date.now()));
    await db.batch(batch); // одной транзакцией: ошибка → откат
  }
  return MIGRATIONS[MIGRATIONS.length - 1]?.id ?? 0;
}

/** Применить недостающие миграции один раз на экземпляр Worker. */
export function ensureMigrated(db: D1Database): Promise<number> {
  if (!applied) {
    applied = run(db).catch((e: unknown) => {
      applied = null; // повторить при следующем запросе
      throw e;
    });
  }
  return applied;
}
