/**
 * Durchgang 2 prüfen — Klarname, Kategorie, Merkmale.
 *
 * Das Gegenstück zu `validate.ts`: Dort wird die *Struktur* eines Bons geprüft,
 * hier die *Zuordnung*. Die Trennung ist dieselbe wie bei den Prompts, und aus
 * demselben Grund — ein Fehler hier kostet einen Tipper im Korrektur-Screen, ein
 * Fehler dort kostet einen Betrag.
 *
 * Der springende Punkt aus PROJEKT.md: Merkmalsschlüssel, die nicht in der Liste
 * des Haushalts stehen, werden **verworfen**, nicht angelegt. Damit kann ein
 * halluziniertes Merkmal nie in die Auswertung geraten. Dasselbe gilt für
 * Kategorien: unbekannt heißt „bleibt offen", nicht „nimm die nächstbeste".
 *
 * Wie `validate.ts` frei von Netz und Datenbank: reine Funktionen.
 */

import { MILK_HEATS, MILK_HOMOGENIZED, parseModelJson } from './validate.ts'
import type {
  ExtractedSuggestion,
  ExtractionWarning,
  MilkHeat,
  MilkHomogenized,
} from './validate.ts'
import { mappingKey } from './mappings.ts'

/** Eine Zuordnung, so wie sie aus dem Modell kommt — ungeprüft. */
export interface ModelAssignment {
  rohtext?: unknown
  name?: unknown
  kategorie?: unknown
  merkmale?: unknown
  milch_erhitzung?: unknown
  milch_homogenisiert?: unknown
}

export interface AssignmentContext {
  /** Alle Kategorie-Schlüssel des Haushalts. */
  categoryKeys: string[]
  /** Alle **aktiven** Merkmalsschlüssel des Haushalts. */
  traitKeys: string[]
  /**
   * Die Rohtexte, nach denen gefragt wurde. Alles, was das Modell darüber
   * hinaus zurückgibt, wird verworfen: Eine Zuordnung zu einem Text, der auf
   * diesem Bon gar nicht stand, kann nur erfunden sein.
   */
  rawTexts: string[]
}

export interface AssignmentResult {
  /** Rohtext-Schlüssel → Zuordnung, bereit zum Einsetzen. */
  byRawText: Map<string, ExtractedSuggestion>
  warnings: ExtractionWarning[]
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Die geprüften Zuordnungen aus der Antwort von Durchgang 2.
 *
 * Zugeordnet wird über den Rohtext und nicht über die Reihenfolge: Ein Modell,
 * das eine Zeile auslässt, würde sonst alle folgenden Zuordnungen um eins
 * verschieben — und aus dem Spülmittel würde die Milch. Der Rohtext ist der
 * einzige Anker, der das nicht mitmacht.
 */
export function validateAssignments(raw: string, context: AssignmentContext): AssignmentResult {
  const byRawText = new Map<string, ExtractedSuggestion>()
  const warnings: ExtractionWarning[] = []

  const parsed = parseModelJson(raw)
  const entries = Array.isArray((parsed as { zuordnungen?: unknown } | null)?.zuordnungen)
    ? ((parsed as { zuordnungen: unknown[] }).zuordnungen)
    : []

  if (parsed === null || entries.length === 0) {
    warnings.push({
      code: 'zuordnung_ausgefallen',
      message:
        'Die Zuordnung hat nichts Brauchbares geliefert. Die Beträge stimmen trotzdem – ' +
        'Name und Kategorie bitte an den Zeilen selbst setzen.',
    })
    return { byRawText, warnings }
  }

  const categoryKeys = new Set(context.categoryKeys)
  const traitKeys = new Set(context.traitKeys)
  const wanted = new Set(context.rawTexts.map(mappingKey))
  const rejectedTraits = new Set<string>()
  const unknownCategories = new Set<string>()

  for (const entry of entries) {
    const row = (entry ?? {}) as ModelAssignment
    const rawText = text(row.rohtext)
    if (rawText === null) continue

    const key = mappingKey(rawText)
    // Nur, wonach gefragt wurde — und das erste Vorkommen gewinnt.
    if (!wanted.has(key) || byRawText.has(key)) continue

    const categoryRaw = text(row.kategorie)
    let categoryKey: string | null = null
    if (categoryRaw !== null) {
      if (categoryKeys.has(categoryRaw)) categoryKey = categoryRaw
      else unknownCategories.add(categoryRaw)
    }

    const proposed = Array.isArray(row.merkmale) ? row.merkmale : []
    const accepted: string[] = []
    for (const item of proposed) {
      const traitKey = text(item)
      if (traitKey === null) continue
      if (traitKeys.has(traitKey)) {
        if (!accepted.includes(traitKey)) accepted.push(traitKey)
      } else {
        rejectedTraits.add(traitKey)
      }
    }

    const heat = text(row.milch_erhitzung)?.toLowerCase()
    const homogenized = text(row.milch_homogenisiert)?.toLowerCase()

    byRawText.set(key, {
      name: text(row.name),
      categoryKey,
      traitKeys: accepted,
      // Alles Unbekannte wird „unbekannt" — nie geraten (PROJEKT.md).
      milkHeat: MILK_HEATS.includes(heat as MilkHeat) ? (heat as MilkHeat) : 'unbekannt',
      milkHomogenized: MILK_HOMOGENIZED.includes(homogenized as MilkHomogenized)
        ? (homogenized as MilkHomogenized)
        : 'unbekannt',
      source: 'model',
      canonicalProductId: null,
    })
  }

  /*
   * Gesammelt statt je Zeile gemeldet: Erfindet das Modell ein Merkmal, tut es
   * das meist auf zwanzig Zeilen gleichzeitig. Zwanzig gleichlautende Warnungen
   * wären dann keine Hilfe, sondern eine Wand.
   */
  if (unknownCategories.size > 0) {
    warnings.push({
      code: 'kategorie_unbekannt',
      message:
        `Vorgeschlagene Kategorien, die es nicht gibt, wurden verworfen ` +
        `(${[...unknownCategories].join(', ')}). Die betroffenen Zeilen bleiben ohne Kategorie.`,
    })
  }

  if (rejectedTraits.size > 0) {
    warnings.push({
      code: 'merkmal_verworfen',
      message: `Unbekannte Merkmale verworfen (${[...rejectedTraits].join(', ')}).`,
    })
  }

  const missing = context.rawTexts.filter((rawText) => !byRawText.has(mappingKey(rawText)))
  if (missing.length > 0) {
    warnings.push({
      code: 'zuordnung_unvollstaendig',
      message:
        `Für ${missing.length} ${missing.length === 1 ? 'Position' : 'Positionen'} kam keine ` +
        'Zuordnung zurück. Name und Kategorie bitte an der Zeile selbst setzen.',
    })
  }

  return { byRawText, warnings }
}
