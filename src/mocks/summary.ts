import type {
  CategoryTotal,
  HealthConcern,
  HealthSummary,
  HouseholdMember,
  MonthSummary,
  RangeId,
  Settings,
  TopProduct,
  TrendPoint,
} from '../types'
import { formatDate, formatMonth, formatMonthShort, parseISO } from '../lib/format'
import { daysAgo, isoWeek, monthDay, monthsAgo, today } from './dates'

/**
 * Rollups over the current month. Only three of its nine receipts are detailed
 * in `receipts.ts`, so the figures below stand in for the aggregate queries a
 * backend would run over the full set.
 *
 * The amounts are fixed sample values; only the dates and labels move with the
 * calendar. With Supabase these become views: `monthly_summary`,
 * `category_totals`, `spending_trend`, `top_products`, `health_summary`.
 */

export const monthSummary: MonthSummary = {
  month: monthsAgo(0),
  asOf: today,
  foodCents: 23600,
  nonFoodCents: 4100,
  budgetCents: 45000,
  forecastCents: 49000,
  receiptCount: 9,
  previousMonthToDateCents: 25200,
}

/** Sums to the month total: 236 € food + 41 € non-food = 277 €. */
export const categoryTotals: CategoryTotal[] = [
  { categoryId: 'produce', amountCents: 5840 },
  { categoryId: 'meat', amountCents: 4710 },
  { categoryId: 'dairy', amountCents: 3280 },
  { categoryId: 'sweets', amountCents: 2430 },
  { categoryId: 'bakery', amountCents: 2150 },
  { categoryId: 'drinks', amountCents: 1890 },
  { categoryId: 'readymeals', amountCents: 1660 },
  { categoryId: 'staples', amountCents: 1640 },
  { categoryId: 'nonfood', amountCents: 4100 },
]

export const trends: Record<RangeId, TrendPoint[]> = {
  week: [
    { label: 'Mo', amountCents: 0 },
    { label: 'Di', amountCents: 2349 },
    { label: 'Mi', amountCents: 0 },
    { label: 'Do', amountCents: 4217 },
    { label: 'Fr', amountCents: 1180 },
    { label: 'Sa', amountCents: 6130 },
    { label: 'So', amountCents: 0 },
  ],
  // The weeks the current month runs through, by their ISO calendar number.
  month: [6840, 9620, 11240, 0, 0].map((amountCents, index) => ({
    label: `KW${isoWeek(monthDay(1 + index * 7))}`,
    amountCents,
  })),
  // Six months back to this one; the last bar is the current month to date and
  // therefore matches `monthSummary`. Exactly one month is over the 450 € budget.
  year: [40210, 43890, 41560, 44930, 47120, 27700].map((amountCents, index) => ({
    label: formatMonthShort(monthsAgo(5 - index)),
    amountCents,
  })),
  // The last fortnight, split into two weeks.
  custom: [
    { label: dayRange(13, 7), amountCents: 6840 },
    { label: dayRange(6, 0), amountCents: 20860 },
  ],
}

/** `1.–7.` — bucket label, day numbers only, as in the design. */
function dayRange(fromDaysAgo: number, toDaysAgo: number): string {
  const day = (iso: string) => parseISO(iso).getDate()
  return `${day(daysAgo(fromDaysAgo))}.–${day(daysAgo(toDaysAgo))}.`
}

export const rangeLabels: Record<RangeId, { tab: string; period: string }> = {
  week: { tab: 'Woche', period: 'diese Woche' },
  month: { tab: 'Monat', period: formatMonth(monthsAgo(0)) },
  year: { tab: 'Jahr', period: 'letzte 6 Monate' },
  // `01.08.–14.08.2026` — the year is only spelled out once, at the end.
  custom: { tab: 'Eigen', period: `${formatDate(daysAgo(13)).slice(0, 6)}–${formatDate(daysAgo(0))}` },
}

/** Top spend per product this month, sorted in `derive.ts`. */
export const topProducts: TopProduct[] = [
  { name: 'Hähnchenbrust', purchaseCount: 4, amountCents: 2696 },
  { name: 'Lachsfilet', purchaseCount: 1, amountCents: 1249 },
  { name: 'Rinderhack', purchaseCount: 2, amountCents: 998 },
  { name: 'Olivenöl', purchaseCount: 1, amountCents: 849 },
  { name: 'Gouda am Stück', purchaseCount: 3, amountCents: 837 },
  { name: 'Kaffeebohnen', purchaseCount: 1, amountCents: 799 },
  { name: 'Eier (10er)', purchaseCount: 2, amountCents: 668 },
  { name: 'Sauerteigbrot', purchaseCount: 2, amountCents: 568 },
  { name: 'Tiefkühl-Pizza', purchaseCount: 2, amountCents: 558 },
  { name: 'Butter', purchaseCount: 2, amountCents: 518 },
]

export const healthSummary: HealthSummary = {
  scores: [58, 61, 64, 63, 67, 72].map((score, index) => ({
    month: monthsAgo(5 - index),
    score,
  })),
  // 64 % / 36 % of the 236 € food spend.
  unprocessedCents: 15104,
  processedCents: 8496,
}

export const healthConcerns: HealthConcern[] = [
  {
    flag: 'seedOil',
    title: 'Samenöle',
    amountCents: 1900,
    detail: 'Sonnenblumenöl, Rapsöl und Fertigprodukte mit Samenölen – 7 Positionen im August.',
    tip: 'Statt Sonnenblumenöl: Butter, Ghee oder Olivenöl.',
  },
  {
    flag: 'gluten',
    title: 'Gluten',
    amountCents: 3400,
    detail: '34 € für glutenhaltige Backwaren – vor allem Toast und Brötchen.',
    tip: 'Statt Weizentoast: Sauerteigbrot mit langer Führung oder Buchweizenbrot.',
  },
  {
    flag: 'cheapDairy',
    title: 'Billigmilch',
    amountCents: 1200,
    detail: 'Eigenmarken-Frischkäse und H-Milch aus konventioneller Haltung.',
    tip: 'Statt Eigenmarke: Weidemilch oder Bio-Frischkäse – ca. 0,40 € mehr pro Packung.',
  },
]

export const household: HouseholdMember[] = [
  { id: 'u1', name: 'Jonas', email: 'jonas@gmail.com', isCurrentUser: true },
  { id: 'u2', name: 'Marie', email: 'marie@gmail.com', isCurrentUser: false },
  { id: 'u3', name: 'Opa Klaus', email: 'klaus@gmail.com', isCurrentUser: false },
]

export const defaultSettings: Settings = {
  monthlyBudgetCents: 45000,
  deleteReceiptPhotos: true,
}
