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

import type { CategoryId, MerchantKind, MilkHeat, MilkHomogenized, TraitId } from '../types'

/**
 * Die Abschnitte eines Scans, an denen sich ablesen lässt, wie weit es ist.
 *
 * Bewusst genau diese: Es sind die einzigen Zeitpunkte, die sich beobachten
 * lassen. Ein Fortschritt, der nur nach Stoppuhr weiterläuft, wäre eine
 * Behauptung — und der Verarbeitungs-Screen soll nichts andeuten, was nicht
 * passiert.
 *
 * Genau deshalb sind es seit Schritt 4c vier statt drei: Die Erkennung besteht
 * aus zwei getrennten Aufrufen (`lesen`, `zuordnen`), und weil der Browser
 * beide selbst absetzt, sieht er ihre Grenze wirklich. Wäre es ein Aufruf, der
 * innen zweimal fragt, müsste der Balken den Übergang raten.
 *
 * `zuordnen` **entfällt**, wenn der Haushalt jeden Artikel des Bons schon kennt.
 * Dann wird der Abschnitt übersprungen, und der Screen sagt das auch.
 *
 * Steht hier und nicht bei der Abfrage in `src/data/extract.ts`, weil auch
 * `src/lib/progress.ts` damit rechnet: Die Datenschicht baut auf `lib` auf, nie
 * umgekehrt.
 */
export type ExtractionPhase = 'vorbereiten' | 'lesen' | 'zuordnen' | 'auswerten'

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
  /**
   * Die gedruckten Zeilen, aus denen diese Position entstanden ist.
   *
   * Seit Schritt 4d entsteht eine Position im Code aus abgetippten Zeilen. Sie
   * bleiben erhalten, damit sich im Korrektur-Screen nachsehen lässt, welche
   * Zeile wohin geflossen ist — und welche fehlt, wenn eine Summe nicht aufgeht.
   */
  sourceLines: string[]
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
  /**
   * Der gedruckte Währungscode, oder null, wenn keiner dastand.
   *
   * **Alle Beträge in dieser Struktur sind in dieser Währung.** Umgerechnet wird
   * erst beim Speichern (`buildSavePayload`), damit der Korrektur-Screen
   * dieselben Zahlen zeigt wie das Papier — man prüft ja gegen den Bon in der
   * Hand.
   */
  currency: string | null
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
  /** Alles, was das Modell abgetippt hat — in gedruckter Reihenfolge. */
  lines: string[]
  /**
   * Abgetippte Zeilen, aus denen keine Position wurde. Sie werden angezeigt
   * statt verschwiegen: Eine Zeile, die nirgends auftaucht, ist genau das, was
   * man sehen will, wenn eine Summe nicht aufgeht.
   */
  unassignedLines: string[]
  warnings: ExtractionWarning[]
}

/* --------------------------------------------- Was die Edge Function liefert */

/**
 * Die Antwort auf Durchgang 1 (Struktur). Steht wortgleich in
 * `supabase/functions/erkennen/index.ts`.
 */
export interface StructureResponse {
  extraction: Extraction
  model: string
  durationMs: number
  /** Die unverarbeitete Antwort des Modells — Grundlage zum Nachschärfen. */
  raw: string
  /**
   * Rohtexte ohne Zuordnung — genau das, was Durchgang 2 braucht. Leer heißt:
   * Der Haushalt kennt jeden Artikel auf diesem Bon, es ist nichts mehr zu tun.
   */
  offeneRohtexte: string[]
  /**
   * Die gespeicherte Art dieses Händlers — **nachgeschlagen, nicht geraten**.
   *
   * Die Funktion sucht den Händlernamen über `merchant_key()` in der Datenbank.
   * Ist er bekannt, kommt seine Art zurück, und der Korrektur-Screen hat sie
   * vorausgewählt. Ist er unbekannt, steht hier `retail` — dann tippt der Nutzer
   * bei einem Restaurant einmal auf „Gastro", und ab dem nächsten Bon dieses
   * Ladens steht es von selbst da.
   *
   * Bewusst fragt hier **niemand das Modell**. Durchgang 1 ist seit Schritt 4d
   * ein reiner Abschreiber; jede zusätzliche Deutungsaufgabe konkurriert mit dem
   * Abtippen, und genau daran ist der Prompt schon zweimal gescheitert.
   */
  merchantKind: MerchantKind
  /**
   * Der EZB-Kurs zum Bon-Datum — nur bei Fremdwährung, sonst null. Bei einem
   * Euro-Bon, dem Normalfall, wird gar nichts abgerufen.
   */
  exchangeRate: ExchangeRate | null
  /**
   * Warum kein Kurs da ist, als fertiger deutscher Satz. Der Korrektur-Screen
   * zeigt ihn zusammen mit einem Kursfeld für diesen einen Bon — das Speichern
   * wird dadurch nicht blockiert, es fehlt nur eine Zahl.
   */
  rateError: string | null
}

/**
 * Ein Wechselkurs, wie ihn die Edge Function beschafft.
 *
 * `rate` ist Euro je **eine** Einheit der Fremdwährung — die Richtung, in der
 * gerechnet wird: Betrag × rate = Euro. Die EZB veröffentlicht andersherum;
 * umgedreht wird auf dem Server.
 *
 * `rateDate` ist der Tag, für den die EZB den Kurs veröffentlicht hat. Bei einem
 * Bon vom Samstag steht hier der Freitag davor — mitgespeichert, damit später
 * nachvollziehbar bleibt, woher die Zahl stammt.
 */
export interface ExchangeRate {
  rate: number
  rateDate: string
}

/** Die Antwort auf eine reine Kursanfrage. */
export interface RateResponse {
  exchangeRate: ExchangeRate | null
  rateError: string | null
}

/** Eine geprüfte Zuordnung aus Durchgang 2, samt ihrem Rohtext. */
export interface AssignmentRow extends ExtractedSuggestion {
  rawText: string
}

/** Die Antwort auf Durchgang 2 (Zuordnung). */
export interface AssignmentResponse {
  assignments: AssignmentRow[]
  warnings: ExtractionWarning[]
  model: string
  durationMs: number
  raw: string
}

/** Was Durchgang 2 gekostet hat — nur für den Aufklappbereich. */
export interface AssignmentInfo {
  model: string
  durationMs: number
  raw: string
}

/** Das vollständige Ergebnis eines Scans, aus beiden Durchgängen zusammengesetzt. */
export interface ExtractionResponse {
  extraction: Extraction
  model: string
  durationMs: number
  /** Die unverarbeitete Antwort aus Durchgang 1. */
  raw: string
  /**
   * Durchgang 2. Null, wenn er nicht nötig war (alles bekannt) oder ausgefallen
   * ist — im zweiten Fall steht eine Warnung in `extraction.warnings`.
   */
  assignment: AssignmentInfo | null
  /** Die gespeicherte Art des Händlers, aus Durchgang 1 durchgereicht. */
  merchantKind: MerchantKind
  /** Der EZB-Kurs, aus Durchgang 1 durchgereicht. Null bei einem Euro-Bon. */
  exchangeRate: ExchangeRate | null
  /** Warum kein Kurs da ist. Null heißt: Es gab nichts zu holen. */
  rateError: string | null
}
