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
