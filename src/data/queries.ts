import { supabase } from '../lib/supabase'
import { toISO } from '../lib/format'
import { healthScore } from '../lib/score'
import type { TraitSpending } from '../lib/score'
import type { SavedItem } from '../lib/draft'
import { DataError, unwrap, unwrapMaybe } from './client'
import { reference } from './reference'
import type {
  CategoryId,
  CategoryTotal,
  FrequentProduct,
  FuelMonth,
  HealthMonth,
  HouseholdStats,
  ItemSearch,
  ItemSearchResult,
  MerchantId,
  MerchantKind,
  MonthSummary,
  PricePoint,
  ProductPriceDetail,
  ProductPriceOverview,
  Quantity,
  RangeId,
  Receipt,
  ReceiptItem,
  SavingsRow,
  TopProduct,
  Trait,
  TrendBucket,
} from '../types'

/**
 * Die eigentlichen Abfragen.
 *
 * Ein Screen = eine Funktion = ein Ladezustand. Alles, was ein Screen braucht,
 * wird hier in einem `Promise.all` gebündelt, damit die Abfragen nebeneinander
 * laufen und die Oberfläche nicht stückweise erscheint.
 *
 * Gerechnet wird hier nichts: Summen, Vergleiche und Zeitfenster kommen aus den
 * Sichten in `supabase/migrations/0002_views.sql`. Was hier passiert, ist
 * Umbenennen von Spalten in Feldnamen — und der Health-Score, der bewusst als
 * Formel im Code bleibt (siehe Kopf der Migration).
 */

/* ------------------------------------------------------------ Zeitrechnung */

/**
 * Erster Tag des laufenden Monats nach der Uhr des Geräts.
 *
 * Nur zum **Schreiben** des Budgets und als untere Schranke beim Score-Verlauf.
 * Zum Filtern von Auswertungen wird stattdessen `month` aus
 * `v_current_month_summary` verwendet — sonst könnten Gerät und Datenbank in
 * der Nacht zum Monatsersten auf verschiedene Monate zeigen und der Screen
 * zeigte einen leeren Monat, obwohl Daten da sind.
 */
function currentMonthStart(): string {
  const now = new Date()
  return toISO(new Date(now.getFullYear(), now.getMonth(), 1))
}

/** Erster Tag des Monats `n` Monate zurück, ISO. */
function monthsBack(n: number): string {
  const now = new Date()
  return toISO(new Date(now.getFullYear(), now.getMonth() - n, 1))
}

/* ------------------------------------------------------ Zeilen der Sichten */

interface CurrentMonthRow {
  month: string
  as_of: string
  food_cents: number
  nonfood_cents: number
  dining_cents: number
  receipt_count: number
  budget_cents: number
  forecast_cents: number
  previous_month_to_date_cents: number
}

interface CategoryTotalRow {
  category_key: string
  amount_cents: number
}

interface TrendRow {
  range_id: RangeId
  bucket_index: number
  bucket_start: string
  bucket_end: string
  iso_week: number
  amount_cents: number
}

interface TopProductRow {
  name: string
  purchase_count: number
  amount_cents: number
}

interface TraitSpendingRow {
  key: string
  amount_cents: number
  item_count: number
}

interface HealthSplitRow {
  unprocessed_cents: number
  processed_cents: number
}

interface ScoreItemRow {
  month: string
  item_id: string
  total_cents: number
  trait_keys: string[]
}

interface ReceiptRow {
  id: string
  merchant_id: string | null
  purchased_on: string
  printed_total_cents: number
  tip_cents: number
  currency: string
  original_total_cents: number | null
  exchange_rate: number | string | null
  rate_date: string | null
  receipt_items: Array<{ count: number }>
}

/**
 * Die Spaltenliste für einen Bon-Kopf. Sie steht an zwei Stellen und muss
 * überall gleich sein — deshalb einmal hier statt zweimal abgetippt.
 */
const RECEIPT_COLUMNS =
  'id, merchant_id, purchased_on, printed_total_cents, tip_cents, currency, original_total_cents, exchange_rate, rate_date, receipt_items(count)'

interface ItemRow {
  id: string
  line_no: number
  name: string
  total_cents: number
  quantity_base: number | null
  quantity_unit: string | null
  unit_price_cents: number | null
  canonical_product_id: string | null
}

interface ProductRow {
  id: string
  category_key: string
  milk_heat: string
  milk_homogenized: string
}

interface ProductPriceRow {
  product_id: string
  product_name: string
  category_key: string
  min_cents: number
  max_cents: number
  avg_cents: number
  purchase_count: number
  first_purchased_on: string
  base_price_cents: number | null
  base_unit: string | null
  merchant_count: number
}

/** Steht an drei Stellen und muss überall gleich sein. */
const PRODUCT_PRICE_COLUMNS =
  'product_id, product_name, category_key, min_cents, max_cents, avg_cents, purchase_count, first_purchased_on, base_price_cents, base_unit, merchant_count'

interface PricePointRow {
  product_id: string
  merchant_id: string
  purchased_on: string
  price_cents: number
}

interface SavingsRowRaw {
  product_id: string
  product_name: string
  best_merchant_id: string
  best_price_cents: number
  best_purchased_on: string
  worst_merchant_id: string
  worst_price_cents: number
  worst_purchased_on: string
  overpaid_count: number
  excess_cents: number
}

/* ------------------------------------------------------------- Übersetzung */

function toPricePoint(row: PricePointRow): PricePoint {
  return { merchantId: row.merchant_id, date: row.purchased_on, priceCents: row.price_cents }
}

/**
 * Menge und Einzelpreis aus der Datenbank in die Anzeigeform bringen.
 *
 * In der Datenbank ist die Menge eine ganze Zahl in der kleinsten Einheit
 * (Gramm, Milliliter, Stück) und `quantity_unit` sagt, worin angezeigt wird.
 * Die Oberfläche kennt nur Stück, Kilo und Liter, deshalb werden Gramm und
 * Milliliter hier hochgerechnet — der Einzelpreis entsprechend mit.
 *
 * Ohne Menge kommt `unknown` heraus. Das ist laut PROJEKT.md ein echter
 * Zustand und kein Fehler.
 */
function toQuantity(row: ItemRow): Quantity {
  if (row.quantity_base === null || row.quantity_unit === null) return { kind: 'unknown' }

  if (row.quantity_unit === 'stk') {
    const count = row.quantity_base
    const unitPriceCents =
      row.unit_price_cents ?? (count > 0 ? Math.round(row.total_cents / count) : row.total_cents)
    return { kind: 'count', count, unitPriceCents }
  }

  const perThousand = row.quantity_unit === 'kg' || row.quantity_unit === 'l'
  const unit = row.quantity_unit === 'kg' || row.quantity_unit === 'g' ? 'kg' : 'l'
  // Basis ist immer Gramm bzw. Milliliter; angezeigt wird in Kilo bzw. Liter.
  const amount = row.quantity_base / 1000
  const factor = perThousand ? 1 : 1000
  const pricePerUnitCents =
    row.unit_price_cents !== null
      ? row.unit_price_cents * factor
      : amount > 0
        ? Math.round(row.total_cents / amount)
        : row.total_cents

  return { kind: 'weight', amount, unit, pricePerUnitCents }
}

/* ------------------------------------------------------------- Health-Score */

/**
 * Der Score je Monat, aus den Zutaten der View gerechnet.
 *
 * `healthScore` erwartet Positionen; gebraucht werden davon nur Betrag und
 * Merkmale, deshalb reicht ein schmaler Platzhalter. Die Milch-Merkmale hat die
 * View schon in `trait_keys` aufgelöst, also bleiben `milkHeat` und
 * `milkHomogenized` hier leer.
 */
function scoresByMonth(rows: ScoreItemRow[], traits: Trait[]): HealthMonth[] {
  const byMonth = new Map<string, ReceiptItem[]>()

  for (const row of rows) {
    const items = byMonth.get(row.month) ?? []
    items.push({
      id: row.item_id,
      name: '',
      categoryId: '',
      quantity: { kind: 'unknown' },
      totalCents: row.total_cents,
      traitIds: row.trait_keys,
    })
    byMonth.set(row.month, items)
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, items]) => ({ month, score: healthScore(items, traits) }))
}

/* =============================================================== Übersicht */

export interface DashboardData {
  summary: MonthSummary
  categoryTotals: CategoryTotal[]
  scores: HealthMonth[]
  unprocessedCents: number
  processedCents: number
  recent: RecentReceipt[]
}

export interface RecentReceipt {
  id: string
  merchantId: MerchantId | null
  date: string
  totalCents: number
  itemCount: number
}

async function loadCurrentMonth(): Promise<MonthSummary> {
  const row = unwrapMaybe(
    await supabase
      .from('v_current_month_summary')
      .select('month, as_of, food_cents, nonfood_cents, dining_cents, receipt_count, budget_cents, forecast_cents, previous_month_to_date_cents')
      .maybeSingle(),
  ) as CurrentMonthRow | null

  // Die View geht von `households` aus und liefert deshalb immer genau eine
  // Zeile. Fehlt sie doch, gehört der Nutzer zu keinem Haushalt.
  if (!row) throw new DataError('Zu diesem Konto gehört noch kein Haushalt.')

  return {
    month: row.month,
    asOf: row.as_of,
    foodCents: row.food_cents,
    diningCents: row.dining_cents,
    nonFoodCents: row.nonfood_cents,
    budgetCents: row.budget_cents,
    forecastCents: row.forecast_cents,
    receiptCount: row.receipt_count,
    previousMonthToDateCents: row.previous_month_to_date_cents,
  }
}

async function loadCategoryTotals(month: string): Promise<CategoryTotal[]> {
  const rows = unwrap<CategoryTotalRow[]>(
    await supabase
      .from('v_category_totals')
      .select('category_key, amount_cents')
      .eq('month', month)
      .order('sort_order'),
  )
  return rows.map((row) => ({
    categoryId: row.category_key as CategoryId,
    amountCents: row.amount_cents,
  }))
}

async function loadScoreHistory(): Promise<HealthMonth[]> {
  const rows = unwrap<ScoreItemRow[]>(
    await supabase
      .from('v_score_items')
      .select('month, item_id, total_cents, trait_keys')
      .gte('month', monthsBack(5)),
  )
  return scoresByMonth(rows, reference().traits)
}

async function loadHealthSplit(month: string): Promise<HealthSplitRow> {
  const row = unwrapMaybe(
    await supabase
      .from('v_health_split')
      .select('unprocessed_cents, processed_cents')
      .eq('month', month)
      .maybeSingle(),
  ) as HealthSplitRow | null
  return row ?? { unprocessed_cents: 0, processed_cents: 0 }
}

async function loadRecentReceipts(limit: number): Promise<RecentReceipt[]> {
  const rows = unwrap<ReceiptRow[]>(
    await supabase
      .from('receipts')
      .select(RECEIPT_COLUMNS)
      .eq('status', 'confirmed')
      .order('purchased_on', { ascending: false })
      .limit(limit),
  )
  return rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    date: row.purchased_on,
    // Mit Trinkgeld: In der Liste steht, was der Einkauf gekostet hat, und das
    // ist bei einem Restaurantbesuch mehr als die gedruckte Summe.
    totalCents: row.printed_total_cents + row.tip_cents,
    itemCount: row.receipt_items[0]?.count ?? 0,
  }))
}

export async function getDashboardData(): Promise<DashboardData> {
  const summary = await loadCurrentMonth()
  const [categoryTotals, scores, split, recent] = await Promise.all([
    loadCategoryTotals(summary.month),
    loadScoreHistory(),
    loadHealthSplit(summary.month),
    loadRecentReceipts(3),
  ])

  return {
    summary,
    categoryTotals,
    scores,
    unprocessedCents: split.unprocessed_cents,
    processedCents: split.processed_cents,
    recent,
  }
}

/* ================================================================ Analysen */

export interface AnalyticsData {
  month: string
  budgetCents: number
  buckets: TrendBucket[]
  categoryTotals: CategoryTotal[]
  savings: SavingsRow[]
  topProducts: TopProduct[]
  /** Leer, solange kein Tankbeleg erfasst ist — dann fehlt die Karte ganz. */
  fuelMonths: FuelMonth[]
  frequentProducts: FrequentProduct[]
  /** Wie viel Grundlage da ist — die Analysen sagen es selbst dazu. */
  stats: HouseholdStats
}

interface StatsRow {
  receipt_count: number
  first_purchased_on: string | null
  last_purchased_on: string | null
  day_span: number
  product_count: number
  merchant_count: number
}

/**
 * Wie viel Datengrundlage der Haushalt hat.
 *
 * Gebraucht an zwei Stellen, und beide sind derselbe Gedanke: Die Analysen
 * sagen damit, wie belastbar ihre eigenen Zahlen sind, und der Einkaufszettel
 * misst daran seine Schwelle (14 Tage, 4 Einkäufe).
 */
export async function getHouseholdStats(): Promise<HouseholdStats> {
  const row = unwrapMaybe(
    await supabase
      .from('v_household_stats')
      .select('receipt_count, first_purchased_on, last_purchased_on, day_span, product_count, merchant_count')
      .maybeSingle(),
  ) as StatsRow | null

  return {
    receiptCount: row?.receipt_count ?? 0,
    firstPurchasedOn: row?.first_purchased_on ?? null,
    lastPurchasedOn: row?.last_purchased_on ?? null,
    daySpan: row?.day_span ?? 0,
    productCount: row?.product_count ?? 0,
    merchantCount: row?.merchant_count ?? 0,
  }
}

interface FrequentProductRow {
  name: string
  purchase_count: number
  amount_cents: number
  first_purchased_on: string
  last_purchased_on: string
}

interface FuelMonthRow {
  month: string
  fill_count: number
  amount_cents: number
  millilitres: number
  /** `numeric` kommt über PostgREST als Zeichenkette an. */
  price_per_litre_cents: number | string
}

/**
 * Die Tankfüllungen der letzten zwölf Monate.
 *
 * **Ein Fehler wird hier verschluckt und nicht weitergereicht.** Die Sicht kam
 * mit Schritt 7 dazu; wer die Migration noch nicht ausgeführt hat, soll deshalb
 * nicht den ganzen Analysen-Screen verlieren — die Spritkarte fehlt dann eben.
 * Das ist die einzige Stelle mit dieser Ausnahme, und sie gilt nur, weil die
 * Karte selbst optional ist: Ohne Tankbeleg erscheint sie ohnehin nicht.
 */
async function loadFuelMonths(): Promise<FuelMonth[]> {
  const { data, error } = await supabase
    .from('v_fuel_months')
    .select('month, fill_count, amount_cents, millilitres, price_per_litre_cents')
    .gte('month', monthsBack(11))
    .order('month')

  if (error || !data) return []

  return (data as unknown as FuelMonthRow[]).map((row) => ({
    month: row.month,
    fillCount: row.fill_count,
    amountCents: row.amount_cents,
    millilitres: row.millilitres,
    pricePerLitreCents: Number(row.price_per_litre_cents),
  }))
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
  // Erst die Monatsübersicht: Sie sagt, welcher Monat gerade läuft — und zwar
  // nach der Datenbank, nicht nach der Uhr des Geräts.
  const summary = await loadCurrentMonth()
  const month = summary.month

  const [buckets, categoryTotals, savings, topProducts, fuelMonths, frequentProducts, stats] =
    await Promise.all([
      supabase
        .from('v_spending_trend')
        .select('range_id, bucket_index, bucket_start, bucket_end, iso_week, amount_cents')
        .order('bucket_index')
        .then((r) => unwrap<TrendRow[]>(r)),
      loadCategoryTotals(month),
      supabase
        .from('v_savings_current_month')
        // Eine Zeile, keine Verkettung: supabase-js liest die Spaltenliste zur
        // Übersetzungszeit aus und braucht dafür ein Literal.
        .select('product_id, product_name, best_merchant_id, best_price_cents, best_purchased_on, worst_merchant_id, worst_price_cents, worst_purchased_on, overpaid_count, excess_cents')
        .order('excess_cents', { ascending: false })
        .then((r) => unwrap<SavingsRowRaw[]>(r)),
      supabase
        .from('v_top_products')
        .select('name, purchase_count, amount_cents')
        .eq('month', month)
        .lte('rank', 10)
        .order('rank')
        .then((r) => unwrap<TopProductRow[]>(r)),
      loadFuelMonths(),
      supabase
        .from('v_frequent_products')
        .select('name, purchase_count, amount_cents, first_purchased_on, last_purchased_on')
        .lte('rank', 8)
        .order('rank')
        .then((r) => unwrap<FrequentProductRow[]>(r)),
      getHouseholdStats(),
    ])

  return {
    month: summary.month,
    budgetCents: summary.budgetCents,
    buckets: buckets.map((row) => ({
      rangeId: row.range_id,
      index: row.bucket_index,
      start: row.bucket_start,
      end: row.bucket_end,
      isoWeek: row.iso_week,
      amountCents: row.amount_cents,
    })),
    categoryTotals,
    savings: savings.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      cheapest: {
        merchantId: row.best_merchant_id,
        date: row.best_purchased_on,
        priceCents: row.best_price_cents,
      },
      worst: {
        merchantId: row.worst_merchant_id,
        date: row.worst_purchased_on,
        priceCents: row.worst_price_cents,
      },
      overpaidCount: row.overpaid_count,
      excessCents: row.excess_cents,
    })),
    topProducts: topProducts.map((row) => ({
      name: row.name,
      purchaseCount: row.purchase_count,
      amountCents: row.amount_cents,
    })),
    fuelMonths,
    frequentProducts: frequentProducts.map((row) => ({
      name: row.name,
      purchaseCount: row.purchase_count,
      amountCents: row.amount_cents,
      firstPurchasedOn: row.first_purchased_on,
      lastPurchasedOn: row.last_purchased_on,
    })),
    stats,
  }
}

/**
 * Produktsuche im laufenden Monat.
 *
 * Die Datenbank filtert, gezählt und addiert wird über den Treffern — das ist
 * kein Vorrechnen im Browser, sondern das Ergebnis einer Suche, die es als
 * feste Sicht nicht geben kann: der Suchbegriff wechselt mit jeder Eingabe.
 */
export async function searchItemSpending(term: string, month: string): Promise<ItemSearch> {
  const empty: ItemSearchResult = { purchaseCount: 0, amountCents: 0 }
  const needle = term.trim()
  if (!needle) return { inMonth: empty, allTime: empty }

  /*
   * Eine Abfrage über alles, danach im Browser geteilt. Zwei Abfragen wären
   * zwei Wege über die Leitung für dieselben Zeilen — und die Zahl der Treffer
   * ist von Natur aus klein, es geht um die Käufe eines Haushalts.
   */
  const rows = unwrap<Array<{ total_cents: number; month: string }>>(
    await supabase
      .from('v_items')
      .select('total_cents, month')
      // Prozentzeichen und Unterstrich sind in `ilike` Platzhalter und werden
      // deshalb aus der Nutzereingabe entfernt.
      .ilike('product_name', `%${needle.replace(/[%_]/g, '')}%`),
  )

  const sum = (subset: Array<{ total_cents: number }>): ItemSearchResult => ({
    purchaseCount: subset.length,
    amountCents: subset.reduce((total, row) => total + row.total_cents, 0),
  })

  return {
    inMonth: sum(rows.filter((row) => row.month === month)),
    allTime: sum(rows),
  }
}

/* ============================================================== Gesundheit */

export interface HealthData {
  scores: HealthMonth[]
  unprocessedCents: number
  processedCents: number
  spending: TraitSpending[]
}

export async function getHealthData(): Promise<HealthData> {
  // Wie bei den Analysen: Der laufende Monat kommt aus der Datenbank.
  const month = (await loadCurrentMonth()).month
  const traitsByKey = new Map(reference().traits.map((trait) => [trait.id, trait]))

  const [scores, split, spendingRows] = await Promise.all([
    loadScoreHistory(),
    loadHealthSplit(month),
    supabase
      .from('v_trait_spending')
      .select('key, amount_cents, item_count')
      .eq('month', month)
      .order('amount_cents', { ascending: false })
      .then((r) => unwrap<TraitSpendingRow[]>(r)),
  ])

  return {
    scores,
    unprocessedCents: split.unprocessed_cents,
    processedCents: split.processed_cents,
    spending: spendingRows.flatMap((row) => {
      const trait = traitsByKey.get(row.key)
      // Ein Merkmal, das es nicht mehr gibt, wird stillschweigend übergangen
      // statt geraten.
      if (!trait) return []
      return [{ trait, amountCents: row.amount_cents, itemCount: row.item_count }]
    }),
  }
}

/* ============================================================== Bestpreise */

export async function getPriceOverview(): Promise<ProductPriceOverview[]> {
  const [products, best, latest] = await Promise.all([
    supabase
      .from('v_product_prices')
      .select(PRODUCT_PRICE_COLUMNS)
      .order('product_name')
      .then((r) => unwrap<ProductPriceRow[]>(r)),
    supabase
      .from('v_product_best_price')
      .select('product_id, merchant_id, purchased_on, price_cents')
      .then((r) => unwrap<PricePointRow[]>(r)),
    supabase
      .from('v_product_merchant_latest')
      .select('product_id, merchant_id, purchased_on, price_cents')
      .order('price_cents')
      .then((r) => unwrap<PricePointRow[]>(r)),
  ])

  const bestByProduct = new Map(best.map((row) => [row.product_id, toPricePoint(row)]))

  return products.flatMap((row) => {
    const bestPoint = bestByProduct.get(row.product_id)
    // Ohne Bestpreis gibt es nichts zu vergleichen. Kann nur auftreten, wenn
    // zwischen den beiden Abfragen etwas gelöscht wurde.
    if (!bestPoint) return []

    return [
      {
        id: row.product_id,
        name: row.product_name,
        categoryId: row.category_key as CategoryId,
        basePriceCents: row.base_price_cents,
        baseUnit: row.base_unit,
        purchaseCount: row.purchase_count,
        merchantCount: row.merchant_count,
        best: bestPoint,
        others: latest
          .filter((p) => p.product_id === row.product_id && p.merchant_id !== bestPoint.merchantId)
          .map(toPricePoint),
      },
    ]
  })
}

export async function getProductPriceDetail(
  productId: string,
): Promise<ProductPriceDetail | null> {
  const row = unwrapMaybe(
    await supabase
      .from('v_product_prices')
      .select(PRODUCT_PRICE_COLUMNS)
      .eq('product_id', productId)
      .maybeSingle(),
  ) as ProductPriceRow | null

  if (!row) return null

  const purchases = unwrap<PricePointRow[]>(
    await supabase
      .from('v_price_observations')
      .select('product_id, merchant_id, purchased_on, price_cents')
      .eq('product_id', productId)
      .order('purchased_on'),
  )

  return {
    id: row.product_id,
    name: row.product_name,
    basePriceCents: row.base_price_cents,
    baseUnit: row.base_unit,
    purchaseCount: row.purchase_count,
    minCents: row.min_cents,
    maxCents: row.max_cents,
    averageCents: row.avg_cents,
    firstPurchasedOn: row.first_purchased_on,
    purchases: purchases.map(toPricePoint),
  }
}

/* ================================================================ Einkäufe */

/**
 * Ein Bon mit allen Positionen.
 *
 * Kategorie, Merkmale und Milch-Eigenschaften hängen am kanonischen Produkt
 * (PROJEKT.md) und werden hier in drei flachen Abfragen nachgeladen statt in
 * einem verschachtelten Select: die Verknüpfungen laufen über zusammengesetzte
 * Fremdschlüssel, denen PostgREST nicht zuverlässig folgt.
 */
export async function getReceipt(receiptId: string): Promise<Receipt | null> {
  const head = unwrapMaybe(
    await supabase
      .from('receipts')
      .select(RECEIPT_COLUMNS)
      .eq('id', receiptId)
      .maybeSingle(),
  ) as ReceiptRow | null

  if (!head) return null
  return buildReceipt(head)
}

/*
 * Einen Bon mit Status `extracted` gibt es bewusst nicht mehr.
 *
 * PROJEKT.md hatte für 4b-2 vorgesehen, dass die Erkennung schon einen Bon
 * anlegt, den der Korrektur-Screen dann abfragt. Beim Bauen zeigte sich, dass
 * das der schlechtere Weg ist: Ein Bon, den der Nutzer nie bestätigt (Abbruch,
 * Neuladen, „lieber noch mal scannen"), bliebe als Karteileiche liegen und
 * müsste irgendwann aufgeräumt werden. Das Ergebnis reist deshalb weiter im
 * Speicher (`src/lib/scanResult.ts`), und geschrieben wird genau einmal: beim
 * Speichern, vollständig, über `save_receipt`.
 */

/**
 * Kategorie, Merkmale und Milch-Eigenschaften zu einer Menge von Produkten.
 *
 * Zwei flache Abfragen statt eines verschachtelten Selects — die Verknüpfungen
 * laufen über zusammengesetzte Fremdschlüssel, denen PostgREST nicht
 * zuverlässig folgt. Geteilt zwischen der Anzeige eines Bons und dem Laden zum
 * Bearbeiten: Beide brauchen dasselbe, und zwei Fassungen wären zwei
 * Wahrheiten.
 */
async function loadProductFacts(productIds: string[]): Promise<{
  productById: Map<string, ProductRow>
  traitsByProduct: Map<string, string[]>
}> {
  if (productIds.length === 0) {
    return { productById: new Map(), traitsByProduct: new Map() }
  }

  const [productRows, traitLinks] = await Promise.all([
    supabase
      .from('canonical_products')
      .select('id, category_key, milk_heat, milk_homogenized')
      .in('id', productIds)
      .then((r) => unwrap<ProductRow[]>(r)),
    supabase
      .from('canonical_product_traits')
      .select('canonical_product_id, trait_id')
      .in('canonical_product_id', productIds)
      .then((r) => unwrap<Array<{ canonical_product_id: string; trait_id: string }>>(r)),
  ])

  const { traitKeyByUuid } = reference()
  const traitsByProduct = new Map<string, string[]>()
  for (const link of traitLinks) {
    const key = traitKeyByUuid[link.trait_id]
    // Ein Merkmal, das es nicht mehr gibt, wird übergangen statt geraten.
    if (!key) continue
    const list = traitsByProduct.get(link.canonical_product_id) ?? []
    list.push(key)
    traitsByProduct.set(link.canonical_product_id, list)
  }

  return { productById: new Map(productRows.map((row) => [row.id, row])), traitsByProduct }
}

async function buildReceipt(head: ReceiptRow): Promise<Receipt> {
  const itemRows = unwrap<ItemRow[]>(
    await supabase
      .from('receipt_items')
      .select('id, line_no, name, total_cents, quantity_base, quantity_unit, unit_price_cents, canonical_product_id')
      .eq('receipt_id', head.id)
      .order('line_no'),
  )

  const productIds = [...new Set(itemRows.map((i) => i.canonical_product_id).filter(isString))]
  const { productById, traitsByProduct } = await loadProductFacts(productIds)

  const items: ReceiptItem[] = itemRows.map((row) => {
    const product = row.canonical_product_id ? productById.get(row.canonical_product_id) : undefined
    return {
      id: row.id,
      name: row.name,
      /*
       * Ohne Produktzuordnung ist die Kategorie offen. Bis Schritt 5 stand
       * hier `staples` als Platzhalter — das war eine Behauptung: Der Chip in
       * der Positionsliste zeigte „Grundnahrungsmittel", obwohl niemand das
       * entschieden hatte. Jetzt steht dort, was zutrifft. Die Positionsliste
       * zeigt einen unbekannten Schlüssel unverändert an.
       */
      categoryId: (product?.category_key ?? 'Kategorie offen') as CategoryId,
      quantity: toQuantity(row),
      totalCents: row.total_cents,
      traitIds: row.canonical_product_id
        ? (traitsByProduct.get(row.canonical_product_id) ?? [])
        : [],
      ...(product && product.milk_heat !== 'unbekannt'
        ? { milkHeat: product.milk_heat as ReceiptItem['milkHeat'] }
        : {}),
      ...(product && product.milk_homogenized !== 'unbekannt'
        ? { milkHomogenized: product.milk_homogenized as ReceiptItem['milkHomogenized'] }
        : {}),
    }
  })

  return {
    id: head.id,
    merchantId: head.merchant_id ?? '',
    date: head.purchased_on,
    printedTotalCents: head.printed_total_cents,
    tipCents: head.tip_cents,
    currency: head.currency,
    originalTotalCents: head.original_total_cents,
    // `numeric` kommt über PostgREST als Zeichenkette an — sonst verlöre eine
    // Zahl mit sechs Nachkommastellen unterwegs an Genauigkeit.
    exchangeRate: head.exchange_rate === null ? null : Number(head.exchange_rate),
    rateDate: head.rate_date,
    items,
  }
}

function isString(value: string | null): value is string {
  return value !== null
}

/* ------------------------------------------------ Einen Bon zum Bearbeiten */

/**
 * Ein gespeicherter Bon in der Form, mit der der Korrektur-Screen arbeitet.
 *
 * Das ist die ganze Zutat für „Bearbeiten": Der Screen bringt seine
 * Bearbeitungslogik längst mit (`src/lib/draft.ts`), es fehlte nur der Weg
 * zurück aus der Datenbank — und ein Speichern, das aktualisiert statt anlegt.
 *
 * **Die Beträge stehen in Euro**, so wie sie gespeichert sind. Bei einem
 * Fremdwährungsbon wird ausdrücklich nicht zurückgerechnet: Ein Rundgang Euro →
 * Franken → Euro verschöbe bei jedem Bearbeiten einzelne Zeilen um einen Cent,
 * ohne dass jemand etwas geändert hätte.
 */
export interface ReceiptDraftData {
  receiptId: string
  merchantName: string | null
  merchantKind: MerchantKind
  purchasedOn: string
  /** In Euro-Cent. */
  printedTotalCents: number
  tipCents: number
  currency: string
  /** Der Betrag in der Bonwährung. Null bei einem Euro-Bon. */
  originalTotalCents: number | null
  exchangeRate: number | null
  rateDate: string | null
  /**
   * Die Steuerkennzeichen, die an den Positionen stehen.
   *
   * Der gedruckte Steuerblock wird nicht gespeichert — er beschreibt einen
   * Zeitpunkt der Erkennung, nicht den Bon. Zur Auswahl stehen deshalb die
   * Kennzeichen, die tatsächlich vorkommen; damit lässt sich eine Zeile
   * umhängen, aber kein Klassenabgleich mehr rechnen.
   */
  taxCodes: string[]
  items: SavedItem[]
}

interface DraftHeadRow {
  id: string
  merchant_id: string | null
  purchased_on: string
  printed_total_cents: number
  tip_cents: number
  currency: string
  original_total_cents: number | null
  exchange_rate: number | string | null
  rate_date: string | null
}

interface DraftItemRow {
  raw_text: string
  name: string
  total_cents: number
  discount_cents: number
  deposit_cents: number
  quantity_base: number | null
  quantity_unit: string | null
  unit_price_cents: number | null
  tax_code: string | null
  canonical_product_id: string | null
}

export async function getReceiptDraft(receiptId: string): Promise<ReceiptDraftData | null> {
  const head = unwrapMaybe(
    await supabase
      .from('receipts')
      .select('id, merchant_id, purchased_on, printed_total_cents, tip_cents, currency, original_total_cents, exchange_rate, rate_date')
      .eq('id', receiptId)
      .maybeSingle(),
  ) as DraftHeadRow | null

  if (!head) return null

  const itemRows = unwrap<DraftItemRow[]>(
    await supabase
      .from('receipt_items')
      .select('raw_text, name, total_cents, discount_cents, deposit_cents, quantity_base, quantity_unit, unit_price_cents, tax_code, canonical_product_id')
      .eq('receipt_id', head.id)
      .order('line_no'),
  )

  const productIds = [...new Set(itemRows.map((row) => row.canonical_product_id).filter(isString))]
  const { productById, traitsByProduct } = await loadProductFacts(productIds)

  /*
   * Der Händler kommt aus dem Zwischenlager und nicht aus einer weiteren
   * Abfrage — dort liegt er ohnehin, samt seiner Art. Nachgeschlagen wird hier
   * und nicht über `./index`, weil das eine Ringabhängigkeit ergäbe.
   */
  const merchant = head.merchant_id
    ? reference().merchants.find((entry) => entry.id === head.merchant_id)
    : undefined

  const items: SavedItem[] = itemRows.map((row) => {
    const product = row.canonical_product_id ? productById.get(row.canonical_product_id) : undefined
    return {
      rawText: row.raw_text,
      name: row.name,
      categoryKey: (product?.category_key ?? null) as CategoryId | null,
      traitKeys: row.canonical_product_id
        ? (traitsByProduct.get(row.canonical_product_id) ?? [])
        : [],
      milkHeat: (product?.milk_heat ?? 'unbekannt') as SavedItem['milkHeat'],
      milkHomogenized: (product?.milk_homogenized ?? 'unbekannt') as SavedItem['milkHomogenized'],
      quantityBase: row.quantity_base,
      quantityUnit: row.quantity_unit as SavedItem['quantityUnit'],
      unitPriceCents: row.unit_price_cents,
      totalCents: row.total_cents,
      discountCents: row.discount_cents,
      depositCents: row.deposit_cents,
      taxCode: row.tax_code,
      canonicalProductId: row.canonical_product_id,
    }
  })

  return {
    receiptId: head.id,
    merchantName: merchant?.name ?? null,
    merchantKind: merchant?.kind ?? 'retail',
    purchasedOn: head.purchased_on,
    printedTotalCents: head.printed_total_cents,
    tipCents: head.tip_cents,
    currency: head.currency,
    originalTotalCents: head.original_total_cents,
    // `numeric` kommt über PostgREST als Zeichenkette an — sonst verlöre eine
    // Zahl mit sechs Nachkommastellen unterwegs an Genauigkeit.
    exchangeRate: head.exchange_rate === null ? null : Number(head.exchange_rate),
    rateDate: head.rate_date,
    taxCodes: [...new Set(itemRows.map((row) => row.tax_code).filter(isString))].sort(),
    items,
  }
}

/* ============================================================ Einstellungen */

/** Das Budget des laufenden Monats, oder das zuletzt gesetzte. 0 = keines. */
export async function getMonthlyBudgetCents(): Promise<number> {
  const row = unwrapMaybe(
    await supabase
      .from('v_current_month_summary')
      .select('budget_cents')
      .maybeSingle(),
  ) as { budget_cents: number } | null
  return row?.budget_cents ?? 0
}

/**
 * Speichert das Monatsbudget — ab jetzt in `budgets`, nicht mehr im Browser.
 *
 * Geschrieben wird immer auf den laufenden Monat. Eine bereits vorhandene Zeile
 * wird ersetzt; dafür sorgt der eindeutige Schlüssel (household_id, month).
 */
export async function saveMonthlyBudgetCents(amountCents: number): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new DataError('Das Budget muss eine ganze Zahl in Cent sein.')
  }

  const { error } = await supabase.from('budgets').upsert(
    {
      household_id: reference().householdId,
      month: currentMonthStart(),
      amount_cents: amountCents,
    },
    { onConflict: 'household_id,month' },
  )

  if (error) {
    throw new DataError('Das Budget konnte nicht gespeichert werden. Bitte noch einmal versuchen.')
  }
}
