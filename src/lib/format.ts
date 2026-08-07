import type { Quantity } from '../types'

/**
 * German display formatting. Every euro amount, date and percentage in the UI
 * goes through here, so the domain data can stay numeric.
 */

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const euroWhole = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const decimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 })

/** `2,49 €` */
export function formatEuro(value: number): string {
  return euro.format(value)
}

/** `277 €` — for hero figures and budget copy where cents are noise. */
export function formatEuroWhole(value: number): string {
  return euroWhole.format(value)
}

/** `+25,00 €` / `−3,10 €` */
export function formatEuroSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return sign + euro.format(Math.abs(value))
}

/** `1,12 kg` */
export function formatAmount(value: number, unit: string): string {
  return `${decimal.format(value)} ${unit}`
}

/** `62 %` — takes a fraction, not a percentage. */
export function formatPercent(fraction: number): string {
  return percent.format(fraction)
}

/** `7,96 €/kg`, or the fallback when a product has no pack size. */
export const NO_QUANTITY = 'ohne Mengenangabe'

export function formatBasePrice(pricePerUnit: number | null, unit: string | null): string {
  if (pricePerUnit === null || unit === null) return NO_QUANTITY
  return `${euro.format(pricePerUnit)}/${unit}`
}

/** `14.08.2026` */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parseISO(iso))
}

/** `14. August 2026` */
export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parseISO(iso))
}

/** `August 2026` */
export function formatMonth(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(parseISO(iso))
}

/** `Aug` */
export function formatMonthShort(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(parseISO(iso)).replace('.', '')
}

/** `05.2026` — used for "6 Käufe seit 05.2026". */
export function formatMonthNumeric(iso: string): string {
  const date = parseISO(iso)
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
}

/** `Juli` */
export function formatMonthName(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(parseISO(iso))
}

/** `heute` · `gestern` · `vor 33 Tagen` */
export function formatAge(iso: string, today: string): string {
  const days = daysBetween(iso, today)
  if (days <= 0) return 'heute'
  if (days === 1) return 'gestern'
  return `vor ${days} Tagen`
}

/** `2 × 1,29 €` · `1,12 kg × 1,79 €/kg` · `ohne Mengenangabe` */
export function formatQuantity(quantity: Quantity): string {
  switch (quantity.kind) {
    case 'count':
      return `${quantity.count} × ${euro.format(quantity.unitPrice)}`
    case 'weight':
      return `${formatAmount(quantity.amount, quantity.unit)} × ${euro.format(quantity.pricePerUnit)}/${quantity.unit}`
    case 'unknown':
      return NO_QUANTITY
  }
}

/** `RE` — merchant monogram for list avatars. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/** Parses `YYYY-MM-DD` as a local date, avoiding the UTC shift of `new Date(iso)`. */
export function parseISO(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Shifts an ISO date by whole months, e.g. `2026-08-01` → `2026-07-01`. */
export function shiftMonth(iso: string, delta: number): string {
  const date = parseISO(iso)
  date.setMonth(date.getMonth() + delta)
  return toISO(date)
}

export function dayOfMonth(iso: string): number {
  return parseISO(iso).getDate()
}

export function toISO(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function daysBetween(from: string, to: string): number {
  const ms = parseISO(to).getTime() - parseISO(from).getTime()
  return Math.round(ms / 86_400_000)
}

/** Keeps float arithmetic on money honest. */
export function toCents(value: number): number {
  return Math.round(value * 100) / 100
}
