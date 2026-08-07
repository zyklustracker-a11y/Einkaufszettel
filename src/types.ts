/**
 * Domain types for Receipt AI.
 *
 * Everything here is shaped like rows that a database would hand back: numbers
 * stay numbers, dates stay ISO strings (`YYYY-MM-DD`), and no value is
 * pre-formatted for display. Money is always a whole number of cents — never a
 * float — and every such field carries a `Cents` suffix. Formatting lives in
 * `src/lib/format.ts`, so swapping the mocks in `src/mocks/` for Supabase
 * queries touches no UI code.
 */

/**
 * Merchants are data, not a fixed union: shops come and go, and in the database
 * this is its own table. Receipts and price points hold a `MerchantId`.
 */
export type MerchantId = string

export interface Merchant {
  id: MerchantId
  name: string
}

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

/**
 * Traits are data, not code: no union type and no enum, because the household
 * decides what it wants to watch (PROJEKT.md). New traits are rows, not commits.
 */
export type TraitId = string

export interface Trait {
  id: TraitId
  label: string
  /** 1–2 characters for the badge in item lists. */
  short: string
  /** Short explanation. Goes to the model as a classification instruction later. */
  description: string
  /** Score weight, −10…+10. Negative is worse, 0 is merely observed. */
  weight: number
  /**
   * Optional group for overlapping traits (`weizen` implies `gluten`). Within a
   * group only one trait counts towards the score — see `src/lib/score.ts`.
   * As a *label* every applicable trait still sticks to the item, because the
   * spending breakdown has to count all of them.
   */
  group?: string
  /** Alternative suggestion shown on the health screen. */
  tip: string
  /** Off without losing the data already tagged with it. */
  active: boolean
  /** Shipped with a new household, as opposed to user-created. */
  isDefault: boolean
}

/**
 * Dairy attributes. Deliberately two independent fields and not one list: milk
 * can be pasteurised and homogenised at the same time.
 *
 * `unbekannt` produces no trait and therefore counts neutral, never negative —
 * a wrongly guessed attribute is worse than an empty one (PROJEKT.md).
 */
export type MilkHeat = 'roh' | 'pasteurisiert' | 'esl' | 'uht' | 'unbekannt'
export type MilkHomogenized = 'ja' | 'nein' | 'unbekannt'

/**
 * How a line item was priced on the receipt. `unknown` covers items the scanner
 * could not attach an amount to — those are excluded from €/kg comparisons.
 */
export type Quantity =
  | { kind: 'count'; count: number; unitPriceCents: number }
  | { kind: 'weight'; amount: number; unit: 'kg' | 'l'; pricePerUnitCents: number }
  | { kind: 'unknown' }

export interface ReceiptItem {
  id: string
  name: string
  categoryId: CategoryId
  quantity: Quantity
  /** Line total in whole cents. */
  totalCents: number
  /**
   * Every trait that applies. Ids not present in the household's trait list are
   * dropped when scoring, so a stale id is harmless.
   *
   * These sit on the line item for now. From Schritt 2 on they belong to the
   * canonical product, where they apply retroactively to every purchase.
   */
  traitIds: TraitId[]
  /** Dairy items only. */
  milkHeat?: MilkHeat
  milkHomogenized?: MilkHomogenized
}

export interface Receipt {
  id: string
  merchantId: MerchantId
  /** ISO date, e.g. `2026-08-14`. */
  date: string
  /** The sum printed on the paper receipt. May disagree with the line items. */
  printedTotalCents: number
  items: ReceiptItem[]
}

/** One observed price for a product at one merchant on one day. */
export interface PricePoint {
  merchantId: MerchantId
  date: string
  priceCents: number
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
  foodCents: number
  nonFoodCents: number
  budgetCents: number
  /** Projection to month end at the current pace. */
  forecastCents: number
  receiptCount: number
  /** Same month-to-date figure one month earlier, for the comparison line. */
  previousMonthToDateCents: number
}

export interface CategoryTotal {
  categoryId: CategoryId
  amountCents: number
}

export type RangeId = 'week' | 'month' | 'year' | 'custom'

export interface TrendPoint {
  label: string
  amountCents: number
}

export interface TopProduct {
  name: string
  purchaseCount: number
  amountCents: number
}

export interface HealthMonth {
  /** First day of the month, ISO. */
  month: string
  score: number
}

export interface HealthSummary {
  /** Newest last; the current month is computed, the earlier ones are samples. */
  scores: HealthMonth[]
  /** Split of food spending, in whole cents. */
  unprocessedCents: number
  processedCents: number
}

export interface HouseholdMember {
  id: string
  name: string
  email: string
  /** The member using the app right now. */
  isCurrentUser: boolean
}

export interface Settings {
  monthlyBudgetCents: number
  deleteReceiptPhotos: boolean
}
