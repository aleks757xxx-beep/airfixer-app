// Пересобрать web/components/m3/icons.ts из @material-symbols/svg-400 (Rounded).
// Список нужных значков — scripts/icons-list.txt (имя_fill — закрашенный вариант). Запуск: node scripts/icons.mjs
import fs from "node:fs";
const dir = new URL("../node_modules/@material-symbols/svg-400/rounded/", import.meta.url);
const names = fs.readFileSync(new URL("./icons-list.txt", import.meta.url), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const lines = names.map((n) => {
  const file = n.endsWith("_fill") ? `${n.slice(0, -5)}-fill.svg` : `${n}.svg`;
  const d = /<path d="([^"]+)"/.exec(fs.readFileSync(new URL(file, dir), "utf8"))?.[1];
  if (!d) throw new Error(`нет значка ${n}`);
  return `  ${n}: "${d}",`;
});
const out = `/** Значки Material Symbols Rounded (Apache 2.0), только нужные — без внешних шрифтов (строгий CSP). Сгенерировано: node scripts/icons.mjs (список — scripts/icons-list.txt). */
export const ICONS = {
${lines.join("\n")}
} as const;
export type IconName = keyof typeof ICONS;
`;
fs.writeFileSync(new URL("../web/components/m3/icons.ts", import.meta.url), out);
console.log(`icons.ts: ${names.length} значков`);
