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
  food: 236,
  nonFood: 41,
  budget: 450,
  forecast: 490,
  receiptCount: 9,
  previousMonthToDate: 252,
}

/** Sums to the month total: 236 € food + 41 € non-food = 277 €. */
export const categoryTotals: CategoryTotal[] = [
  { categoryId: 'produce', amount: 58.4 },
  { categoryId: 'meat', amount: 47.1 },
  { categoryId: 'dairy', amount: 32.8 },
  { categoryId: 'sweets', amount: 24.3 },
  { categoryId: 'bakery', amount: 21.5 },
  { categoryId: 'drinks', amount: 18.9 },
  { categoryId: 'readymeals', amount: 16.6 },
  { categoryId: 'staples', amount: 16.4 },
  { categoryId: 'nonfood', amount: 41.0 },
]

export const trends: Record<RangeId, TrendPoint[]> = {
  week: [
    { label: 'Mo', amount: 0 },
    { label: 'Di', amount: 23.49 },
    { label: 'Mi', amount: 0 },
    { label: 'Do', amount: 42.17 },
    { label: 'Fr', amount: 11.8 },
    { label: 'Sa', amount: 61.3 },
    { label: 'So', amount: 0 },
  ],
  month: [
    { label: 'KW31', amount: 68.4 },
    { label: 'KW32', amount: 96.2 },
    { label: 'KW33', amount: 112.4 },
    { label: 'KW34', amount: 0 },
    { label: 'KW35', amount: 0 },
  ],
  year: [
    { label: 'Mär', amount: 402.1 },
    { label: 'Apr', amount: 438.9 },
    { label: 'Mai', amount: 415.6 },
    { label: 'Jun', amount: 449.3 },
    { label: 'Jul', amount: 471.2 },
    { label: 'Aug', amount: 277 },
  ],
  custom: [
    { label: '1.–7.', amount: 68.4 },
    { label: '8.–14.', amount: 208.6 },
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
  { name: 'Hähnchenbrust', purchaseCount: 4, amount: 26.96 },
  { name: 'Lachsfilet', purchaseCount: 1, amount: 12.49 },
  { name: 'Rinderhack', purchaseCount: 2, amount: 9.98 },
  { name: 'Olivenöl', purchaseCount: 1, amount: 8.49 },
  { name: 'Gouda am Stück', purchaseCount: 3, amount: 8.37 },
  { name: 'Kaffeebohnen', purchaseCount: 1, amount: 7.99 },
  { name: 'Eier (10er)', purchaseCount: 2, amount: 6.68 },
  { name: 'Sauerteigbrot', purchaseCount: 2, amount: 5.68 },
  { name: 'Tiefkühl-Pizza', purchaseCount: 2, amount: 5.58 },
  { name: 'Butter', purchaseCount: 2, amount: 5.18 },
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
  unprocessed: 151.04,
  processed: 84.96,
}

export const healthConcerns: HealthConcern[] = [
  {
    flag: 'seedOil',
    title: 'Samenöle',
    amount: 19,
    detail: 'Sonnenblumenöl, Rapsöl und Fertigprodukte mit Samenölen – 7 Positionen im August.',
    tip: 'Statt Sonnenblumenöl: Butter, Ghee oder Olivenöl.',
  },
  {
    flag: 'gluten',
    title: 'Gluten',
    amount: 34,
    detail: '34 € für glutenhaltige Backwaren – vor allem Toast und Brötchen.',
    tip: 'Statt Weizentoast: Sauerteigbrot mit langer Führung oder Buchweizenbrot.',
  },
  {
    flag: 'cheapDairy',
    title: 'Billigmilch',
    amount: 12,
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
  monthlyBudget: 450,
  deleteReceiptPhotos: true,
}
