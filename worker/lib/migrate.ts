import init0001 from "../../migrations/0001_init.sql";
import auth0002 from "../../migrations/0002_auth.sql";
import uploads0003 from "../../migrations/0003_uploads.sql";
import notes0004 from "../../migrations/0004_notes.sql";
import settings0005 from "../../migrations/0005_settings.sql";

/** Миграции по порядку. Новую — добавлять в конец, старые не менять. */
const MIGRATIONS: ReadonlyArray<{ id: number; name: string; sql: string }> = [
  { id: 1, name: "0001_init", sql: init0001 },
  { id: 2, name: "0002_auth", sql: auth0002 },
  { id: 3, name: "0003_uploads", sql: uploads0003 },
  { id: 4, name: "0004_notes", sql: notes0004 },
  { id: 5, name: "0005_settings", sql: settings0005 },
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
