export function formatBytes(n: number): string {
  if (n <= 0) return "0 МБ";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tbilisi", day: "numeric", month: "short" });
export const formatDate = (ms: number) => dateFmt.format(new Date(ms));

/** 1 ролик, 2 ролика, 5 роликов */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const shootFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
/** «2026-05-05» → «5 мая 2026 г.» */
export function formatShootDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return shootFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tbilisi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const formatDateTime = (ms: number) => timeFmt.format(new Date(ms));
