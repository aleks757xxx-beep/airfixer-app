import { TBILISI_OFFSET_MS } from "../../shared/schemas";

/** Время по Тбилиси (UTC+4, без летнего времени). */
interface TbParts {
  y: number;
  m: number; // 1–12
  d: number;
  hh: number;
  mm: number;
  /** 0 = понедельник … 6 = воскресенье */
  wd: number;
}
export function tbParts(ms: number): TbParts {
  const t = new Date(ms + TBILISI_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), wd: (t.getUTCDay() + 6) % 7 };
}
const p2 = (n: number) => String(n).padStart(2, "0");
/** «2026-11-09» по Тбилиси */
export const dayKey = (ms: number) => {
  const t = tbParts(ms);
  return `${t.y}-${p2(t.m)}-${p2(t.d)}`;
};
export const timeKey = (ms: number) => {
  const t = tbParts(ms);
  return `${p2(t.hh)}:${p2(t.mm)}`;
};
/** Дата «ГГГГ-ММ-ДД» + время «ЧЧ:ММ» по Тбилиси → ms */
export function fromTb(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  return Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2])) - TBILISI_OFFSET_MS;
}
/** Понедельник 00:00 по Тбилиси для недели с моментом ms */
export function weekStart(ms: number): number {
  const t = tbParts(ms);
  return Date.UTC(t.y, t.m - 1, t.d) - TBILISI_OFFSET_MS - t.wd * 86_400_000;
}
export const DAY_MS = 86_400_000;

const dayFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tbilisi", weekday: "short", day: "numeric", month: "short" });
export const formatDay = (ms: number) => dayFmt.format(new Date(ms));
const longFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tbilisi", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
export const formatWhen = (ms: number) => longFmt.format(new Date(ms));
