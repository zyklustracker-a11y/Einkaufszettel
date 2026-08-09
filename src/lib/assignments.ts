/**
 * Durchgang 2 einsetzen — Zuordnungen an ihre Zeilen hängen.
 *
 * Die Gegenstelle zu `applyKnownProducts` in der Edge Function: Dort setzt die
 * Datenbank ein, was sie schon weiß; hier setzt der Browser ein, was Durchgang 2
 * für den Rest herausgefunden hat.
 *
 * **Zugeordnet wird über den Rohtext, nie über die Reihenfolge.** Ein Modell,
 * das eine Zeile ausfallen lässt, würde sonst alles Folgende um eins
 * verschieben — aus dem Spülmittel würde die Milch, und das sähe plausibel aus.
 * Derselbe Grundsatz gilt schon in `assign.ts` auf dem Server; hier ist die
 * zweite Hälfte davon.
 *
 * Reine Funktionen, kein Laufzeit-Import: Die Tests nebenan laufen direkt auf
 * `node --test`.
 */

import type { AssignmentRow, ExtractedItem, Extraction } from './extraction.ts'

/**
 * Der Nachschlage-Schlüssel eines Rohtexts.
 *
 * Muss zeichengenau zu `mappingKey` in der Edge Function passen — und damit zum
 * Index `lower(btrim(raw_text))` in der Datenbank. Drei Stellen, eine Regel.
 */
export function rawTextKey(rawText: string): string {
  return rawText.trim().toLowerCase()
}

/**
 * Setzt die Zuordnungen ein und gibt eine neue `Extraction` zurück.
 *
 * Eine Zeile, für die nichts zurückkam, bleibt ohne Zuordnung — im
 * Korrektur-Screen steht dann der Bontext als Name und „Kategorie offen". Das
 * ist der ausdrücklich vorgesehene Zustand und kein Fehler: Die Beträge stimmen,
 * und Name und Kategorie sind ein Tipper.
 */
export function applyAssignments(
  extraction: Extraction,
  assignments: AssignmentRow[],
): Extraction {
  if (assignments.length === 0) return extraction

  const byRawText = new Map(assignments.map((row) => [rawTextKey(row.rawText), row]))

  const items: ExtractedItem[] = extraction.items.map((item) => {
    // Pfand und Rabatt sind keine Produkte; was schon zugeordnet ist, kommt aus
    // der Datenbank und wiegt schwerer als jeder Modellvorschlag (PROJEKT.md).
    if (item.kind !== 'artikel' || item.suggestion !== null) return item

    const match = byRawText.get(rawTextKey(item.rawText))
    if (!match) return item

    return {
      ...item,
      suggestion: {
        name: match.name,
        categoryKey: match.categoryKey,
        traitKeys: match.traitKeys,
        milkHeat: match.milkHeat,
        milkHomogenized: match.milkHomogenized,
        source: match.source,
        canonicalProductId: match.canonicalProductId,
      },
    }
  })

  return { ...extraction, items }
}

/**
 * Die Warnung, die stehen bleibt, wenn Durchgang 2 gar nicht erst zustande kam.
 *
 * Netzfehler, erschöpftes Kontingent, unbrauchbare Antwort: Der Bon ist deshalb
 * nicht verloren — der teure Teil ist geschafft, die Beträge stehen. Gesagt
 * werden muss es trotzdem, sonst wundert sich der Nutzer, warum plötzlich jede
 * Zeile den Kassentext trägt.
 */
export function assignmentFailedWarning(): Extraction['warnings'][number] {
  return {
    code: 'zuordnung_ausgefallen',
    message:
      'Die Zuordnung von Namen und Kategorien ist ausgefallen. Die Positionen und Beträge ' +
      'stimmen trotzdem – Name und Kategorie kannst du an jeder Zeile selbst setzen.',
  }
}

/** Dieselbe Warnung an die Extraktion hängen, ohne sie zu verändern. */
export function withAssignmentFailure(extraction: Extraction): Extraction {
  return { ...extraction, warnings: [...extraction.warnings, assignmentFailedWarning()] }
}
