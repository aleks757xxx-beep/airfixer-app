import { APP_VERSION } from "../version";

/**
 * Резервная копия данных PostFixer (решение владельца 10.11.2026): все таблицы D1 одним JSON.
 * Без входов и секретов: сессии, коды входа, ключи входа, временные ключи и зашифрованные токены соцсетей
 * в копию не попадают. После восстановления соцсети подключаются заново («Подключения»).
 */
const SKIP = new Set([
  "sessions",
  "auth_settings",
  "trusted_devices",
  "login_attempts",
  "oauth_states",
  "webauthn_challenges",
  "agent_tokens",
  "passkeys",
  "buffer_cache",
  "uploads",
  "d1_migrations",
]);
/** Колонки с секретами — вычищаются. */
const STRIP: Record<string, readonly string[]> = { direct_accounts: ["token_enc"] };

export interface BackupFile {
  app: "postfixer";
  version: string;
  exportedAt: number;
  note: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export async function exportBackup(db: D1Database): Promise<BackupFile> {
  const names = (
    await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>()
  ).results
    .map((r) => r.name)
    .filter((n) => !SKIP.has(n) && /^[a-z0-9_]+$/.test(n));
  const tables: BackupFile["tables"] = {};
  for (const n of names) {
    const rows = (await db.prepare(`SELECT * FROM "${n}"`).all<Record<string, unknown>>()).results;
    const strip = STRIP[n] ?? [];
    tables[n] = strip.length ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !strip.includes(k)))) : rows;
  }
  return {
    app: "postfixer",
    version: APP_VERSION,
    exportedAt: Date.now(),
    note: "Без паролей, кодов входа и токенов соцсетей. Восстановление — docs/ВОССТАНОВЛЕНИЕ.md",
    tables,
  };
}

export const backupFileName = (at: number) => `postfixer-backup-${new Date(at + 4 * 3600_000).toISOString().slice(0, 10)}.json`;
