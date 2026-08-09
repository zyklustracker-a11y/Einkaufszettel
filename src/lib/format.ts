import type { Quantity } from '../types'

/**
 * German display formatting. Every euro amount, date and percentage in the UI
 * goes through here, so the domain data can stay numeric.
 *
 * Money arrives as whole cents and is turned into euros here and nowhere else —
 * that division is the single boundary between the two units.
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
export function formatEuro(cents: number): string {
  return euro.format(cents / 100)
}

/** `277 €` — for hero figures and budget copy where cents are noise. */
export function formatEuroWhole(cents: number): string {
  return euroWhole.format(cents / 100)
}

/** `+25,00 €` / `−3,10 €` */
export function formatEuroSigned(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : ''
  return sign + euro.format(Math.abs(cents) / 100)
}

/**
 * `45,00 CHF` — ein Betrag in irgendeiner Währung.
 *
 * Gebraucht an genau einer Stelle: im Korrektur-Screen, solange ein Bon noch in
 * seiner eigenen Währung dasteht. **Überall sonst gilt weiterhin `formatEuro`**,
 * denn in der Datenbank stehen Euro — das ist die Zusicherung, auf der alle
 * Auswertungen ruhen (KONZEPT-ERWEITERUNGEN.md, Abschnitt 5).
 *
 * Die Formatierer werden zwischengespeichert: `Intl.NumberFormat` neu zu bauen
 * ist teuer, und diese Funktion läuft in einer Positionsliste je Zeile.
 */
const moneyFormats = new Map<string, Intl.NumberFormat>()

export function formatMoney(cents: number, currency: string): string {
  if (currency === 'EUR') return formatEuro(cents)

  let format = moneyFormats.get(currency)
  if (!format) {
    try {
      format = new Intl.NumberFormat('de-DE', { style: 'currency', currency })
    } catch {
      // Ein Code, den `Intl` nicht kennt, darf die Anzeige nicht sprengen:
      // dann eben die Zahl und der Code dahinter.
      format = decimal
    }
    moneyFormats.set(currency, format)
  }

  const value = format.format(cents / 100)
  return format === decimal ? `${value} ${currency}` : value
}

/** `1,12 kg` */
export function formatAmount(value: number, unit: string): string {
  return `${decimal.format(value)} ${unit}`
}

/** `38,45 l` — aus ganzen Millilitern, so wie die Datenbank sie hält. */
export function formatLitres(millilitres: number): string {
  return `${decimal.format(millilitres / 1000)} l`
}

/**
 * `1,779 €/l` — der Literpreis, mit drei Nachkommastellen.
 *
 * Drei, weil Sprit so ausgezeichnet ist: An der Säule steht 1,779 und nicht
 * 1,78, und ein auf zwei Stellen gekürzter Preisverlauf zeigte lauter gleiche
 * Werte. Die Eingabe ist ein Verhältnis (Cent je Liter) und kein Geldbetrag —
 * deshalb darf sie Nachkommastellen haben.
 */
const perLitre = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

export function formatPricePerLitre(centsPerLitre: number): string {
  return `${perLitre.format(centsPerLitre / 100)} €/l`
}

/**
 * `2,19 €` oder `2,19 €/kg` — ein Preis, der bei Ware nach Gewicht ein
 * Grundpreis ist.
 *
 * Gebraucht überall dort, wo zwei Preise verglichen werden: Ohne die Einheit
 * liest sich „1,79 € statt 2,19 €" bei Bananen wie ein Packungspreis, obwohl
 * es Kilopreise sind.
 */
export function formatUnitPrice(cents: number, unit: string | null): string {
  return unit === null ? formatEuro(cents) : `${formatEuro(cents)}/${unit}`
}

/** `62 %` — takes a fraction, not a percentage. */
export function formatPercent(fraction: number): string {
  return percent.format(fraction)
}

/** `7,96 €/kg`, or the fallback when a product has no pack size. */
export const NO_QUANTITY = 'ohne Mengenangabe'

export function formatBasePrice(pricePerUnitCents: number | null, unit: string | null): string {
  if (pricePerUnitCents === null || unit === null) return NO_QUANTITY
  return `${formatEuro(pricePerUnitCents)}/${unit}`
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

/** `Mo` — Wochentag, für die Balken des Wochenverlaufs. */
export function formatWeekdayShort(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(parseISO(iso)).replace('.', '')
}

/** `1.–7.` — Tagesbereich eines Balkens, wie im Design nur mit Tageszahlen. */
export function formatDayRange(fromIso: string, toIso: string): string {
  return `${dayOfMonth(fromIso)}.–${dayOfMonth(toIso)}.`
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
      return `${quantity.count} × ${formatEuro(quantity.unitPriceCents)}`
    case 'weight':
      return `${formatAmount(quantity.amount, quantity.unit)} × ${formatEuro(quantity.pricePerUnitCents)}/${quantity.unit}`
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

/** Der heutige Tag als ISO-Datum, aus der lokalen Zeit des Geräts. */
export function todayISO(): string {
  return toISO(new Date())
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

/**
 * Commercial rounding to whole cents — needed wherever a multiplication turns
 * numbers back into an amount (weight × €/kg, shares, projections). Rounds half
 * away from zero, so −0,5 ct becomes −1 ct and not 0; `Math.round` alone would
 * round it towards +∞.
 */
export function roundCents(value: number): number {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value)
  // `-0` would format as "-0,00 €".
  return rounded === 0 ? 0 : rounded
}
