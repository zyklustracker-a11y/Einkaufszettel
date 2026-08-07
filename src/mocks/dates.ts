import { parseISO, toISO } from '../lib/format'

/**
 * The anchor every mock date hangs off.
 *
 * The design draft carried fixed dates, which quietly aged into *future*
 * purchases as time passed. Everything below is an offset from the day the app
 * is opened instead, so the sample data always looks freshly recorded.
 *
 * Captured once at module load: a session left open past midnight keeps the day
 * it started on, which is good enough for mock data and keeps every derived
 * figure stable while the app is running.
 */
const anchor = new Date()

/** Today, ISO. */
export const today = toISO(anchor)

/** ISO date `n` days back. `daysAgo(0)` is today. */
export function daysAgo(n: number): string {
  const date = new Date(anchor)
  date.setDate(date.getDate() - n)
  return toISO(date)
}

/** First day of the month `n` months back. `monthsAgo(0)` is the current month. */
export function monthsAgo(n: number): string {
  return toISO(new Date(anchor.getFullYear(), anchor.getMonth() - n, 1))
}

/** Day `n` of the current month, ISO — used to label the weekly buckets. */
export function monthDay(n: number): string {
  return toISO(new Date(anchor.getFullYear(), anchor.getMonth(), n))
}

/**
 * ISO-8601 calendar week, for the `KW32` bar labels. The Thursday of a week
 * decides which year and week it belongs to, which is what makes the turn of
 * the year come out right.
 */
export function isoWeek(iso: string): number {
  const date = parseISO(iso)
  const thursday = new Date(date)
  thursday.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 3)

  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3)

  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
}
