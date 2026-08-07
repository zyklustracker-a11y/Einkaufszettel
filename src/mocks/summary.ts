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

/**
 * The date the app treats as "today". Only three of August's nine receipts are
 * detailed in `receipts.ts`, so the rollups below stand in for the aggregate
 * queries a backend would run over the full set.
 *
 * With Supabase these become views: `monthly_summary`, `category_totals`,
 * `spending_trend`, `top_products`, `health_summary`.
 */
export const today = '2026-08-14'

export const monthSummary: MonthSummary = {
  month: '2026-08-01',
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
  month: [
    { label: 'KW31', amountCents: 6840 },
    { label: 'KW32', amountCents: 9620 },
    { label: 'KW33', amountCents: 11240 },
    { label: 'KW34', amountCents: 0 },
    { label: 'KW35', amountCents: 0 },
  ],
  year: [
    { label: 'Mär', amountCents: 40210 },
    { label: 'Apr', amountCents: 43890 },
    { label: 'Mai', amountCents: 41560 },
    { label: 'Jun', amountCents: 44930 },
    { label: 'Jul', amountCents: 47120 },
    { label: 'Aug', amountCents: 27700 },
  ],
  custom: [
    { label: '1.–7.', amountCents: 6840 },
    { label: '8.–14.', amountCents: 20860 },
  ],
}

export const rangeLabels: Record<RangeId, { tab: string; period: string }> = {
  week: { tab: 'Woche', period: 'diese Woche' },
  month: { tab: 'Monat', period: 'August 2026' },
  year: { tab: 'Jahr', period: 'letzte 6 Monate' },
  custom: { tab: 'Eigen', period: '01.–14.08.2026' },
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
  scores: [
    { month: '2026-03-01', score: 58 },
    { month: '2026-04-01', score: 61 },
    { month: '2026-05-01', score: 64 },
    { month: '2026-06-01', score: 63 },
    { month: '2026-07-01', score: 67 },
    { month: '2026-08-01', score: 72 },
  ],
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
