import { supabase } from '../lib/supabase'
import { DataError, unwrap, unwrapMaybe } from './client'
import type { Category, CategoryId, Merchant, Trait } from '../types'

/**
 * Stammdaten des Haushalts: Kategorien, Merkmale, Händler.
 *
 * Diese drei ändern sich fast nie, werden aber überall gebraucht — die
 * Positionsliste schlägt für jede Zeile eine Kategorie und mehrere Merkmale
 * nach, die Bestpreise einen Händlernamen. Würde jede dieser Stellen selbst
 * laden, hätte jede Komponente einen Ladezustand.
 *
 * Deshalb: einmal laden, in ein Modul-Zwischenlager legen, und die Nachschlage-
 * Funktionen bleiben synchron. Dass das Lager gefüllt ist, garantiert
 * `<DataGate>` in App.tsx — es lässt keinen angemeldeten Screen los, bevor
 * `loadReference()` durch ist.
 */

export interface Reference {
  householdId: string
  categories: Category[]
  traits: Trait[]
  merchants: Merchant[]
  /**
   * uuid des Merkmals → Schlüssel. Die Verknüpfungstabelle
   * `canonical_product_traits` zeigt auf uuids, die Fachlogik rechnet mit
   * Schlüsseln — hier wird übersetzt.
   */
  traitKeyByUuid: Record<string, string>
}

interface CategoryRow {
  key: string
  name: string
  is_food: boolean
  sort_order: number
}

interface TraitRow {
  id: string
  key: string
  label: string
  short: string
  description: string
  weight: number
  trait_group: string | null
  tip: string
  active: boolean
  is_default: boolean
  sort_order: number
}

interface MerchantRow {
  id: string
  name: string
}

let cache: Reference | null = null

/**
 * Aus der Merkmalszeile wird ein `Trait`.
 *
 * Die fachliche id ist der **Schlüssel**, nicht die uuid: `score.ts` leitet aus
 * `milkHeat: 'uht'` das Merkmal `uht` ab, und die Sichten geben ebenfalls
 * Schlüssel zurück. Eine uuid an dieser Stelle würde beide Wege brechen.
 *
 * `trait_group` ist in der Datenbank nullable, im Typ dagegen `string |
 * undefined` — die Gruppenregel prüft auf `undefined`.
 */
export function toTrait(row: TraitRow): Trait {
  return {
    id: row.key,
    label: row.label,
    short: row.short,
    description: row.description,
    weight: row.weight,
    ...(row.trait_group === null ? {} : { group: row.trait_group }),
    tip: row.tip,
    active: row.active,
    isDefault: row.is_default,
  }
}

async function loadHouseholdId(): Promise<string> {
  const row = unwrapMaybe(
    await supabase.from('household_members').select('household_id').limit(1).maybeSingle(),
  )
  if (!row) {
    throw new DataError(
      'Zu diesem Konto gehört noch kein Haushalt. Melde dich einmal ab und wieder an — ' +
        'beim ersten Login legt die Datenbank ihn selbst an.',
    )
  }
  return (row as { household_id: string }).household_id
}

/** Lädt die Stammdaten und füllt das Zwischenlager. */
export async function loadReference(): Promise<Reference> {
  const [householdId, categoryRows, traitRows, merchantRows] = await Promise.all([
    loadHouseholdId(),
    supabase
      .from('categories')
      .select('key, name, is_food, sort_order')
      .order('sort_order')
      .then((r) => unwrap<CategoryRow[]>(r)),
    supabase
      .from('traits')
      .select(
        'id, key, label, short, description, weight, trait_group, tip, active, is_default, sort_order',
      )
      .order('sort_order')
      .then((r) => unwrap<TraitRow[]>(r)),
    supabase
      .from('merchants')
      .select('id, name')
      .order('name')
      .then((r) => unwrap<MerchantRow[]>(r)),
  ])

  cache = {
    householdId,
    categories: categoryRows.map((row) => ({
      id: row.key as CategoryId,
      name: row.name,
      isFood: row.is_food,
    })),
    traits: traitRows.map(toTrait),
    merchants: merchantRows.map((row) => ({ id: row.id, name: row.name })),
    traitKeyByUuid: Object.fromEntries(traitRows.map((row) => [row.id, row.key])),
  }
  return cache
}

/**
 * Die geladenen Stammdaten. Wirft, wenn noch nichts geladen ist — das wäre ein
 * Programmierfehler (ein Screen außerhalb von `<DataGate>`), kein Zustand, den
 * der Nutzer je sehen soll.
 */
export function reference(): Reference {
  if (!cache) throw new Error('Stammdaten sind noch nicht geladen — fehlt <DataGate>?')
  return cache
}

/** Beim Abmelden, damit der nächste Nutzer nicht die Merkmale des vorigen sieht. */
export function clearReference(): void {
  cache = null
}

/** Neue Händler entstehen beim Scannen; danach muss die Liste stimmen. */
export async function refreshMerchants(): Promise<void> {
  if (!cache) return
  const rows = unwrap<MerchantRow[]>(
    await supabase.from('merchants').select('id, name').order('name'),
  )
  cache = { ...cache, merchants: rows.map((row) => ({ id: row.id, name: row.name })) }
}
