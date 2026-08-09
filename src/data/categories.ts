import { supabase } from '../lib/supabase'
import { nextFreeColor, toCategoryKey } from '../lib/category'
import { DataError, germanDataError, unwrap } from './client'
import { reference, refreshCategories } from './reference'
import type { Category } from '../types'

/**
 * Die Kategorieverwaltung — anlegen, ändern, umsortieren, deaktivieren.
 *
 * Die eine Regel, um die sich alles dreht: **Der Schlüssel entsteht beim
 * Anlegen und ist danach unveränderlich.** Der Anzeigename bleibt frei
 * änderbar. Dasselbe Prinzip wie bei den Merkmalen — Anzeigetexte ändern sich,
 * Datenbankwerte nicht. Deshalb gibt es hier zwei getrennte Funktionen und
 * nicht ein `saveCategory`, das mal den Schlüssel mitschreibt und mal nicht.
 *
 * **Gelöscht wird nie.** `canonical_products` verweist über einen
 * Fremdschlüssel auf die Kategorie; ein DELETE würde bestehende Produkte
 * brechen. Eine deaktivierte Kategorie verschwindet aus Auswahl und Prompt,
 * bleibt für Altdaten aber gültig.
 *
 * Nach jeder Änderung wird das Zwischenlager aufgefrischt (`refreshCategories`).
 * Ohne das zeigte die Positionsliste noch die alten Namen und Farben — sie
 * schlägt synchron nach und merkt von einer Datenbankänderung sonst nichts.
 */

const SAVE_FAILED = 'Die Kategorie konnte nicht gespeichert werden. Bitte noch einmal versuchen.'

/** Was beim Anlegen einer Kategorie eingegeben wird. */
export interface NewCategory {
  name: string
  description: string
  isFood: boolean
  color: string
}

/** Was sich an einer bestehenden Kategorie ändern lässt — alles außer dem Schlüssel. */
export interface CategoryEdit {
  name: string
  description: string
  isFood: boolean
  color: string
}

/**
 * Der Schlüssel, den diese Kategorie bekommen würde — und was dagegen spricht.
 *
 * Beides in einer Funktion, weil der Screen beides an derselben Stelle zeigt:
 * unter dem Namensfeld steht entweder „Schlüssel: gewuerze" oder der Grund,
 * warum es so nicht geht. Geprüft wird gegen die Kategorien im Zwischenlager,
 * die eindeutige Bedingung in der Datenbank ist die eigentliche Sicherung.
 */
export function checkNewCategoryName(name: string): { key: string; error: string | null } {
  const key = toCategoryKey(name)

  if (name.trim() === '') {
    return { key, error: null }
  }
  if (key === '') {
    return {
      key,
      error: 'Aus diesem Namen lässt sich kein Schlüssel bilden. Bitte Buchstaben oder Ziffern verwenden.',
    }
  }
  if (reference().categories.some((category) => category.id === key)) {
    return { key, error: `Den Schlüssel „${key}" gibt es schon. Bitte einen anderen Namen wählen.` }
  }
  return { key, error: null }
}

/** Eine noch nicht vergebene Farbe, für das Anlegen-Formular. */
export function suggestCategoryColor(): string {
  return nextFreeColor(reference().categories.map((category) => category.color))
}

/**
 * Legt eine Kategorie an und gibt ihren Schlüssel zurück.
 *
 * Sie wird ans Ende sortiert: Wo sie hingehört, weiß nur der Nutzer, und
 * verschieben ist ein Tipper.
 */
export async function createCategory(input: NewCategory): Promise<string> {
  const { key, error } = checkNewCategoryName(input.name)
  if (key === '' || error !== null) {
    throw new DataError(error ?? 'Bitte einen Namen für die Kategorie eingeben.')
  }

  const maxOrder = reference().categories.reduce(
    (max, category) => Math.max(max, category.sortOrder),
    0,
  )

  const result = await supabase.from('categories').insert({
    household_id: reference().householdId,
    key,
    name: input.name.trim(),
    description: input.description.trim(),
    is_food: input.isFood,
    color: input.color,
    active: true,
    is_default: false,
    sort_order: maxOrder + 1,
  })

  if (result.error) throw new DataError(duplicateOr(result.error, key))
  await refreshCategories()
  return key
}

/** Umbenennen, Erklärung ändern, Umfärben, Lebensmittel ja/nein. */
export async function updateCategory(key: string, input: CategoryEdit): Promise<void> {
  if (input.name.trim() === '') {
    throw new DataError('Der Name darf nicht leer sein.')
  }

  const result = await supabase
    .from('categories')
    .update({
      name: input.name.trim(),
      description: input.description.trim(),
      is_food: input.isFood,
      color: input.color,
    })
    .eq('household_id', reference().householdId)
    .eq('key', key)

  if (result.error) throw new DataError(SAVE_FAILED)
  await refreshCategories()
}

/** Ein- und ausschalten. Gelöscht wird nichts. */
export async function setCategoryActive(key: string, active: boolean): Promise<void> {
  const result = await supabase
    .from('categories')
    .update({ active })
    .eq('household_id', reference().householdId)
    .eq('key', key)

  if (result.error) throw new DataError(SAVE_FAILED)
  await refreshCategories()
}

/**
 * Verschiebt eine Kategorie um eine Position nach oben oder unten.
 *
 * Geschrieben wird die **ganze** neue Reihenfolge und nicht nur die beiden
 * getauschten Zeilen. Grund: Die mitgelieferten Kategorien tragen 1…9, eine
 * selbst angelegte bekommt die nächste freie Zahl — nach ein paar Änderungen
 * sind darin Lücken und Dubletten. Einmal durchnummerieren ist ein Schreibvorgang
 * mehr und dafür ein Zustand, über den man nicht nachdenken muss.
 */
export async function moveCategory(key: string, direction: -1 | 1): Promise<void> {
  const ordered = [...reference().categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const index = ordered.findIndex((category) => category.id === key)
  const target = index + direction

  // Am Rand der Liste passiert nichts — der Screen blendet die Pfeile dort aus,
  // aber verlassen sollte man sich darauf nicht.
  if (index === -1 || target < 0 || target >= ordered.length) return

  const moved = [...ordered]
  ;[moved[index], moved[target]] = [moved[target], moved[index]]

  const result = await supabase.from('categories').upsert(
    moved.map((category, position) => ({
      household_id: reference().householdId,
      key: category.id,
      // `upsert` schreibt eine ganze Zeile: Ohne die übrigen Felder würden sie
      // auf ihre Standardwerte zurückfallen und Name und Farbe wären weg.
      name: category.name,
      description: category.description,
      is_food: category.isFood,
      color: category.color,
      active: category.active,
      is_default: category.isDefault,
      sort_order: position + 1,
    })),
    { onConflict: 'household_id,key' },
  )

  if (result.error) throw new DataError(SAVE_FAILED)
  await refreshCategories()
}

/**
 * Wie viele kanonische Produkte auf jede Kategorie zeigen.
 *
 * Die Zahl steht beim Deaktivieren daneben: „12 Produkte behalten diese
 * Kategorie." Eine Sicht statt einer Zählabfrage je Kategorie — bei zwölf
 * Kategorien wären das sonst zwölf Anfragen für eine Zeile Text.
 */
export async function getCategoryProductCounts(): Promise<Record<string, number>> {
  const rows = unwrap<Array<{ category_key: string; product_count: number }>>(
    await supabase.from('v_category_product_counts').select('category_key, product_count'),
  )
  return Object.fromEntries(rows.map((row) => [row.category_key, row.product_count]))
}

/**
 * Der eindeutige Schlüssel ist die einzige Bedingung, die ein Nutzer im Alltag
 * auslöst — und der einzige Fehler, zu dem sich etwas Nützliches sagen lässt.
 */
function duplicateOr(error: { code?: string; message?: string }, key: string): string {
  if (error.code === '23505') {
    return `Den Schlüssel „${key}" gibt es schon. Bitte einen anderen Namen wählen.`
  }
  const reason = germanDataError(error)
  return reason.startsWith('Die Daten konnten nicht') ? SAVE_FAILED : reason
}

/** Nur zum Sortieren in den Einstellungen — die Anzeige will jede Kategorie sehen. */
export function sortedCategories(): Category[] {
  return [...reference().categories].sort((a, b) => a.sortOrder - b.sortOrder)
}
