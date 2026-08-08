/**
 * Was die Erkennung liefert — die Sicht der App.
 *
 * Diese Typen sind das Gegenstück zu `supabase/functions/erkennen/validate.ts`
 * und stehen dort wortgleich noch einmal. Das ist Absicht: Die Edge Function
 * läuft in Deno und wird getrennt ausgerollt, die App in Vite. Ein gemeinsamer
 * Import würde beide Bauwege aneinanderketten, für zwei Dutzend Zeilen Typen.
 * Wer hier etwas ändert, ändert es dort mit.
 *
 * Es gelten dieselben Regeln wie in `types.ts`: Geld immer als ganze Zahl in
 * Cent, Mengen als ganze Zahl in der Basiseinheit (Gramm, Milliliter, Stück),
 * Datum als ISO-String. Formatiert wird ausschließlich in der Oberfläche.
 */

import type { CategoryId, MilkHeat, MilkHomogenized, TraitId } from '../types'

/**
 * Die drei Abschnitte eines Scans, an denen sich ablesen lässt, wie weit es ist.
 *
 * Bewusst nur drei, und bewusst genau diese: Es sind die einzigen Zeitpunkte,
 * die sich beobachten lassen. Ein Fortschritt, der nur nach Stoppuhr
 * weiterläuft, wäre eine Behauptung — und der Verarbeitungs-Screen soll nichts
 * andeuten, was nicht passiert.
 *
 * Steht hier und nicht bei der Abfrage in `src/data/extract.ts`, weil auch
 * `src/lib/progress.ts` damit rechnet: Die Datenschicht baut auf `lib` auf, nie
 * umgekehrt.
 */
export type ExtractionPhase = 'vorbereiten' | 'senden' | 'auswerten'

/** Anzeige-Einheit einer Menge. Die Menge selbst ist immer g / ml / Stück. */
export type ExtractedUnit = 'kg' | 'g' | 'l' | 'ml' | 'stk'

/**
 * Wofür die Zeile steht. Pfand und Rabatt sind eigene Positionen auf dem Bon
 * (PROJEKT.md) und bekommen deshalb keinen Klarnamen und keine Kategorie.
 */
export type ItemKind = 'artikel' | 'pfand' | 'rabatt'

/** Der Vorschlag des Modells für einen bislang unbekannten Rohtext. */
export interface ExtractedSuggestion {
  name: string | null
  /**
   * Schlüssel aus `categories`, bereits gegen die Datenbank geprüft. Null heißt
   * „keiner passte sicher" — nicht geraten.
   */
  categoryKey: CategoryId | null
  /** Schlüssel aus `traits`, bereits gegen die aktiven Merkmale gefiltert. */
  traitKeys: TraitId[]
  milkHeat: MilkHeat
  milkHomogenized: MilkHomogenized
  /**
   * `db` heißt: Der Rohtext stand schon in `product_mappings`, und Name,
   * Kategorie und Merkmale kommen von dort — der Vorschlag des Modells wurde
   * dafür verworfen (PROJEKT.md, Kernprinzip). Der Korrektur-Screen macht diese
   * Zeilen als „gelernt" kenntlich.
   */
  source: 'model' | 'db'
  /** Das kanonische Produkt, wenn der Rohtext schon bekannt war. */
  canonicalProductId: string | null
}

export interface ExtractedItem {
  lineNo: number
  /** So stand es auf dem Bon, inklusive Eigenmarken-Präfix. */
  rawText: string
  kind: ItemKind
  quantityBase: number | null
  quantityUnit: ExtractedUnit | null
  /** Preis je Anzeige-Einheit (je kg, je l, je Stück) in Cent. */
  unitPriceCents: number | null
  /** Zeilensumme in Cent. Negativ bei Rabatten und Pfandrückgabe. */
  totalCents: number
  depositCents: number
  discountCents: number
  /**
   * Das Steuerkennzeichen am Zeilenende — `A`, `B`, gelegentlich `1` oder `2`.
   * Verbindet die Zeile mit dem Steuerblock am Fuß des Bons.
   */
  taxCode: string | null
  /** Null bei Pfand- und Rabattzeilen. */
  suggestion: ExtractedSuggestion | null
}

/**
 * Eine Steuerklasse aus dem Block am Fuß des Bons, zusammen mit dem, was die
 * Positionen dazu ergeben. Der Abgleich zeigt nicht nur, *dass* etwas fehlt,
 * sondern *wo*.
 */
export interface TaxGroup {
  /** Das Kennzeichen, wie es auf dem Bon steht: `A`, `B`, … */
  code: string
  /** Der gedruckte Bruttobetrag dieser Klasse in Cent. */
  grossCents: number
  /** Summe der Positionen mit diesem Kennzeichen. */
  itemsTotalCents: number
  /** Gedruckt minus gerechnet. 0 heißt: stimmt. */
  differenceCents: number
}

/**
 * Eine Zeile des gedruckten Steuerblocks, ohne Gegenrechnung. Der
 * Korrektur-Screen rechnet daraus bei jeder Änderung neu — und bietet die
 * Kennzeichen zur Auswahl an, wenn an einer Position eines fehlt.
 */
export interface PrintedTaxGroup {
  code: string
  grossCents: number
}

/** Eine Auffälligkeit, die den Bon markiert, aber nicht ablehnt. */
export interface ExtractionWarning {
  code: string
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
  lineNo?: number
}

export interface Extraction {
  merchantName: string | null
  /** ISO-Datum `JJJJ-MM-TT`. */
  purchasedOn: string | null
  /** `HH:MM`, 24 Stunden. */
  purchasedAt: string | null
  printedTotalCents: number | null
  items: ExtractedItem[]
  itemsTotalCents: number
  /** Gedruckte Summe minus Positionssumme. Null ohne gelesene Gesamtsumme. */
  discrepancyCents: number | null
  /**
   * Der Abgleich je Steuerklasse. Leer, wenn kein Steuerblock lesbar war —
   * dann bleibt es beim Gesamtabgleich über `discrepancyCents`.
   */
  taxGroups: TaxGroup[]
  /**
   * Der gedruckte Steuerblock, sobald er zu sich selbst passt — auch dann, wenn
   * der Abgleich oben mangels Kennzeichen ausfällt.
   */
  printedTaxGroups: PrintedTaxGroup[]
  warnings: ExtractionWarning[]
}

/** Das vollständige Ergebnis eines Scans, so wie die Funktion es zurückgibt. */
export interface ExtractionResponse {
  extraction: Extraction
  model: string
  durationMs: number
  /** Die unverarbeitete Antwort des Modells — Grundlage zum Nachschärfen. */
  raw: string
}
