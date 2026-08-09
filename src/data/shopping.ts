import { supabase } from '../lib/supabase'
import { DataError, unwrap } from './client'
import { reference } from './reference'
import { getHouseholdStats } from './queries'
import type { ExtractedUnit } from '../lib/extraction'
import type { HouseholdStats, RhythmProduct, ShoppingItem, ShoppingList } from '../types'

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
}

const ITEM_COLUMNS =
  'id, list_id, canonical_product_id, label, quantity_base, quantity_unit, expected_price_cents, source, checked, category_key, category_name, category_sort, category_color, median_gap_days, days_since_last, best_merchant_id'

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

/**
 * Die offene Liste, samt allem, was der Screen braucht.
 *
 * `shopping_list_refresh()` legt die Liste an, falls es keine gibt, und trägt
 * fällige Vorschläge ein — aber erst ab der Schwelle. Eigene Einträge sind von
 * Anfang an möglich, deshalb wird die Funktion immer gerufen.
 */
export async function getShoppingList(): Promise<ShoppingList> {
  const { data: listId, error } = await supabase.rpc('shopping_list_refresh')

  if (error || typeof listId !== 'string') {
    throw new DataError(
      'Der Einkaufszettel ist noch nicht eingerichtet. Bitte ' +
        'supabase/migrations/0008_einkaufszettel.sql einmal im SQL-Editor ausführen.',
    )
  }

  const [items, stats, rhythms] = await Promise.all([
    supabase
      .from('v_shopping_list_items')
      .select(ITEM_COLUMNS)
      .eq('list_id', listId)
      .order('created_at')
      .then((r) => unwrap<ItemRow[]>(r)),
    getHouseholdStats(),
    loadRhythms(),
  ])

  return { listId, items: items.map(toItem), stats, rhythms }
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
