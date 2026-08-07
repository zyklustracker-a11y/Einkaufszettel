import type {
  Category,
  CategoryId,
  CategoryTotal,
  MerchantId,
  MonthSummary,
  PricePoint,
  Product,
  Receipt,
  TopProduct,
} from '../types'
import { roundCents } from './format'

/**
 * Everything the screens show that is not a stored fact.
 *
 * Keeping these as pure functions over the domain types means the UI never has
 * to know whether a number came from a mock file or a database.
 */

/* ---------------------------------------------------------------- receipts */

export function receiptItemsTotal(receipt: Receipt): number {
  return receipt.items.reduce((sum, item) => sum + item.totalCents, 0)
}

/** Positive when the paper total is higher than the recognised line items. */
export function receiptDiscrepancy(receipt: Receipt): number {
  return receipt.printedTotalCents - receiptItemsTotal(receipt)
}

export interface ItemSearchResult {
  purchaseCount: number
  amountCents: number
}

/** Sums every line item whose name contains `term`, across all receipts. */
export function searchReceiptItems(receipts: Receipt[], term: string): ItemSearchResult {
  const needle = term.trim().toLowerCase()
  if (!needle) return { purchaseCount: 0, amountCents: 0 }

  const matches = receipts.flatMap((receipt) =>
    receipt.items.filter((item) => item.name.toLowerCase().includes(needle)),
  )

  return {
    purchaseCount: matches.length,
    amountCents: matches.reduce((sum, item) => sum + item.totalCents, 0),
  }
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
}

export function budgetState(summary: MonthSummary): BudgetState {
  // Sums and differences of whole cents stay whole cents — nothing to round.
  const spentCents = summary.foodCents + summary.nonFoodCents
  const scale = Math.max(summary.budgetCents, summary.forecastCents)
  return {
    spentCents,
    budgetCents: summary.budgetCents,
    forecastCents: summary.forecastCents,
    usedFraction: spentCents / summary.budgetCents,
    barFraction: Math.min(1, spentCents / scale),
    budgetMarkFraction: Math.min(1, summary.budgetCents / scale),
    overBudgetCents: summary.forecastCents - summary.budgetCents,
    vsPreviousMonthCents: spentCents - summary.previousMonthToDateCents,
  }
}

/* ---------------------------------------------------------------- products */

export interface PriceComparison {
  /** Lowest price ever seen; ties resolve to the most recent sighting. */
  best: PricePoint
  /** Latest price at every other merchant, cheapest first. */
  others: PricePoint[]
  /** €/kg or €/l in cents, or null when the product has no pack size. */
  basePriceCents: number | null
  baseUnit: string | null
  latest: PricePoint
  averageCents: number
  minCents: number
  maxCents: number
}

export function comparePrices(product: Product): PriceComparison {
  const sorted = [...product.purchases].sort((a, b) => a.date.localeCompare(b.date))
  const prices = sorted.map((p) => p.priceCents)

  const best = sorted.reduce((cheapest, point) =>
    // Later sightings win ties, so the age badge reflects the current best price.
    point.priceCents <= cheapest.priceCents ? point : cheapest,
  )

  const latestPerMerchant = new Map<MerchantId, PricePoint>()
  for (const point of sorted) latestPerMerchant.set(point.merchantId, point)
  const others = [...latestPerMerchant.values()]
    .filter((p) => p.merchantId !== best.merchantId)
    .sort((a, b) => a.priceCents - b.priceCents)

  return {
    best,
    others,
    // Dividing by a pack size leaves fractional cents, so both of these round.
    basePriceCents: product.size ? roundCents(best.priceCents / product.size.amount) : null,
    baseUnit: product.size?.unit ?? null,
    latest: sorted[sorted.length - 1],
    averageCents: roundCents(prices.reduce((a, b) => a + b, 0) / prices.length),
    minCents: Math.min(...prices),
    maxCents: Math.max(...prices),
  }
}

/** Purchases newest first, with the cheapest ones marked for highlighting. */
export function purchaseHistory(product: Product): Array<PricePoint & { isBest: boolean }> {
  const min = Math.min(...product.purchases.map((p) => p.priceCents))
  return [...product.purchases]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ ...p, isBest: p.priceCents === min }))
}

export function firstPurchaseDate(product: Product): string {
  return [...product.purchases].sort((a, b) => a.date.localeCompare(b.date))[0].date
}

export function findProduct(products: Product[], id: string): Product | undefined {
  return products.find((p) => p.id === id)
}

/** Case-insensitive substring match on the product name. */
export function searchProducts(products: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return products
  return products.filter((p) => p.name.toLowerCase().includes(q))
}

/* ------------------------------------------------------------ Sparpotenzial */

export interface SavingsRow {
  productId: string
  productName: string
  cheapest: PricePoint
  /** The priciest purchase made in the period — the clearest example to quote. */
  worst: PricePoint
  /** How many purchases in the period cost more than the best known price. */
  overpaidCount: number
  /** Total avoidable spend for this product. */
  excessCents: number
}

/**
 * For every purchase in the period, the gap to the best price ever recorded for
 * that product at any merchant. Products bought only at their best price drop out.
 */
export function savingsRows(products: Product[], monthStart: string, monthEnd: string): SavingsRow[] {
  const rows: SavingsRow[] = []

  for (const product of products) {
    const inPeriod = product.purchases.filter((p) => p.date >= monthStart && p.date <= monthEnd)
    if (inPeriod.length === 0) continue

    const { best } = comparePrices(product)
    const overpaid = inPeriod.filter((p) => p.priceCents > best.priceCents)
    if (overpaid.length === 0) continue

    rows.push({
      productId: product.id,
      productName: product.name,
      cheapest: best,
      worst: overpaid.reduce((a, b) => (b.priceCents > a.priceCents ? b : a)),
      overpaidCount: overpaid.length,
      excessCents: overpaid.reduce((sum, p) => sum + (p.priceCents - best.priceCents), 0),
    })
  }

  return rows.sort((a, b) => b.excessCents - a.excessCents)
}

export function totalExcess(rows: SavingsRow[]): number {
  return rows.reduce((sum, row) => sum + row.excessCents, 0)
}

/* ------------------------------------------------------------ top products */

export function rankedTopProducts(products: TopProduct[], limit = 10): TopProduct[] {
  return [...products].sort((a, b) => b.amountCents - a.amountCents).slice(0, limit)
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
 */
export function linePoints(values: number[], width: number, height: number, padding = 10): ChartPoint[] {
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
