import { FALLBACK_CATEGORY_COLOR } from './category.ts'
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

export interface CategorySlice {
  id: CategoryId
  name: string
  amountCents: number
  color: string
  /** Share of the whole, 0–1. */
  share: number
}

/**
 * Die Segmente des Kategorien-Rings.
 *
 * **Die Farbe kommt seit Schritt 5 von der Kategorie**, nicht mehr aus einer
 * Ramp im Code. Vorher wurde sie nach Ausgabenhöhe vergeben: Milchprodukte
 * waren im einen Monat dunkelgrün und im nächsten hellgrün, nur weil einmal
 * mehr Obst gekauft wurde. Das war schon vorher unglücklich; mit frei
 * anlegbaren Kategorien ginge es gar nicht mehr, weil eine selbst angelegte
 * keinen Platz in der Ramp hätte (KONZEPT-ERWEITERUNGEN.md, Abschnitt 2).
 *
 * Geblieben ist die Reihenfolge: Lebensmittel nach Ausgaben absteigend,
 * Non-Food ans Ende — es soll sichtbar bleiben, egal wie klein es ist.
 */
export function categorySlices(totals: CategoryTotal[], categories: Category[]): CategorySlice[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  // `|| 1` fängt den leeren Monat ab: ohne ihn wäre jeder Anteil NaN.
  const sum = totals.reduce((acc, t) => acc + t.amountCents, 0) || 1

  const toSlice = (total: CategoryTotal): CategorySlice => {
    const category = byId.get(total.categoryId)
    return {
      id: total.categoryId,
      name: category?.name ?? total.categoryId,
      amountCents: total.amountCents,
      // Ohne Kategorie im Zwischenlager gibt es auch keine Farbe. Kann nur
      // auftreten, wenn eine Kategorie zwischen zwei Abfragen verschwindet.
      color: category?.color ?? FALLBACK_CATEGORY_COLOR,
      share: total.amountCents / sum,
    }
  }

  const food = totals
    .filter((t) => byId.get(t.categoryId)?.isFood)
    .sort((a, b) => b.amountCents - a.amountCents)
    .map(toSlice)

  const nonFood = totals.filter((t) => !byId.get(t.categoryId)?.isFood).map(toSlice)

  return [...food, ...nonFood]
}

/* ------------------------------------------------------------------ budget */

export interface BudgetState {
  /** Alles zusammen: Lebensmittel, Auswärts (samt Trinkgeld) und Non-Food. */
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
  //
  // Seit Schritt 5 sind es drei Summanden. Die Sicht liefert sie überschneidungs-
  // frei: Eine Restaurantposition zählt in `diningCents` und ausdrücklich NICHT
  // noch einmal in `foodCents`, sonst stünde hier zu viel.
  const spentCents = summary.foodCents + summary.diningCents + summary.nonFoodCents
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
 * **`null` ist eine Lücke, kein Wert.** Seit Schritt 19 kann eine Reihe Monate
 * enthalten, in denen nichts eingekauft wurde. Sie behalten ihren Platz auf der
 * Achse — die Zeit läuft ja weiter —, bekommen aber keinen Punkt. Eine 0 an
 * ihrer Stelle wäre eine Behauptung („der Score war null"), und sie einfach
 * wegzulassen staucht die Achse: Dann läge zwischen Mai und Juli derselbe
 * Abstand wie zwischen Juli und August.
 *
 * Bei einer leeren Reihe kommt eine leere Liste zurück — `Math.min()` ohne
 * Argumente wäre `Infinity` und jede Koordinate danach `NaN`.
 */
export function linePoints(
  values: (number | null)[],
  width: number,
  height: number,
  padding = 10,
): (ChartPoint | null)[] {
  const known = values.filter((value): value is number => value !== null)
  if (known.length === 0) return []

  const min = Math.min(...known)
  const max = Math.max(...known)
  const span = max - min || 1
  return values.map((value, index) => {
    if (value === null) return null
    return {
      x: values.length === 1 ? width / 2 : (index * width) / (values.length - 1),
      y: padding + (height - padding) * (1 - (value - min) / span),
      value,
    }
  })
}

/**
 * Die Linie, in zusammenhängende Stücke zerlegt.
 *
 * Eine Lücke trennt zwei Stücke: Über einen Monat ohne Einkäufe wird **nicht**
 * durchgezeichnet, weil die Linie sonst einen Verlauf behauptet, den es nicht
 * gibt. Ohne Lücke kommt genau ein Stück zurück, und alles bleibt wie vorher.
 */
export function polylineSegments(points: (ChartPoint | null)[]): string[] {
  const segments: string[] = []
  let run: ChartPoint[] = []

  for (const point of points) {
    if (point === null) {
      if (run.length > 1) segments.push(polylinePoints(run))
      run = []
      continue
    }
    run.push(point)
  }
  if (run.length > 1) segments.push(polylinePoints(run))

  return segments
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
