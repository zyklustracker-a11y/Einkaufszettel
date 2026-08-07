/**
 * Data access seam.
 *
 * Every screen reads through these functions, never from `src/mocks/*` directly.
 * Wiring up Supabase means replacing the bodies here (and making the callers
 * await them) — no component needs to change shape.
 */
import { categories } from '../mocks/categories'
import { today } from '../mocks/dates'
import { merchants } from '../mocks/merchants'
import { traits } from '../mocks/traits'
import { receipts, scannedReceiptId } from '../mocks/receipts'
import { products } from '../mocks/products'
import {
  categoryTotals,
  defaultSettings,
  healthSummary,
  household,
  monthSummary,
  rangeLabels,
  topProducts,
  trends,
} from '../mocks/summary'
import { foodItems } from '../lib/score'
import type {
  Category,
  Merchant,
  MerchantId,
  Product,
  RangeId,
  Receipt,
  ReceiptItem,
  Trait,
  TraitId,
} from '../types'

export const getToday = () => today

export const getCategories = (): Category[] => categories
export const getCategory = (id: string): Category | undefined => categories.find((c) => c.id === id)
export const getTraits = (): Trait[] => traits
export const getTrait = (id: TraitId): Trait | undefined => traits.find((t) => t.id === id)
/** Only active traits reach the UI; inactive ones keep their data but stay hidden. */
export const getActiveTraits = (): Trait[] => traits.filter((t) => t.active)

export const getMerchants = (): Merchant[] => merchants
export const getMerchant = (id: MerchantId): Merchant | undefined => merchants.find((m) => m.id === id)
/** Display name for a merchant id; falls back to the raw id if it is unknown. */
export const getMerchantName = (id: MerchantId): string => getMerchant(id)?.name ?? id

export const getMonthSummary = () => monthSummary
export const getCategoryTotals = () => categoryTotals

export const getReceipts = (): Receipt[] => receipts
export const getRecentReceipts = (limit = 3): Receipt[] => receipts.slice(0, limit)
export const getReceipt = (id: string): Receipt | undefined => receipts.find((r) => r.id === id)
/** The receipt the scan flow hands to the correction screen. */
export const getScannedReceipt = (): Receipt => getReceipt(scannedReceiptId) ?? receipts[0]

export const getProducts = (): Product[] => products
export const getProduct = (id: string): Product | undefined => products.find((p) => p.id === id)

export const getTrend = (range: RangeId) => trends[range]
export const getRangeLabels = () => rangeLabels
export const getTopProducts = () => topProducts

export const getHealthSummary = () => healthSummary

/** The input to the health score and the trait breakdown. */
export const getFoodItems = (): ReceiptItem[] => foodItems(receipts, categories)

export const getHousehold = () => household
export const getDefaultSettings = () => defaultSettings

/** The current month as an ISO range, for period filters. */
export function getMonthRange(): { start: string; end: string } {
  return { start: monthSummary.month, end: monthSummary.asOf }
}
