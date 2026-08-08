import {
  formatDate,
  formatDayRange,
  formatMonth,
  formatMonthShort,
  formatWeekdayShort,
} from './format'
import type { RangeId, TrendBucket, TrendPoint } from '../types'

/**
 * Beschriftung des Ausgabenverlaufs.
 *
 * Die Summen und die Zeitfenster kommen aus `v_spending_trend`. Was daraus
 * `Mo`, `KW32`, `Aug` oder `1.–7.` wird, entsteht erst hier: Wochentags- und
 * Monatsnamen sind Anzeigetext und gehören laut PROJEKT.md ausschließlich in
 * die Oberfläche.
 */

export function bucketLabel(bucket: TrendBucket): string {
  switch (bucket.rangeId) {
    case 'week':
      return formatWeekdayShort(bucket.start)
    case 'month':
      return `KW${bucket.isoWeek}`
    case 'year':
      return formatMonthShort(bucket.start)
    case 'custom':
      return formatDayRange(bucket.start, bucket.end)
  }
}

/** Die Balken eines Zeitraums, in der Reihenfolge der Datenbank. */
export function trendPoints(buckets: TrendBucket[], range: RangeId): TrendPoint[] {
  return buckets
    .filter((bucket) => bucket.rangeId === range)
    .sort((a, b) => a.index - b.index)
    .map((bucket) => ({ label: bucketLabel(bucket), amountCents: bucket.amountCents }))
}

/** Reiter- und Zeitraumbeschriftung über dem Diagramm. */
export function rangeLabel(
  buckets: TrendBucket[],
  range: RangeId,
  month: string,
): { tab: string; period: string } {
  const own = buckets.filter((bucket) => bucket.rangeId === range).sort((a, b) => a.index - b.index)
  const first = own[0]
  const last = own[own.length - 1]

  switch (range) {
    case 'week':
      return { tab: 'Woche', period: 'diese Woche' }
    case 'month':
      return { tab: 'Monat', period: formatMonth(month) }
    case 'year':
      return { tab: 'Jahr', period: 'letzte 6 Monate' }
    case 'custom':
      return {
        tab: 'Eigen',
        // `01.08.–14.08.2026` — die Jahreszahl steht nur einmal, am Ende.
        period:
          first && last ? `${formatDate(first.start).slice(0, 6)}–${formatDate(last.end)}` : '',
      }
  }
}
