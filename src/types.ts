/**
 * Domain types for Receipt AI.
 *
 * Everything here is shaped like rows that a database would hand back: numbers
 * stay numbers, dates stay ISO strings (`YYYY-MM-DD`), and no value is
 * pre-formatted for display. Formatting lives in `src/lib/format.ts`, so
 * swapping the mocks in `src/mocks/` for Supabase queries touches no UI code.
 */

export type Merchant = 'Rewe' | 'Edeka' | 'Lidl' | 'Aldi'

/** Stable category keys. `nonfood` is always shown, never folded into "other". */
export type CategoryId =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'sweets'
  | 'bakery'
  | 'drinks'
  | 'readymeals'
  | 'staples'
  | 'nonfood'

export interface Category {
  id: CategoryId
  name: string
  /** Non-food is charted in a neutral tone; food categories share a green ramp. */
  isFood: boolean
}

/** Health warnings the AI attaches to a line item. */
export type HealthFlagId = 'processed' | 'seedOil' | 'gluten' | 'cheapDairy'

export interface HealthFlag {
  id: HealthFlagId
  /** Single-letter badge shown on the line item. */
  letter: string
  label: string
}

/**
 * How a line item was priced on the receipt. `unknown` covers items the scanner
 * could not attach an amount to — those are excluded from €/kg comparisons.
 */
export type Quantity =
  | { kind: 'count'; count: number; unitPrice: number }
  | { kind: 'weight'; amount: number; unit: 'kg' | 'l'; pricePerUnit: number }
  | { kind: 'unknown' }

export interface ReceiptItem {
  id: string
  name: string
  categoryId: CategoryId
  quantity: Quantity
  /** Line total in euros. */
  total: number
  flags: HealthFlagId[]
}

export interface Receipt {
  id: string
  merchant: Merchant
  /** ISO date, e.g. `2026-08-14`. */
  date: string
  /** The sum printed on the paper receipt. May disagree with the line items. */
  printedTotal: number
  items: ReceiptItem[]
}

/** One observed price for a product at one merchant on one day. */
export interface PricePoint {
  merchant: Merchant
  date: string
  price: number
}

export interface Product {
  id: string
  name: string
  categoryId: CategoryId
  /** Pack size used for the €/kg or €/l base price. `null` → "ohne Mengenangabe". */
  size: { amount: number; unit: 'kg' | 'l' | 'Stück' } | null
  purchases: PricePoint[]
}

/**
 * Monthly rollup. With a real backend this is an aggregate query / view over
 * receipts rather than a stored row.
 */
export interface MonthSummary {
  /** First day of the month, ISO. */
  month: string
  /** Day the figures are current as of, ISO. */
  asOf: string
  food: number
  nonFood: number
  budget: number
  /** Projection to month end at the current pace. */
  forecast: number
  receiptCount: number
  /** Same month-to-date figure one month earlier, for the comparison line. */
  previousMonthToDate: number
}

export interface CategoryTotal {
  categoryId: CategoryId
  amount: number
}

export type RangeId = 'week' | 'month' | 'year' | 'custom'

export interface TrendPoint {
  label: string
  amount: number
}

export interface TopProduct {
  name: string
  purchaseCount: number
  amount: number
}

export interface HealthMonth {
  /** First day of the month, ISO. */
  month: string
  score: number
}

export interface HealthSummary {
  scores: HealthMonth[]
  /** Euro split of food spending. */
  unprocessed: number
  processed: number
}

export interface HealthConcern {
  flag: HealthFlagId
  title: string
  amount: number
  detail: string
  tip: string
}

export interface HouseholdMember {
  id: string
  name: string
  email: string
  /** The member using the app right now. */
  isCurrentUser: boolean
}

export interface Settings {
  monthlyBudget: number
  deleteReceiptPhotos: boolean
}
