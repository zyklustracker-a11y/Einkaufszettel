import { supabase } from '../lib/supabase'
import { DataError, germanDataError, unwrap } from './client'
import { reference } from './reference'
import { getHouseholdStats } from './queries'
import type { ExtractedUnit } from '../lib/extraction'
import type {
  BasketMerchant,
  HouseholdStats,
  RhythmProduct,
  ShoppingItem,
  ShoppingList,
} from '../types'

/**
 * Der Einkaufszettel.
 *
 * Die ganze Rechenarbeit steckt in `supabase/migrations/0008_einkaufszettel.sql`
 * — Kaufrhythmus, Streuung, Fälligkeit und übliche Menge sind Median und
 * Quartilsabstand über Kauftage, also genau die Sorte Regel, die laut PROJEKT.md
 * in die Datenbank gehört und nicht in ein Modell.
 *
 * Hier bleibt: die Liste holen, Einträge abhaken, ergänzen, wegwischen und den
 * Einkauf abschließen.
 */

const SAVE_FAILED = 'Der Einkaufszettel konnte nicht geändert werden. Bitte noch einmal versuchen.'

interface ItemRow {
  id: string
  list_id: string
  canonical_product_id: string | null
  label: string
  quantity_base: number | null
  quantity_unit: string | null
  expected_price_cents: number | null
  source: string
  checked: boolean
  category_key: string | null
  category_name: string
  category_sort: number
  category_color: string | null
  median_gap_days: number | null
  days_since_last: number | null
  best_merchant_id: string | null
  best_price_cents: number | null
  best_seen_on: string | null
}

const ITEM_COLUMNS =
  'id, list_id, canonical_product_id, label, quantity_base, quantity_unit, expected_price_cents, source, checked, category_key, category_name, category_sort, category_color, median_gap_days, days_since_last, best_merchant_id, best_price_cents, best_seen_on'

function toItem(row: ItemRow): ShoppingItem {
  return {
    id: row.id,
    productId: row.canonical_product_id,
    label: row.label,
    quantityBase: row.quantity_base,
    quantityUnit: row.quantity_unit as ExtractedUnit | null,
    expectedPriceCents: row.expected_price_cents,
    source: row.source === 'suggestion' ? 'suggestion' : 'manual',
    checked: row.checked,
    categoryKey: row.category_key,
    categoryName: row.category_name,
    categorySort: row.category_sort,
    categoryColor: row.category_color,
    medianGapDays: row.median_gap_days,
    daysSinceLast: row.days_since_last,
    bestMerchantId: row.best_merchant_id,
    bestPriceCents: row.best_price_cents,
    bestSeenOn: row.best_seen_on,
  }
}

interface RhythmRow {
  product_name: string
  purchase_count: number
  median_gap_days: number
  days_since_last: number
}

/**
 * Was die App über die Kaufrhythmen schon weiß — auch **vor** der Schwelle.
 *
 * Das ist die wichtigste Zeile des Fortschritts-Zustands: „Schon erkannt:
 * H-Milch alle 6 Tage · Bananen alle 8 Tage". Der Nutzer sieht damit echte
 * Zwischenergebnisse statt nur einen Balken (KONZEPT-ERWEITERUNGEN.md,
 * Abschnitt 6).
 */
async function loadRhythms(): Promise<RhythmProduct[]> {
  const { data, error } = await supabase
    .from('v_product_rhythm')
    .select('product_name, purchase_count, median_gap_days, days_since_last')
    .order('median_gap_days')

  // Fehlt die Migration, gibt es eben noch nichts zu zeigen.
  if (error || !data) return []

  return (data as unknown as RhythmRow[]).map((row) => ({
    name: row.product_name,
    purchaseCount: row.purchase_count,
    medianGapDays: row.median_gap_days,
    daysSinceLast: row.days_since_last,
  }))
}

interface BasketRow {
  merchant_id: string
  covered_items: number
  missing_items: number
  basket_total_cents: number
  optimum_total_cents: number
  optimum_merchant_count: number
  priced_items: number
}

/**
 * Was der Zettel in jedem einzelnen Laden kostet.
 *
 * Gerechnet wird in `0017_ladenwahl.sql`. Hier steht nur das Abholen — und die
 * Nachsicht: Fehlt die Sicht (die Migration ist noch nicht gelaufen), gibt es
 * eben keine Ladenempfehlung. Der Zettel selbst funktioniert ohne sie
 * weiter, und dafür soll er nicht mit einer Fehlermeldung stehen bleiben.
 */
async function loadBasket(): Promise<BasketMerchant[]> {
  const { data, error } = await supabase
    .from('v_shopping_basket_merchants')
    .select(
      'merchant_id, covered_items, missing_items, basket_total_cents, optimum_total_cents, optimum_merchant_count, priced_items',
    )
    .order('basket_total_cents')

  if (error || !data) return []

  return (data as unknown as BasketRow[]).map((row) => ({
    merchantId: row.merchant_id,
    coveredItems: row.covered_items,
    missingItems: row.missing_items,
    basketTotalCents: row.basket_total_cents,
    optimumTotalCents: row.optimum_total_cents,
    optimumMerchantCount: row.optimum_merchant_count,
    pricedItems: row.priced_items,
  }))
}

/**
 * Die offene Liste, samt allem, was der Screen braucht.
 *
 * `shopping_list_refresh()` legt die Liste an, falls es keine gibt, und trägt
 * fällige Vorschläge ein — aber erst ab der Schwelle. Eigene Einträge sind von
 * Anfang an möglich, deshalb wird die Funktion immer gerufen.
 */
export async function getShoppingList(): Promise<ShoppingList> {
  const { data: listId, error } = await supabase.rpc('shopping_list_refresh')

  /*
   * Zwei verschiedene Lagen, zwei verschiedene Sätze.
   *
   * Bis Schritt 19 wurde **jeder** Fehler zu „Bitte 0008_einkaufszettel.sql
   * ausführen" — auch ein Funkloch im Laden. Die Meldung schickte damit in den
   * SQL-Editor, wo nichts zu holen ist. Nur wenn die Funktion selbst fehlt
   * (42883) oder eine Relation dahinter (42P01), ist die Migration wirklich der
   * Grund; alles andere übersetzt `germanDataError` passend.
   */
  if (error) {
    const code = typeof error.code === 'string' ? error.code : ''
    if (code === '42883' || code === '42P01') {
      throw new DataError(
        'Der Einkaufszettel ist noch nicht eingerichtet. Bitte ' +
          'supabase/migrations/0008_einkaufszettel.sql einmal im SQL-Editor ausführen.',
      )
    }
    throw new DataError(germanDataError(error))
  }

  if (typeof listId !== 'string') {
    throw new DataError(
      'Der Einkaufszettel konnte nicht geöffnet werden. Bitte versuch es noch einmal.',
    )
  }

  const [items, stats, rhythms, merchants] = await Promise.all([
    loadItems(listId),
    getHouseholdStats(),
    loadRhythms(),
    loadBasket(),
  ])

  return { listId, items: items.map(toItem), stats, rhythms, merchants }
}

/**
 * Die Einträge selbst — und die einzige Stelle, an der eine fehlende Migration
 * wirklich weh tut.
 *
 * `ITEM_COLUMNS` nennt seit Schritt 20 zwei Spalten, die es vor
 * `0017_ladenwahl.sql` nicht gibt. Postgres antwortet darauf mit 42703
 * („column does not exist"), und `germanDataError` machte daraus bisher „Die
 * Daten konnten nicht geladen werden" — ein Satz, der in den Neustart schickt
 * statt in den SQL-Editor.
 */
async function loadItems(listId: string): Promise<ItemRow[]> {
  const result = await supabase
    .from('v_shopping_list_items')
    .select(ITEM_COLUMNS)
    .eq('list_id', listId)
    .order('created_at')

  if (result.error?.code === '42703') {
    throw new DataError(
      'Der Einkaufszettel kennt den günstigsten Laden noch nicht. Bitte ' +
        'supabase/migrations/0017_ladenwahl.sql einmal im SQL-Editor ausführen.',
    )
  }

  return unwrap<ItemRow[]>(result)
}

/**
 * Wie weit der offene Zettel abgehakt ist.
 *
 * `save_receipt` hakt die gekauften Produkte selbst ab — in derselben
 * Transaktion, in der der Bon entsteht (PROJEKT.md, Schritt 9). Nur sah man das
 * bisher nirgends: Die gebaute Funktion war unbemerkbar. Diese Abfrage schließt
 * den Kreis, den das Konzept beschreibt („5 von 7 erledigt"), ohne dass dafür
 * am Schreibweg etwas geändert werden müsste.
 *
 * Sie darf scheitern, ohne dass jemand etwas merkt: Es ist eine Zusatzauskunft
 * nach einem bereits gespeicherten Bon, und ein Fehler hier dürfte den
 * Speichern-Erfolg nicht in Frage stellen.
 */
export async function getShoppingProgress(): Promise<{ done: number; total: number } | null> {
  try {
    const { data: listId } = await supabase.rpc('shopping_list_refresh')
    if (typeof listId !== 'string') return null

    const rows = unwrap<Array<{ checked: boolean }>>(
      await supabase.from('v_shopping_list_items').select('checked').eq('list_id', listId),
    )
    if (rows.length === 0) return null
    return { done: rows.filter((row) => row.checked).length, total: rows.length }
  } catch {
    return null
  }
}

/** Abhaken und wieder öffnen. */
export async function setShoppingItemChecked(itemId: string, checked: boolean): Promise<void> {
  const { error } = await supabase
    .from('shopping_list_items')
    .update({ checked_at: checked ? new Date().toISOString() : null })
    .eq('id', itemId)

  if (error) throw new DataError(SAVE_FAILED)
}

/**
 * Einen Eintrag wegwischen.
 *
 * **Gelöscht wird nicht.** `removed_at` bleibt stehen, damit derselbe Vorschlag
 * nicht beim nächsten Öffnen wieder dasteht — „ein entfernter Vorschlag kommt in
 * diesem Durchgang nicht wieder" (KONZEPT-ERWEITERUNGEN.md). Mit dem
 * abgeschlossenen Einkauf ist die Erinnerung ohnehin vorbei.
 */
export async function removeShoppingItem(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('shopping_list_items')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', itemId)

  if (error) throw new DataError(SAVE_FAILED)
}

/** Menge ändern. Leere Menge heißt „ohne Angabe" — ein echter Zustand. */
export async function setShoppingItemQuantity(
  itemId: string,
  quantityBase: number | null,
  quantityUnit: ExtractedUnit | null,
): Promise<void> {
  const valid = quantityBase !== null && quantityBase > 0 && quantityUnit !== null
  const { error } = await supabase
    .from('shopping_list_items')
    .update({
      quantity_base: valid ? quantityBase : null,
      quantity_unit: valid ? quantityUnit : null,
    })
    .eq('id', itemId)

  if (error) throw new DataError(SAVE_FAILED)
}

/**
 * Einen eigenen Eintrag ergänzen — auch freien Text ohne bekanntes Produkt.
 *
 * „Blumen für Oma" hat kein kanonisches Produkt und soll trotzdem auf den
 * Zettel dürfen.
 */
export async function addShoppingItem(listId: string, label: string): Promise<void> {
  const text = label.trim()
  if (text === '') throw new DataError('Bitte etwas eintragen.')

  const { error } = await supabase.from('shopping_list_items').insert({
    household_id: reference().householdId,
    list_id: listId,
    label: text,
    source: 'manual',
  })

  if (error) throw new DataError(SAVE_FAILED)
}

/**
 * Der Einkauf ist erledigt.
 *
 * Die Liste bleibt stehen und wird nur geschlossen; beim nächsten Öffnen
 * entsteht eine neue. Damit ist auch die Erinnerung an weggewischte Vorschläge
 * vorbei — sie galt für **diesen** Durchgang.
 */
export async function completeShoppingList(listId: string): Promise<void> {
  const { error } = await supabase
    .from('shopping_lists')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', listId)

  if (error) throw new DataError(SAVE_FAILED)
}

export type { HouseholdStats }
