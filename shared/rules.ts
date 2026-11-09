/**
 * Правила публикации AirFixer (решение владельца 09.11.2026, по исследованиям Buffer, Metricool, правилам Instagram/YouTube).
 * Одни и те же числа использует расписание («В очередь»), предупреждения и статья «Правила публикации» в приложении.
 */
export const RULES = {
  /** Новых роликов в неделю (план владельца). */
  videosPerWeek: "2–3",
  /** Часы выхода по Тбилиси, когда владелец может ответить на комментарии в первые 1–2 часа: [с, до] включительно. */
  hours: { weekday: [18, 22], weekend: [10, 22] } as const,
  /** Норма постов в неделю по соцсети (больше не ставим — расписание сдвигает дальше). */
  perWeek: { instagram: 3, tiktok: 3, youtube: 3, facebook: 3, threads: 3, telegram: 3, googlebusiness: 1 } as Readonly<Record<string, number>>,
  defaultPerWeek: 3,
  /** Один ролик — в следующую соцсеть не раньше чем через столько дней (7 соцсетей ≈ 3 недели). */
  spreadDays: 3,
  /** Посты одной соцсети — не ближе этого (часы), даже разных роликов. */
  sameChannelGapHours: 3,
  /** Соцсеть без постов столько дней — предупреждение в Telegram. */
  idleDays: 7,
  /** Повтор ролика в ту же соцсеть — не раньше. */
  repostGapDays: 90,
} as const;

export const perWeekOf = (service: string) => RULES.perWeek[service] ?? RULES.defaultPerWeek;
/** Минимальная пауза между постами одной соцсети по её норме (мс): 3 в неделю → ~2 дня, 1 в неделю → ~6 дней. */
export const cadenceGapMs = (service: string) => Math.round(((7 * 86_400_000) / perWeekOf(service)) * 0.85);
/** Разрешённые часы дня (день недели по Тбилиси, 0 = вс … 6 = сб). */
export function allowedHours(weekday: number): readonly [number, number] {
  return weekday === 0 || weekday === 6 ? RULES.hours.weekend : RULES.hours.weekday;
}
