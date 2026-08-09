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

/**
 * `retail` oder `gastro`. Die Art hängt am Händler und nicht am Beleg: Einmal
 * gesetzt, gilt sie für alle künftigen Bons desselben Ladens
 * (KONZEPT-ERWEITERUNGEN.md, Abschnitt 1).
 */
export type MerchantKind = 'retail' | 'gastro'

export interface Merchant {
  id: MerchantId
  name: string
  kind: MerchantKind
}

/**
 * Der stabile Schlüssel einer Kategorie.
 *
 * Bis Schritt 5 war das eine feste Aufzählung der neun mitgelieferten
 * Kategorien. Seitdem legt der Nutzer eigene an, und der Schlüssel entsteht beim
 * Anlegen aus dem Namen (`category_key()` in der Datenbank). Eine Aufzählung im
 * Code wäre damit eine zweite Wahrheit, die schon beim ersten selbst angelegten
 * „gewuerze" auseinanderliefe — dieselbe Begründung wie bei den Merkmalen
 * (PROJEKT.md: „Merkmale sind Daten, nicht Code").
 *
 * Der Alias bleibt trotzdem stehen: Er sagt an jeder Fundstelle, dass hier ein
 * Kategorieschlüssel gemeint ist und nicht irgendein Text.
 */
export type CategoryId = string

export interface Category {
  id: CategoryId
  name: string
  /** Non-food is charted in a neutral tone; food categories share a green ramp. */
  isFood: boolean
  /** Kurze Erklärung. **Geht als Anweisung an das Modell**, wie bei Merkmalen. */
  description: string
  /** Aus statt gelöscht: Produkte verweisen auf die Kategorie. */
  active: boolean
  /** Hex-Farbe für Ring und Balken, z. B. `#16915c`. Gehört der Kategorie. */
  color: string
  /** Reihenfolge in Auswahl und Auswertung. */
  sortOrder: number
  /** Mitgeliefert oder selbst angelegt. Änderbar sind beide. */
  isDefault: boolean
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
  /**
   * Score weight, −3…+2. Negative is worse, 0 is merely observed. The six
   * values each carry a name (`src/lib/weights.ts`); the number is what gets
   * stored and what `src/lib/score.ts` computes with.
   */
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
  /**
   * Trinkgeld. Bewusst **nicht** in `printedTotalCents` enthalten: Es steht
   * meist gar nicht auf dem Papier, und der Summenabgleich würde es sonst als
   * Abweichung melden.
   */
  tipCents: number
  /**
   * Die Bonwährung. `EUR` im Normalfall — und dann sind die drei Felder darunter
   * null. Bei einem Franken-Bon halten die Cent-Felder oben trotzdem **Euro**;
   * daneben steht, was auf dem Papier stand.
   */
  currency: string
  /** Die gedruckte Summe in der Bonwährung. Null bei einem Euro-Bon. */
  originalTotalCents: number | null
  /** Der beim Speichern eingefrorene Kurs: Originalbetrag × Kurs = Euro. */
  exchangeRate: number | null
  /** Der Stichtag, für den der Kurs galt — bei einem Samstagsbon der Freitag. */
  rateDate: string | null
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
  /** Lebensmittel **ohne** Gastronomie. */
  foodCents: number
  /**
   * Auswärts: alle Positionen von Gastro-Bons plus Trinkgeld. Zusammen mit
   * `foodCents` und `nonFoodCents` ergibt das exakt die Gesamtsumme — keine
   * Position zählt doppelt.
   */
  diningCents: number
  /** Non-Food **ohne** Gastronomie. */
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

/**
 * Die Zeiträume des Ausgabenverlaufs.
 *
 * `custom` ist mit Schritt 19 entfallen: Es zeigte die letzten vierzehn Tage in
 * zwei Balken, hieß „Eigen" und war an nichts anpassbar.
 */
export type RangeId = 'week' | 'month' | 'year'

export interface TrendPoint {
  label: string
  amountCents: number
}

/**
 * Ein Topf des Ausgabenverlaufs, so wie ihn die View `v_spending_trend` liefert:
 * Zeitraum und Summe, aber keine Beschriftung. Ob daraus `Mo`, `1.–7.` oder
 * `Aug` wird, entscheidet die Anzeige (PROJEKT.md: Formatierung nur in der UI).
 */
export interface TrendBucket {
  rangeId: RangeId
  index: number
  /** ISO-Datum, erster Tag des Topfs. */
  start: string
  /** ISO-Datum, letzter Tag des Topfs. */
  end: string
  /** ISO-Kalenderwoche des Topfbeginns. */
  isoWeek: number
  amountCents: number
}

/**
 * Ein Bontext, dem noch ein Produkt fehlt.
 *
 * Gruppiert über den Rohtext: Dieselbe Zeile steht meist auf mehreren Bons, und
 * zugeordnet wird sie einmal für alle (`assign_raw_text`).
 */
export interface UnassignedText {
  /** So stand es auf dem Papier. */
  rawText: string
  /** Der Name, den die Erkennung damals vergeben hat — als Vorschlag im Feld. */
  sampleName: string
  itemCount: number
  amountCents: number
  firstPurchasedOn: string
  lastPurchasedOn: string
}

export interface HealthMonth {
  /** First day of the month, ISO. */
  month: string
  score: number | null
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
}

/* ------------------------------------------------------- aus den SQL-Sichten */

/**
 * Eine Karte auf dem Bestpreise-Screen. Bestpreis, Grundpreis und die
 * Vergleichszeilen sind bereits in der Datenbank ausgerechnet.
 */
export interface ProductPriceOverview {
  id: string
  name: string
  categoryId: CategoryId
  /** €/kg, €/l oder €/Stück in Cent. Null bei Produkten ohne Packungsgröße. */
  basePriceCents: number | null
  baseUnit: string | null
  purchaseCount: number
  /**
   * Bei wie vielen Läden es dieses Produkt schon gab.
   *
   * Entscheidet, ob „Bestpreis" überhaupt das richtige Wort ist: Bei einem
   * einzigen Laden gibt es nichts zu vergleichen, und der Screen sagt dann
   * „Günstigster Preis" statt einen Vergleich zu behaupten, den es nicht gab.
   */
  merchantCount: number
  best: PricePoint
}

/**
 * Wie viel Grundlage überhaupt da ist.
 *
 * Die Auswertungen sagen damit selbst, wie belastbar ihre Zahlen sind — und der
 * Einkaufszettel weiß, ob seine Schwelle (14 Tage, 4 Einkäufe) erreicht ist.
 */
export interface HouseholdStats {
  receiptCount: number
  /** ISO-Datum des ersten Einkaufs, oder null. */
  firstPurchasedOn: string | null
  lastPurchasedOn: string | null
  /** Tage seit dem ersten Einkauf. 0, solange keiner erfasst ist. */
  daySpan: number
  productCount: number
  merchantCount: number
  /**
   * Die Schwelle für den Einkaufszettel — **aus der Datenbank**, nicht aus dem
   * Code. Dieselbe Zahl entscheidet dort, ob überhaupt Vorschläge entstehen;
   * stünde sie zweimal da, zeigte der Balken irgendwann „geschafft", während die
   * Datenbank noch schwiege.
   */
  requiredReceipts: number
  requiredDays: number
  suggestionsReady: boolean
  /**
   * Produkte, die mehrfach gekauft wurden, aber immer im selben Laden. Ihnen
   * fehlt für einen Preisvergleich nur noch der zweite Händler — und genau das
   * sagt der Leerzustand des Sparpotenzials damit.
   */
  singleMerchantProducts: number
}

/**
 * Ein erkannter Kaufrhythmus.
 *
 * Erscheint schon **vor** der Schwelle: „Schon erkannt: H-Milch alle 6 Tage".
 * Der Nutzer sieht damit echte Zwischenergebnisse statt nur einen Balken.
 */
export interface RhythmProduct {
  name: string
  purchaseCount: number
  medianGapDays: number
  daysSinceLast: number
}

/** Ein Eintrag auf dem Einkaufszettel. */
export interface ShoppingItem {
  id: string
  /** Null bei einem eigenen Eintrag ohne bekanntes Produkt. */
  productId: string | null
  label: string
  quantityBase: number | null
  quantityUnit: 'kg' | 'g' | 'l' | 'ml' | 'stk' | null
  /** Der günstigste kürzlich bezahlte Betrag. Null bei eigenen Einträgen. */
  expectedPriceCents: number | null
  source: 'suggestion' | 'manual'
  checked: boolean
  categoryKey: string | null
  categoryName: string
  categorySort: number
  categoryColor: string | null
  /** Die Begründung: „üblich alle 7 Tage". Null bei eigenen Einträgen. */
  medianGapDays: number | null
  daysSinceLast: number | null
  bestMerchantId: string | null
}

export interface ShoppingList {
  listId: string
  items: ShoppingItem[]
  stats: HouseholdStats
  /** Alle erkannten Rhythmen, auch die noch nicht fälligen. */
  rhythms: RhythmProduct[]
}

/** Eine Zeile unter „Häufigste Käufe". */
export interface FrequentProduct {
  name: string
  purchaseCount: number
  amountCents: number
  firstPurchasedOn: string
  lastPurchasedOn: string
}

/** Der Produkt-Detailschirm: Kennzahlen plus die vollständige Kaufhistorie. */
export interface ProductPriceDetail {
  id: string
  name: string
  basePriceCents: number | null
  baseUnit: string | null
  purchaseCount: number
  minCents: number
  maxCents: number
  averageCents: number
  /** ISO-Datum des ersten erfassten Kaufs. */
  firstPurchasedOn: string
  /** Älteste zuerst — so liest sich die Verlaufskurve von links nach rechts. */
  purchases: PricePoint[]
}

/** Eine Zeile unter „Sparpotenzial" auf dem Analysen-Screen. */
export interface SavingsRow {
  productId: string
  productName: string
  cheapest: PricePoint
  /** Der teuerste Kauf im Zeitraum — das anschaulichste Gegenbeispiel. */
  worst: PricePoint
  /** Wie viele Käufe im Zeitraum über dem Bestpreis lagen. */
  overpaidCount: number
  /**
   * Was die Käufe dieses Monats gegenüber dem Bestpreis **wirklich** mehr
   * gekostet haben, in Cent. Seit Schritt 19 die Zeilensumme minus dem, was
   * dieselbe Menge zum Bestpreis gekostet hätte — vorher war es die Differenz
   * der Einzelpreise, also bei zwei Flaschen Milch die Hälfte des Betrags.
   */
  excessCents: number
  /** `kg` oder `l`, wenn die Preise oben Grundpreise sind. Sonst null. */
  baseUnit: string | null
}

/**
 * Ein Monat Tankstelle, wie ihn `v_fuel_months` liefert.
 *
 * `pricePerLitreCents` ist ein **Verhältnis und kein Geldbetrag**: Kosten ÷
 * Liter, mit zwei Nachkommastellen. Sprit ist in Zehntelcent ausgezeichnet, und
 * ganze Cent verlören genau diese Stelle. Der Grundsatz „Geld ist eine ganze
 * Zahl in Cent" gilt weiter — gespeichert wird davon nichts, gerechnet wird bei
 * jedem Aufruf neu, so wie beim Grundpreis auch.
 */
export interface FuelMonth {
  /** Erster Tag des Monats, ISO. */
  month: string
  fillCount: number
  amountCents: number
  /** Ganze Milliliter — Mengen bleiben ganzzahlige Basiseinheiten. */
  millilitres: number
  pricePerLitreCents: number
}

/** Ergebnis der Produktsuche. */
export interface ItemSearchResult {
  purchaseCount: number
  amountCents: number
}

/**
 * Die Produktsuche liefert zwei Zahlen: den laufenden Monat und alles.
 *
 * Mit wenigen Bons ist der laufende Monat oft leer, und „0 Käufe" sieht aus, als
 * hätte die Suche nichts gefunden — obwohl das Produkt im Vormonat dreimal
 * gekauft wurde. Die zweite Zahl beantwortet genau diese Frage.
 */
export interface ItemSearch {
  inMonth: ItemSearchResult
  /** Die letzten zwölf Monate — die Frage „was hat mich das dieses Jahr gekostet". */
  lastYear: ItemSearchResult
  allTime: ItemSearchResult
}
