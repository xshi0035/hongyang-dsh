/**
 * Calendar helpers shared by the Host and the browser: the finance team's
 * "today" is the Shanghai calendar day regardless of where the process runs.
 * @module @deepseek-ai/dsh-hy-finance/shared/day
 */

/** Calendar the finance team works in. */
export const HY_TIME_ZONE = 'Asia/Shanghai'

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: HY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * Local calendar day of an instant.
 * @param instant - Point in time; defaults to now.
 * @returns `YYYY-MM-DD` in {@link HY_TIME_ZONE}.
 */
export function financeDay(instant: Date = new Date()): string {
  return dayFormat.format(instant)
}

/**
 * Shift a `YYYY-MM-DD` day by whole days.
 * @param day - Calendar day.
 * @param delta - Days to add (negative moves back).
 * @returns The shifted day.
 */
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}
