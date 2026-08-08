/**
 * Die Formen, die zwischen Modell, Funktion und App unterwegs sind.
 *
 * Drei Ebenen, bewusst getrennt:
 *
 *   1. `ModelReceipt` — was das Modell *behauptet* zu liefern. Jedes Feld ist
 *      `unknown`-nah typisiert, denn ein Modell hält sich nicht an Typen. Diese
 *      Form wird nie direkt benutzt, sondern nur von `validate.ts` geprüft.
 *   2. `Extraction` — das geprüfte Ergebnis. Geld in ganzen Cent, Mengen in
 *      ganzen Basiseinheiten, Schlüssel gegen die Datenbank abgeglichen.
 *   3. `ErrorBody` — der Fehlerfall, immer mit deutschem Text.
 *
 * Die Ebenen 2 und 3 stehen wortgleich noch einmal in `src/lib/extraction.ts`.
 * Das ist Absicht und kein Versehen: Die Edge Function läuft in Deno und wird
 * getrennt ausgerollt, die App in Vite — ein gemeinsamer Import würde beide
 * Bauwege aneinanderketten. Wer hier etwas ändert, ändert es dort mit.
 */

/* ------------------------------------------------- 1. Rohform des Modells */

/** Eine Position, so wie sie aus dem Modell kommt — ungeprüft. */
export interface ModelItem {
  zeile?: unknown
  rohtext?: unknown
  art?: unknown
  menge?: unknown
  einheit?: unknown
  einzelpreis_cent?: unknown
  zeilensumme_cent?: unknown
  vorschlag?: {
    name?: unknown
    kategorie?: unknown
    merkmale?: unknown
    milch_erhitzung?: unknown
    milch_homogenisiert?: unknown
  } | null
}

export interface ModelReceipt {
  lesbar?: unknown
  haendler?: unknown
  datum?: unknown
  uhrzeit?: unknown
  summe_cent?: unknown
  positionen?: unknown
}

/* --------------------------------------------------- 2. Geprüftes Ergebnis */

/** Anzeige-Einheit einer Menge. Die Menge selbst ist immer g / ml / Stück. */
export type ExtractedUnit = 'kg' | 'g' | 'l' | 'ml' | 'stk'

export type ItemKind = 'artikel' | 'pfand' | 'rabatt'

export type MilkHeat = 'roh' | 'pasteurisiert' | 'esl' | 'uht' | 'unbekannt'
export type MilkHomogenized = 'ja' | 'nein' | 'unbekannt'

/** Der Vorschlag des Modells für einen bislang unbekannten Rohtext. */
export interface ExtractedSuggestion {
  name: string | null
  /** Schlüssel aus `categories`, oder null wenn keiner sicher passte. */
  categoryKey: string | null
  /** Schlüssel aus `traits`, bereits gegen die aktiven Merkmale gefiltert. */
  traitKeys: string[]
  milkHeat: MilkHeat
  milkHomogenized: MilkHomogenized
}

export interface ExtractedItem {
  lineNo: number
  rawText: string
  kind: ItemKind
  /** Ganze Zahl in Gramm, Milliliter oder Stück. Null heißt „ohne Mengenangabe". */
  quantityBase: number | null
  /** Wie die Menge angezeigt wird. Immer zusammen mit `quantityBase` gesetzt. */
  quantityUnit: ExtractedUnit | null
  /** Preis je Anzeige-Einheit (je kg, je l, je Stück) in Cent. */
  unitPriceCents: number | null
  /** Zeilensumme in Cent. Negativ bei Rabatten und Pfandrückgabe. */
  totalCents: number
  /** Pfandanteil dieser Zeile, immer positiv. Nur bei `kind: 'pfand'` gesetzt. */
  depositCents: number
  /** Rabattbetrag dieser Zeile, immer positiv. Nur bei `kind: 'rabatt'` gesetzt. */
  discountCents: number
  /** Null bei Pfand- und Rabattzeilen. */
  suggestion: ExtractedSuggestion | null
}

/**
 * Eine Auffälligkeit, die den Bon markiert, aber nicht ablehnt (PROJEKT.md).
 *
 * `lineNo` zeigt auf die betroffene Position, wenn es eine gibt — sonst gilt
 * die Warnung für den ganzen Bon.
 */
export interface ExtractionWarning {
  code:
    | 'summe_weicht_ab'
    | 'summe_fehlt'
    | 'datum_fehlt'
    | 'haendler_fehlt'
    | 'betrag_fehlt'
    | 'menge_umgerechnet'
    | 'menge_unplausibel'
    | 'kategorie_unbekannt'
    | 'merkmal_verworfen'
    | 'position_unvollstaendig'
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
  lineNo?: number
}

export interface Extraction {
  /** Name des Händlers, wie er auf dem Bon steht. Kein Datenbank-Eintrag. */
  merchantName: string | null
  /** ISO-Datum `JJJJ-MM-TT`. */
  purchasedOn: string | null
  /** `HH:MM`, 24 Stunden. */
  purchasedAt: string | null
  /** Die auf dem Papier gedruckte Summe in Cent. */
  printedTotalCents: number | null
  items: ExtractedItem[]
  /** Summe aller Zeilensummen — vom Code addiert, nie vom Modell. */
  itemsTotalCents: number
  /** Gedruckte Summe minus Positionssumme. Null, wenn keine Summe gelesen wurde. */
  discrepancyCents: number | null
  warnings: ExtractionWarning[]
}

/** Was die Funktion im Erfolgsfall zurückgibt. */
export interface ExtractionResponse {
  extraction: Extraction
  /** Das benutzte Modell, für den Aufklappbereich im Korrektur-Screen. */
  model: string
  /** Dauer des Modell-Aufrufs in Millisekunden. */
  durationMs: number
  /** Die unverarbeitete Antwort des Modells — Grundlage zum Nachschärfen. */
  raw: string
}

/* -------------------------------------------------------- 3. Der Fehlerfall */

/**
 * Warum es nicht geklappt hat. Der Code ist für die App, der Text für den
 * Nutzer — technische Meldungen erreichen die Oberfläche nie.
 */
export type ExtractionErrorCode =
  | 'nicht_angemeldet'
  | 'kein_haushalt'
  | 'kein_bild'
  | 'bild_zu_gross'
  | 'kein_schluessel'
  | 'kontingent'
  | 'zeitueberschreitung'
  | 'modell_fehler'
  | 'modell_json'
  | 'bild_unlesbar'
  | 'unbekannt'

export interface ErrorBody {
  code: ExtractionErrorCode
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
  /** Die Rohantwort, falls es eine gab — hilft beim Nachschärfen des Prompts. */
  raw?: string
}
