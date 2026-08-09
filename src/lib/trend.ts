import { formatDate, formatDayRange, formatMonth, formatMonthShort, formatWeekdayShort } from './format'
import type { RangeId, TrendBucket, TrendPoint } from '../types'

/**
 * Beschriftung des Ausgabenverlaufs.
 *
 * Die Summen und die Zeitfenster kommen aus `v_spending_trend`. Was daraus
 * `Mo`, `1.–7.` oder `Aug` wird, entsteht erst hier: Wochentags- und
 * Monatsnamen sind Anzeigetext und gehören laut PROJEKT.md ausschließlich in
 * die Oberfläche.
 */

export function bucketLabel(bucket: TrendBucket): string {
  switch (bucket.rangeId) {
    case 'week':
      return formatWeekdayShort(bucket.start)
    case 'month':
      /*
       * Der Tagesbereich statt der Kalenderwoche.
       *
       * „KW32" war an einer Stelle irreführend: Der erste Balken des Januar
       * beginnt am 1., und der liegt nach ISO-Zählung in der letzten Woche des
       * **Vorjahres** — in Januar 2027 hätte dort „KW53" gestanden, in Januar
       * 2028 „KW52". Beides ist streng genommen richtig und liest sich über
       * einem Januarbalken trotzdem falsch.
       *
       * „1.–7." braucht keinen Jahreskontext, ist auf einen Blick verständlich
       * und beantwortet die Frage, die man vor einem Monatsdiagramm hat:
       * welcher Teil des Monats.
       */
      return formatDayRange(bucket.start, bucket.end)
    case 'year':
      return formatMonthShort(bucket.start)
  }
}

/** Die Balken eines Zeitraums, in der Reihenfolge der Datenbank. */
export function trendPoints(buckets: TrendBucket[], range: RangeId): TrendPoint[] {
  return buckets
    .filter((bucket) => bucket.rangeId === range)
    .sort((a, b) => a.index - b.index)
    .map((bucket) => ({ label: bucketLabel(bucket), amountCents: bucket.amountCents }))
}

/**
 * Reiter- und Zeitraumbeschriftung über dem Diagramm.
 *
 * Der Reiter hieß bis Schritt 19 „Jahr" und zeigte sechs Monate — der Zeitraum
 * daneben sagte das sogar dazu und widersprach damit dem Reiter. Jetzt steht
 * dran, was drin ist.
 */
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
      return {
        tab: '6 Monate',
        // `01.03.–31.08.2026` — die Jahreszahl steht nur einmal, am Ende.
        period:
          first && last ? `${formatDate(first.start).slice(0, 6)}–${formatDate(last.end)}` : '',
      }
  }
}
