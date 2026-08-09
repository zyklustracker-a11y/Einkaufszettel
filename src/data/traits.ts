import { supabase } from '../lib/supabase'
import { toStableKey } from '../lib/category'
import { DataError, germanDataError, unwrap } from './client'
import { reference, refreshTraits } from './reference'
import type { Trait } from '../types'

/**
 * Die Merkmalsverwaltung — anlegen, umbenennen, gewichten, gruppieren,
 * abschalten.
 *
 * Aufgebaut wie `categories.ts` daneben, und aus denselben Gründen:
 *
 *   * **Der Schlüssel entsteht beim Anlegen aus dem Namen und ist danach
 *     unveränderlich.** Er steht im Erkennungs-Prompt und in
 *     `canonical_product_traits`; ein wandernder Schlüssel würde beides
 *     brechen. Der Anzeigename bleibt frei änderbar (PROJEKT.md: Anzeigetexte
 *     ändern sich, Datenbankwerte nicht).
 *   * **Gelöscht wird nie.** Produkte hängen über einen Fremdschlüssel am
 *     Merkmal. Ein abgeschaltetes verschwindet aus Prompt, Auswahl und
 *     Auswertung, bleibt für Altdaten aber gültig.
 *
 * **Eine Gewichtsänderung wirkt rückwirkend, ohne dass hier etwas passiert.**
 * Der Score ist nirgends gespeichert: `v_score_items` liefert die Zutaten,
 * `src/lib/score.ts` rechnet bei jeder Anzeige neu — mit den Gewichten, die in
 * diesem Moment gelten. Nach dem Schreiben muss deshalb nur das Zwischenlager
 * auffrischen, und die Verlaufskurve steht sofort richtig da.
 */

const SAVE_FAILED = 'Das Merkmal konnte nicht gespeichert werden. Bitte noch einmal versuchen.'

/** Was beim Anlegen eines Merkmals eingegeben wird. */
export interface NewTrait {
  label: string
  short: string
  description: string
  tip: string
  weight: number
  /** Leer heißt „ohne Gruppe" — dann zählt das Merkmal im Score einzeln. */
  group: string
}

/** Was sich später ändern lässt: alles außer dem Schlüssel. */
export type TraitEdit = NewTrait

/**
 * Der Schlüssel, den dieses Merkmal bekäme — und was dagegen spricht.
 *
 * Beides in einer Funktion, weil der Screen beides an derselben Stelle zeigt.
 * Geprüft wird gegen das Zwischenlager; die eindeutige Bedingung in der
 * Datenbank ist die eigentliche Sicherung.
 */
export function checkNewTraitName(label: string): { key: string; error: string | null } {
  const key = toStableKey(label)

  if (label.trim() === '') return { key, error: null }
  if (key === '') {
    return {
      key,
      error:
        'Aus diesem Namen lässt sich kein Schlüssel bilden. Bitte Buchstaben oder Ziffern verwenden.',
    }
  }
  if (reference().traits.some((trait) => trait.id === key)) {
    return { key, error: `Den Schlüssel „${key}" gibt es schon. Bitte einen anderen Namen wählen.` }
  }
  return { key, error: null }
}

/** Die Gruppen, die es schon gibt — zur Auswahl statt zum Abtippen. */
export function existingTraitGroups(): string[] {
  const groups = new Set<string>()
  for (const trait of reference().traits) {
    if (trait.group) groups.add(trait.group)
  }
  return [...groups].sort()
}

/**
 * Das Kürzel, so wie das Badge es zeigt.
 *
 * Ein bis zwei Zeichen — mehr sprengt die Zeile in der Positionsliste, und
 * genau dafür ist es da. Erzwungen wird die Länge auch von der Datenbank.
 */
function normalizeShort(short: string, label: string): string {
  const trimmed = short.trim()
  if (trimmed !== '') return trimmed.slice(0, 2)
  // Ohne Eingabe der erste Buchstabe des Namens: besser als ein leeres Badge,
  // und der Nutzer kann es jederzeit ändern.
  const fallback = label.trim().charAt(0).toUpperCase()
  return fallback === '' ? '?' : fallback
}

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0
  return Math.max(-10, Math.min(10, Math.round(weight)))
}

export async function createTrait(input: NewTrait): Promise<string> {
  const { key, error } = checkNewTraitName(input.label)
  if (key === '' || error !== null) {
    throw new DataError(error ?? 'Bitte einen Namen für das Merkmal eingeben.')
  }

  const maxOrder = reference().traits.reduce(
    (max, _trait, index) => Math.max(max, index + 1),
    reference().traits.length,
  )

  const result = await supabase.from('traits').insert({
    household_id: reference().householdId,
    key,
    label: input.label.trim(),
    short: normalizeShort(input.short, input.label),
    description: input.description.trim(),
    tip: input.tip.trim(),
    weight: clampWeight(input.weight),
    trait_group: input.group.trim() === '' ? null : input.group.trim(),
    active: true,
    is_default: false,
    sort_order: maxOrder + 1,
  })

  if (result.error) throw new DataError(duplicateOr(result.error, key))
  await refreshTraits()
  return key
}

/** Umbenennen, Kürzel, Erklärung, Tipp, Gewicht, Gruppe. */
export async function updateTrait(key: string, input: TraitEdit): Promise<void> {
  if (input.label.trim() === '') throw new DataError('Der Name darf nicht leer sein.')

  const result = await supabase
    .from('traits')
    .update({
      label: input.label.trim(),
      short: normalizeShort(input.short, input.label),
      description: input.description.trim(),
      tip: input.tip.trim(),
      weight: clampWeight(input.weight),
      trait_group: input.group.trim() === '' ? null : input.group.trim(),
    })
    .eq('household_id', reference().householdId)
    .eq('key', key)

  if (result.error) throw new DataError(SAVE_FAILED)
  await refreshTraits()
}

/** Ein- und ausschalten. Gelöscht wird nichts. */
export async function setTraitActive(key: string, active: boolean): Promise<void> {
  const result = await supabase
    .from('traits')
    .update({ active })
    .eq('household_id', reference().householdId)
    .eq('key', key)

  if (result.error) throw new DataError(SAVE_FAILED)
  await refreshTraits()
}

/**
 * Verschiebt ein Merkmal um eine Position.
 *
 * Geschrieben wird die **ganze** neue Reihenfolge, wie bei den Kategorien:
 * Nach ein paar Änderungen sind in `sort_order` sonst Lücken und Dubletten.
 */
export async function moveTrait(key: string, direction: -1 | 1): Promise<void> {
  const ordered = sortedTraits()
  const index = ordered.findIndex((trait) => trait.id === key)
  const target = index + direction
  if (index === -1 || target < 0 || target >= ordered.length) return

  const moved = [...ordered]
  ;[moved[index], moved[target]] = [moved[target], moved[index]]

  /*
   * Einzelne UPDATEs statt eines `upsert`: Ein `upsert` schriebe ganze Zeilen
   * und bräuchte dafür die uuid, die das Zwischenlager gar nicht führt — dort
   * ist die fachliche id der Schlüssel. Bei vierzehn Merkmalen sind vierzehn
   * kleine Anfragen der ehrlichere Weg als eine, die Felder mitschleppt.
   */
  const results = await Promise.all(
    moved.map((trait, position) =>
      supabase
        .from('traits')
        .update({ sort_order: position + 1 })
        .eq('household_id', reference().householdId)
        .eq('key', trait.id),
    ),
  )

  if (results.some((result) => result.error)) throw new DataError(SAVE_FAILED)
  await refreshTraits()
}

/**
 * Wie viele kanonische Produkte an jedem Merkmal hängen.
 *
 * Für die abgeleiteten Milch-Merkmale kommt 0 heraus, und das ist richtig: Sie
 * hängen an keinem Produkt, sondern an `milk_heat` bzw. `milk_homogenized`.
 */
export async function getTraitProductCounts(): Promise<Record<string, number>> {
  const rows = unwrap<Array<{ trait_key: string; product_count: number }>>(
    await supabase.from('v_trait_product_counts').select('trait_key, product_count'),
  )
  return Object.fromEntries(rows.map((row) => [row.trait_key, row.product_count]))
}

function duplicateOr(error: { code?: string; message?: string }, key: string): string {
  if (error.code === '23505') {
    return `Den Schlüssel „${key}" gibt es schon. Bitte einen anderen Namen wählen.`
  }
  const reason = germanDataError(error)
  return reason.startsWith('Die Daten konnten nicht') ? SAVE_FAILED : reason
}

/**
 * Die Merkmale in ihrer Reihenfolge.
 *
 * Das Zwischenlager lädt bereits nach `sort_order`; diese Funktion ist die
 * ausdrückliche Zusicherung dafür — die Verwaltung verschiebt Zeilen, und dann
 * soll die Liste unmittelbar danach stimmen.
 */
export function sortedTraits(): Trait[] {
  return [...reference().traits]
}
