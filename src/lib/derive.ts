import type { Category, CategoryId, CategoryTotal, MonthSummary, Receipt } from '../types'

/**
 * Was die Screens zeigen, ohne dass es ein gespeicherter Wert wäre.
 *
 * Seit Schritt 2c ist das deutlich weniger als vorher: Summen, Bestpreise,
 * Sparpotenzial und Top-Produkte rechnet die Datenbank in ihren Sichten
 * (`supabase/migrations/0002_views.sql`). Hier bleibt nur, was reine Darstellung
 * ist — Anteile, Farben, Balkenlängen.
 *
 * Jede Funktion muss mit leeren Eingaben zurechtkommen. Nach dem Umbau ist die
 * Datenbank leer, und ein `0 / 0` wäre in der Anzeige ein `NaN %`.
 */

/* ---------------------------------------------------------------- receipts */

export function receiptItemsTotal(receipt: Receipt): number {
  return receipt.items.reduce((sum, item) => sum + item.totalCents, 0)
}

/** Positive when the paper total is higher than the recognised line items. */
export function receiptDiscrepancy(receipt: Receipt): number {
  return receipt.printedTotalCents - receiptItemsTotal(receipt)
}

/* -------------------------------------------------------------- categories */

/** Green ramp for food categories, ordered from biggest to smallest spender. */
const FOOD_RAMP = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-7)',
  'var(--cat-8)',
]

export interface CategorySlice {
  id: CategoryId
  name: string
  amountCents: number
  color: string
  /** Share of the whole, 0–1. */
  share: number
}

/**
 * Food categories sorted by spend, with Non-Food pinned last in its own neutral
 * tone — the brief calls for it to stay visible no matter how small it is.
 */
export function categorySlices(totals: CategoryTotal[], categories: Category[]): CategorySlice[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  // `|| 1` fängt den leeren Monat ab: ohne ihn wäre jeder Anteil NaN.
  const sum = totals.reduce((acc, t) => acc + t.amountCents, 0) || 1

  const food = totals
    .filter((t) => byId.get(t.categoryId)?.isFood)
    .sort((a, b) => b.amountCents - a.amountCents)
    .map((t, index) => ({
      id: t.categoryId,
      name: byId.get(t.categoryId)?.name ?? t.categoryId,
      amountCents: t.amountCents,
      color: FOOD_RAMP[index % FOOD_RAMP.length],
      share: t.amountCents / sum,
    }))

  const nonFood = totals
    .filter((t) => !byId.get(t.categoryId)?.isFood)
    .map((t) => ({
      id: t.categoryId,
      name: byId.get(t.categoryId)?.name ?? t.categoryId,
      amountCents: t.amountCents,
      color: 'var(--cat-nonfood)',
      share: t.amountCents / sum,
    }))

  return [...food, ...nonFood]
}

/* ------------------------------------------------------------------ budget */

export interface BudgetState {
  spentCents: number
  budgetCents: number
  forecastCents: number
  /** Spend against budget, 0–1 — the figure quoted as "62 % genutzt". */
  usedFraction: number
  /** Bar fill, scaled so the forecast fits: spend / max(budget, forecast). */
  barFraction: number
  /** Where the budget line sits on that bar, 0–1. */
  budgetMarkFraction: number
  overBudgetCents: number
  /** Difference to the same day of the previous month. */
  vsPreviousMonthCents: number
  /** Kein Budget gesetzt — der Screen zeigt dann einen Hinweis statt eines Balkens. */
  hasBudget: boolean
}

/**
 * Anteil mit Netz: Der Nenner kann überall null sein — ein Haushalt ohne
 * gesetztes Budget, ein Monat ohne Einkäufe. Dann kommt 0 heraus statt `NaN`,
 * und die Anzeige schreibt „0 %" statt „NaN %".
 */
export function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

export function budgetState(summary: MonthSummary): BudgetState {
  // Sums and differences of whole cents stay whole cents — nothing to round.
  const spentCents = summary.foodCents + summary.nonFoodCents
  const scale = Math.max(summary.budgetCents, summary.forecastCents)

  return {
    spentCents,
    budgetCents: summary.budgetCents,
    forecastCents: summary.forecastCents,
    usedFraction: share(spentCents, summary.budgetCents),
    barFraction: Math.min(1, share(spentCents, scale)),
    budgetMarkFraction: Math.min(1, share(summary.budgetCents, scale)),
    overBudgetCents: summary.forecastCents - summary.budgetCents,
    vsPreviousMonthCents: spentCents - summary.previousMonthToDateCents,
    hasBudget: summary.budgetCents > 0,
  }
}

/* ------------------------------------------------------------------ charts */

export interface ChartPoint {
  x: number
  y: number
  value: number
}

/**
 * Maps values onto an SVG viewBox. `padding` keeps the topmost dot from being
 * clipped by the stroke.
 *
 * Bei einer leeren Reihe kommt eine leere Liste zurück — `Math.min()` ohne
 * Argumente wäre `Infinity` und jede Koordinate danach `NaN`.
 */
export function linePoints(values: number[], width: number, height: number, padding = 10): ChartPoint[] {
  if (values.length === 0) return []

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index * width) / (values.length - 1),
    y: padding + (height - padding) * (1 - (value - min) / span),
    value,
  }))
}

export function polylinePoints(points: ChartPoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** `conic-gradient(...)` stops for the category donut. */
export function donutGradient(slices: CategorySlice[]): string {
  let cursor = 0
  const stops = slices.map((slice) => {
    const start = cursor * 100
    cursor += slice.share
    return `${slice.color} ${start.toFixed(2)}% ${(cursor * 100).toFixed(2)}%`
  })
  return `conic-gradient(from -90deg, ${stops.join(', ')})`
}
