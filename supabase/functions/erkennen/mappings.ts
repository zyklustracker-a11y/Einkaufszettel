/**
 * Das Gedächtnis — bekannte Rohtexte schlagen den Modellvorschlag.
 *
 * PROJEKT.md, Kernprinzip: „Das Ergebnis wird dauerhaft gespeichert und nie neu
 * erfragt. Ab dann kommt die Zuordnung aus der eigenen Datenbank.
 * Nutzerkorrekturen überschreiben die Modell-Antwort und gelten ebenfalls
 * dauerhaft."
 *
 * Genau das passiert hier: Steht `G&G H-MILCH 1,5%` schon in
 * `product_mappings`, wird der Vorschlag des Modells für diese Zeile
 * **verworfen** — Name, Kategorie, Merkmale und Milch-Eigenschaften kommen aus
 * der Datenbank. Ohne das würde eine Korrektur beim nächsten Scan wieder
 * überschrieben, und der Nutzer korrigierte dieselbe Zeile jeden Monat neu.
 *
 * Was das Modell liest, bleibt unangetastet: Menge, Preise, Steuerkennzeichen,
 * Rohtext. Die stehen auf *diesem* Bon und können sich von Kauf zu Kauf
 * unterscheiden. Ersetzt wird nur, was zum Produkt gehört.
 *
 * Wie `validate.ts` ist diese Datei frei von Netzwerk- und Datenbankzugriffen:
 * `index.ts` lädt die Zeilen, hier wird nur zusammengesetzt.
 */

import type { Extraction, ExtractedItem, MilkHeat, MilkHomogenized } from './validate.ts'

/** Ein Produkt, das der Haushalt schon kennt. */
export interface KnownProduct {
  canonicalProductId: string
  name: string
  categoryKey: string
  /** Alle Merkmale am Produkt — auch abgeschaltete. Wissen geht nicht verloren. */
  traitKeys: string[]
  milkHeat: MilkHeat
  milkHomogenized: MilkHomogenized
}

/**
 * Der Nachschlage-Schlüssel eines Rohtexts.
 *
 * **Muss zeichengenau zu dem passen, was die Datenbank für eindeutig hält:**
 * dort ist es der Index über `lower(btrim(raw_text))`. Wäre das hier großzügiger
 * (etwa „mehrere Leerzeichen zu einem"), fände die Funktion einen Eintrag, den
 * das spätere `insert … on conflict` nicht als Dublette erkennt — und es
 * entstünde eine zweite Zuordnung für denselben Text.
 */
export function mappingKey(rawText: string): string {
  return rawText.trim().toLowerCase()
}

/** Rohtext-Schlüssel → Produkt. */
export type KnownProducts = Map<string, KnownProduct>

/**
 * Bekanntes einsetzen, Vorschläge des Modells dafür verwerfen.
 *
 * Zurück kommt eine neue `Extraction`; die Eingabe bleibt unangetastet.
 */
export function applyKnownProducts(extraction: Extraction, known: KnownProducts): Extraction {
  if (known.size === 0) return extraction

  const resolvedLines = new Set<number>()

  const items: ExtractedItem[] = extraction.items.map((item) => {
    // Pfand und Rabatt sind keine Produkte und werden nie zugeordnet.
    if (item.kind !== 'artikel') return item

    const match = known.get(mappingKey(item.rawText))
    if (!match) return item

    resolvedLines.add(item.lineNo)

    return {
      ...item,
      suggestion: {
        name: match.name,
        categoryKey: match.categoryKey,
        traitKeys: match.traitKeys,
        milkHeat: match.milkHeat,
        milkHomogenized: match.milkHomogenized,
        source: 'db',
        canonicalProductId: match.canonicalProductId,
      },
    }
  })

  /*
   * Warnungen zu genau den Zeilen, deren Vorschlag gerade verworfen wurde,
   * fliegen mit ihm raus: Dass das Modell eine unbekannte Kategorie oder ein
   * erfundenes Merkmal geliefert hat, ist folgenlos, sobald die Zuordnung aus
   * der Datenbank kommt. Stehen bleibt alles andere — Mengen, Preise und
   * Summenabgleich hat die Datenbank nicht besser gewusst.
   */
  const warnings = extraction.warnings.filter(
    (warning) =>
      !(
        warning.lineNo !== undefined &&
        resolvedLines.has(warning.lineNo) &&
        (warning.code === 'kategorie_unbekannt' || warning.code === 'merkmal_verworfen')
      ),
  )

  return { ...extraction, items, warnings }
}
