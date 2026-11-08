// Сборка перед `wrangler deploy` / `wrangler dev` (wrangler.jsonc → build.command).
// В Workers Builds (выкладка из main) сначала проверка типов и тесты: упали — выкладки нет.
import { execSync } from "node:child_process";
import fs from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const inCi = (process.env.WORKERS_CI === "1" || process.env.POSTFIXER_RUN_TESTS === "1") && process.env.POSTFIXER_IN_TEST !== "1";

if (inCi) {
  run("npm run typecheck");
  run("npm run build:web");
  run("npm test");
} else {
  run("npm run build:web");
}
// Отметка сборки: видно, что выкладка прошла через тесты (https://app.airfixer.ge/build.json)
fs.writeFileSync("dist/build.json", JSON.stringify({ builtAt: new Date().toISOString(), tests: inCi ? "passed" : "not run (local build)", commit: process.env.WORKERS_CI_COMMIT_SHA ?? null }));
