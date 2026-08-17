/**
 * Prüfen und Umrechnen — der Teil, der dem Modell nicht glaubt.
 *
 * Zuständig für **Durchgang 1**, die Struktur: Zeilen, Beträge, Mengen,
 * Steuerkennzeichen. Klarnamen, Kategorien und Merkmale kommen aus Durchgang 2
 * und werden in `assign.ts` geprüft.
 *
 * PROJEKT.md: „Die Modellantwort wird nie ungeprüft gespeichert." Deshalb
 * passiert hier alles, was sich ohne Modell entscheiden lässt:
 *
 *   * Ist überhaupt JSON angekommen, und hat es die erwartete Form?
 *   * Sind Beträge ganze Zahlen in Cent? Sind Mengen ganze Basiseinheiten?
 *     Wenn nicht, wird umgerechnet statt abgelehnt.
 *   * Passt Menge × Einzelpreis zur Zeilensumme?
 *   * Passt die Summe der Positionen zur gedruckten Gesamtsumme?
 *
 * Grundhaltung überall: **markieren, nicht ablehnen**. Ein Bon mit einer
 * krummen Zeile ist immer noch ein brauchbarer Bon — der Korrektur-Screen zeigt
 * die Warnung, und der Nutzer entscheidet. Abgelehnt wird nur, was gar nicht
 * lesbar ist.
 *
 * Die Datei ist bewusst frei von Netzwerk- und Datenbankzugriffen: reine
 * Funktionen, die aus Eingabe Ausgabe machen.
 */

import { parseLines } from './lines.ts'
import { recoverJson } from './repair.ts'

/* ============================================================================
 * DIE FORMEN
 *
 * Zwei Ebenen, und die Trennung ist der halbe Sinn dieser Datei:
 *
 *   1. `ModelReceipt` — was das Modell *behauptet* zu liefern. Jedes Feld ist
 *      `unknown`, denn ein Modell hält sich an keine Typen. Diese Form wird nie
 *      direkt benutzt, sondern nur geprüft.
 *   2. `Extraction` — das geprüfte Ergebnis. Geld in ganzen Cent, Mengen in
 *      ganzen Basiseinheiten, Schlüssel gegen die Datenbank abgeglichen.
 *
 * Ebene 2 steht wortgleich noch einmal in `src/lib/extraction.ts`. Das ist
 * Absicht: Die Edge Function läuft in Deno und wird getrennt ausgerollt, die
 * App in Vite — ein gemeinsamer Import würde beide Bauwege aneinanderketten.
 * Wer hier etwas ändert, ändert es dort mit.
 * ========================================================================== */

/**
 * Eine Position, so wie sie aus Durchgang 1 kommt — ungeprüft.
 *
 * Kein Feld für Name, Kategorie oder Merkmale: Danach wird in diesem Durchgang
 * nicht gefragt. Liefert das Modell trotzdem eines, wird es hier stillschweigend
 * übergangen — es hätte auf dem Weg zur Struktur nur Schaden angerichtet.
 */
export interface ModelItem {
  zeile?: unknown
  rohtext?: unknown
  art?: unknown
  menge?: unknown
  einheit?: unknown
  einzelpreis_cent?: unknown
  zeilensumme_cent?: unknown
  steuer?: unknown
  /** Die Vorab-Konfidenz aus `lines.ts`, zwischen 0 und 1. */
  konfidenz?: unknown
}

/** Eine Zeile aus dem Steuerblock am Fuß des Bons. */
export interface ModelTaxGroup {
  kennzeichen?: unknown
  brutto_cent?: unknown
}

export interface ModelReceipt {
  lesbar?: unknown
  haendler?: unknown
  datum?: unknown
  uhrzeit?: unknown
  waehrung?: unknown
  summe_cent?: unknown
  /**
   * Die abgetippten Zeilen des Artikelbereichs — seit Schritt 4d der Weg, auf
   * dem Positionen entstehen. Was davon eine Position ist, entscheidet
   * `lines.ts` und nicht mehr das Modell.
   */
  zeilen?: unknown
  /**
   * Die Nummern der Zeilen, bei denen das Modell sich nicht sicher war —
   * 0-basiert, bezogen auf `zeilen`. Grundlage der Konfidenz (`lines.ts`).
   */
  unsichere_zeilen?: unknown
  /** Die auf dem Bon gedruckte Postenzahl, für den Abgleich in Phase 6. */
  posten?: unknown
  /**
   * Fertige Positionen. Der alte Weg, den das Modell nicht mehr gefragt wird —
   * er bleibt als Rückfallebene, falls eine Antwort doch noch so aussieht.
   */
  positionen?: unknown
  steuerblock?: unknown
}

/** Anzeige-Einheit einer Menge. Die Menge selbst ist immer g / ml / Stück. */
export type ExtractedUnit = 'kg' | 'g' | 'l' | 'ml' | 'stk'

export type ItemKind = 'artikel' | 'pfand' | 'rabatt'

export type MilkHeat = 'roh' | 'pasteurisiert' | 'esl' | 'uht' | 'unbekannt'
export type MilkHomogenized = 'ja' | 'nein' | 'unbekannt'

/**
 * Was zu einem Rohtext gehört: Klarname, Kategorie, Merkmale.
 *
 * Entsteht **nicht** hier, sondern in `mappings.ts` (aus der Datenbank) oder in
 * `assign.ts` (aus Durchgang 2). Der Typ steht trotzdem in dieser Datei, weil
 * `ExtractedItem` ihn trägt.
 */
export interface ExtractedSuggestion {
  name: string | null
  /** Schlüssel aus `categories`, oder null wenn keiner sicher passte. */
  categoryKey: string | null
  /** Schlüssel aus `traits`, bereits gegen die aktiven Merkmale gefiltert. */
  traitKeys: string[]
  milkHeat: MilkHeat
  milkHomogenized: MilkHomogenized
  /**
   * Woher der Vorschlag stammt.
   *
   * `db` heißt: Der Rohtext war schon bekannt, und die Zuordnung kommt aus
   * `product_mappings`. Der Vorschlag des Modells wurde dafür verworfen
   * (PROJEKT.md: „Das Ergebnis wird dauerhaft gespeichert und nie neu
   * erfragt."). `assign.ts` setzt `model`, `mappings.ts` setzt `db`.
   */
  source: 'model' | 'db'
  /** Das kanonische Produkt, wenn der Rohtext schon bekannt war. */
  canonicalProductId: string | null
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
  /**
   * Das Steuerkennzeichen am Zeilenende — `A`, `B`, gelegentlich `1` oder `2`.
   * Kein Preis und keine Menge, sondern der Steuersatz. Es verbindet die Zeile
   * mit dem Steuerblock am Fuß des Bons und macht damit den Abgleich je
   * Steuerklasse überhaupt erst möglich.
   */
  taxCode: string | null
  /**
   * Null, solange der Rohtext keinem Produkt zugeordnet ist — nach Durchgang 1
   * also immer. Gefüllt wird sie aus der Datenbank (`mappings.ts`) oder aus
   * Durchgang 2 (`assign.ts`). Bei Pfand- und Rabattzeilen bleibt sie null.
   */
  suggestion: ExtractedSuggestion | null
  /**
   * Die gedruckten Zeilen, aus denen diese Position entstanden ist.
   *
   * Sie bleiben erhalten, damit im Korrektur-Screen nachsehbar ist, welche
   * Zeile wohin geflossen ist — die beste Fehlermeldung, die sich bauen lässt,
   * wenn der Steuerklassen-Abgleich anschlägt.
   */
  sourceLines: string[]
  /**
   * Wie sicher diese Position gelesen wurde, zwischen 0 und 1.
   *
   * **Nicht vom Modell geschätzt, sondern gerechnet** (`lines.ts`). Ein Modell,
   * das je Zeile eine Zahl zwischen 0 und 1 nennen soll, bekommt fünfzig
   * zusätzliche Schätzaufgaben neben dem Abtippen — und genau solche
   * Nebenaufgaben haben die Erkennung schon zweimal verdorben. Es zeigt
   * stattdessen nur mit dem Finger auf das, was es nicht entziffern konnte; die
   * Zahl entsteht daraus und aus der Frage, wie sauber sich die Zeile zerlegen
   * ließ.
   *
   * Der Korrektur-Screen umrandet alles unter `LOW_CONFIDENCE` gelb. Nicht rot:
   * Es ist kein Fehler, sondern eine Bitte um einen zweiten Blick.
   */
  confidence: number
}

/**
 * Eine Zeile des gedruckten Steuerblocks, ohne jede Gegenrechnung.
 *
 * Sie wird getrennt von `TaxGroup` weitergereicht, weil der Korrektur-Screen
 * beides braucht: Der Abgleich unten rechnet nur, wenn jede Position ein
 * Kennzeichen trägt — die *Klassen* muss der Screen aber auch dann kennen,
 * damit sich ein fehlendes Kennzeichen von Hand nachtragen lässt.
 */
export interface PrintedTaxGroup {
  code: string
  grossCents: number
}

/**
 * Eine Steuerklasse aus dem Block am Fuß des Bons, zusammen mit dem, was die
 * Positionen dazu ergeben.
 */
export interface TaxGroup {
  /** Das Kennzeichen, wie es auf dem Bon steht: `A`, `B`, … */
  code: string
  /** Der gedruckte Bruttobetrag dieser Klasse in Cent. */
  grossCents: number
  /** Summe der Positionen mit diesem Kennzeichen — vom Code addiert. */
  itemsTotalCents: number
  /** Gedruckt minus gerechnet. 0 heißt: stimmt. */
  differenceCents: number
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
    | 'einzelpreis_verworfen'
    | 'kategorie_unbekannt'
    | 'merkmal_verworfen'
    | 'position_unvollstaendig'
    | 'steuerklasse_weicht_ab'
    | 'steuerklasse_unbekannt'
    | 'steuerblock_unstimmig'
    | 'steuer_kennzeichen_fehlt'
    // Aus Durchgang 2 (`assign.ts`). Die Struktur des Bons ist davon nicht
    // betroffen — die Beträge stimmen auch dann, wenn die Zuordnung ausfällt.
    | 'zuordnung_ausgefallen'
    | 'zuordnung_unvollstaendig'
    // Aus Durchgang 1, seit Schritt 4d: Das Abtippen selbst war lückenhaft.
    | 'zeile_nicht_zugeordnet'
    | 'zeilen_fehlen'
    /**
     * Seit Schritt 18: Die Antwort des Modells endete an der Token-Grenze und
     * wurde zu einem Teilergebnis geschlossen (`repair.ts`).
     *
     * Die wichtigste Warnung der Liste, weil sie als Einzige sagt, dass etwas
     * **fehlen könnte, ohne dass man es sieht**. Ein falscher Betrag fällt beim
     * Summenabgleich auf; eine Zeile, die nie ankam, nur hier.
     */
    | 'antwort_abgeschnitten'
    /** Seit Schritt 18: Der Bon nennt eine Postenzahl, und sie passt nicht. */
    | 'postenzahl_weicht_ab'
    /** Seit Schritt 18: Das gelesene Datum ist unplausibel (Zukunft, zu alt). */
    | 'datum_unplausibel'
    /** Seit Schritt 18: Der Händlername kann kein Händlername sein. */
    | 'haendler_unplausibel'
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
  /**
   * Der gedruckte Währungscode, oder null, wenn keiner dastand.
   *
   * **Alle Beträge in dieser Struktur sind in dieser Währung** — umgerechnet
   * wird erst beim Speichern, damit der Korrektur-Screen dieselben Zahlen zeigt
   * wie das Papier. Null heißt: kein Zeichen gelesen, also Euro.
   */
  currency: string | null
  /** Die auf dem Papier gedruckte Summe in Cent. */
  printedTotalCents: number | null
  items: ExtractedItem[]
  /** Summe aller Zeilensummen — vom Code addiert, nie vom Modell. */
  itemsTotalCents: number
  /** Gedruckte Summe minus Positionssumme. Null, wenn keine Summe gelesen wurde. */
  discrepancyCents: number | null
  /**
   * Der Abgleich je Steuerklasse. Leer, wenn kein Steuerblock lesbar war —
   * dann bleibt es beim Gesamtabgleich über `discrepancyCents`.
   */
  taxGroups: TaxGroup[]
  /**
   * Der gedruckte Steuerblock, sobald er zu sich selbst passt — auch dann,
   * wenn der Abgleich oben mangels Kennzeichen ausfällt. Der Korrektur-Screen
   * rechnet daraus bei jeder Änderung neu.
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

/* ========================================================================== */

/** Erlaubte Anzeige-Einheiten, identisch mit dem Check in der Datenbank. */
const UNITS: ExtractedUnit[] = ['kg', 'g', 'l', 'ml', 'stk']

// Exportiert, weil `assign.ts` gegen dieselben Listen prüft — zwei Aufzählungen
// derselben Werte wären zwei Wahrheiten.
export const MILK_HEATS: MilkHeat[] = ['roh', 'pasteurisiert', 'esl', 'uht', 'unbekannt']
export const MILK_HOMOGENIZED: MilkHomogenized[] = ['ja', 'nein', 'unbekannt']

/**
 * Wie weit Menge × Einzelpreis von der Zeilensumme abweichen darf, bevor es
 * auffällt. Zwei Cent, weil die Kasse selbst rundet: 1,120 kg × 1,79 €/kg sind
 * 2,0048 € und werden als 2,00 € gedruckt.
 */
const LINE_TOLERANCE_CENTS = 2

/**
 * Wie weit die Positionssumme von der gedruckten Summe abweichen darf, bevor
 * gewarnt wird.
 *
 * Bis Schritt 18 war jede Abweichung eine Warnung — auch ein einzelner Cent.
 * Der entsteht aber ganz ohne Fehler: Eine Kasse rundet bei gewichteten Waren
 * je Zeile, und die Summe der gerundeten Zeilen ist nicht immer die gerundete
 * Summe. Eine Warnung, die bei jedem zweiten Bon erscheint, liest nach kurzer
 * Zeit niemand mehr — und dann fällt auch die auf, die etwas bedeutet.
 *
 * Zwei Cent, dieselbe Größenordnung wie `LINE_TOLERANCE_CENTS`. Bei einer
 * fehlenden Zeile geht es immer um deutlich mehr.
 */
const TOTAL_TOLERANCE_CENTS = 2

/**
 * Dieselbe Toleranz, aber mitwachsend — und zwar genau um den Betrag, den das
 * Runden des Einzelpreises auf ganze Cent überhaupt erzeugen kann.
 *
 * Der Einzelpreis steht als ganze Zahl in Cent (PROJEKT.md). Ein gedruckter
 * Preis mit einer weiteren Stelle wird beim Einlesen gerundet, und dieser
 * Rundungsfehler von höchstens einem halben Cent multipliziert sich mit der
 * Menge. Bei 1,120 kg fällt das nicht auf; bei einer Tankfüllung schon:
 *
 *     38,45 L × 1,779 EUR/L = 68,41 EUR gedruckt
 *     38,45 L × 1,78  EUR/L = 68,44 EUR gerechnet
 *
 * Mit der festen Grenze von zwei Cent würde der Literpreis hier **verworfen** —
 * und die Bestpreis-Sicht verglich danach nicht mehr Literpreise, sondern
 * Tankfüllungen. Das wäre keine Vorsicht, sondern ein falsches Ergebnis.
 *
 * Die Grenze ist deshalb `Menge ÷ 2`, mindestens aber die bisherigen zwei Cent.
 * Für jede Zeile mit kleiner Menge — also für alle Supermarktbons — ändert sich
 * dadurch nichts.
 */
function lineTolerance(base: number | null, unit: ExtractedUnit | null): number {
  if (base === null || unit === null) return LINE_TOLERANCE_CENTS
  return Math.max(LINE_TOLERANCE_CENTS, Math.ceil(displayAmount(base, unit) / 2))
}

/* ========================================================== JSON herausholen */

/**
 * Das JSON aus der Modellantwort holen — und, wenn nötig, schließen.
 *
 * ---------------------------------------------------------------------------
 * GEÄNDERT MIT SCHRITT 18
 * ---------------------------------------------------------------------------
 *
 * Hier stand: „Bewusst wird nur *geschält*, nicht repariert: Fehlt eine
 * Klammer, ist die Antwort kaputt und soll das auch bleiben." Das war als
 * Strenge gemeint und war in der Praxis das Gegenteil.
 *
 * Denn es gibt zwei Arten von fehlender Klammer, und sie haben nichts
 * miteinander zu tun. Die eine ist ein Modell, das Unsinn geschrieben hat. Die
 * andere ist eine Antwort, die an `max_tokens` **abgeschnitten** wurde — und
 * die ist nicht kaputt, sondern unfertig: Die dreißig Zeilen davor sind
 * vollständig, richtig und teuer bezahlt. Der alte Code warf beide gleich weg,
 * und ein Bon mit 35 Positionen endete deshalb in „Die Antwort der Erkennung
 * war unbrauchbar", obwohl fast alles davon gelesen war.
 *
 * Das Schließen macht `repair.ts`, und es erfindet dabei nichts: Ergänzt werden
 * ausschließlich `}` und `]`, ein angebrochener Wert fällt vollständig weg.
 * Dass etwas fehlt, sieht der Nutzer am Summenabgleich — der zeigt genau
 * darauf.
 */
export function recoverModelJson(raw: string): {
  receipt: ModelReceipt | null
  /** War die Antwort unfertig und musste geschlossen werden? */
  repaired: boolean
  /** Wie viele Zeichen dabei verworfen wurden. */
  droppedChars: number
} {
  const recovered = recoverJson(raw)
  const value = recovered.value

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { receipt: null, repaired: false, droppedChars: 0 }
  }

  return {
    receipt: value as ModelReceipt,
    repaired: recovered.repaired,
    droppedChars: recovered.droppedChars,
  }
}

/**
 * Nur das Ergebnis, ohne die Begleitangaben.
 *
 * Für `assign.ts`, das Durchgang 2 prüft: Dort ist eine abgeschnittene Antwort
 * nicht schlimm — fehlt eine Zuordnung, bleibt der Rohtext stehen, und der
 * Nutzer tippt einen Namen ein. Nur bei der Struktur hängen Geldbeträge daran,
 * und nur dort wird deshalb unterschieden.
 */
export function parseModelJson(raw: string): ModelReceipt | null {
  return recoverModelJson(raw).receipt
}

/* ============================================================ kleine Helfer */

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Ein Geldbetrag als ganze Zahl in Cent.
 *
 * Verlangt ist im Prompt bereits Cent. Kommt trotzdem eine Kommazahl an, kann
 * sie keine Cent-Angabe sein — halbe Cent gibt es auf keinem Bon. Dann war Euro
 * gemeint, und es wird umgerechnet. Ein String wie "1,29" oder "1.29 EUR" wird
 * ebenfalls angenommen; das kostet nichts und fängt eine häufige Abweichung ab.
 */
export function toCents(value: unknown): number | null {
  if (isNumber(value)) {
    return Number.isInteger(value) ? value : Math.round(value * 100)
  }

  if (typeof value === 'string') {
    const stripped = value.replace(/[^\d,.-]/g, '')
    if (stripped === '' || stripped === '-') return null

    /*
     * Deutsche Zahlenschreibweise — der Punkt trennt Tausender, das Komma die
     * Nachkommastellen. „1.234,56" sind eintausendzweihundertvierunddreißig
     * Euro und sechsundfünfzig Cent.
     *
     * Die alte Fassung ersetzte schlicht das erste Komma durch einen Punkt und
     * ließ den Tausenderpunkt stehen: Aus „1.234,56" wurde „1.234.56", und
     * `Number` gibt darauf NaN zurück — der Betrag fiel ersatzlos weg. Auf
     * einem Baumarktbon mit vierstelliger Summe ist das kein Randfall.
     *
     * Die Regel, die beide Fälle abdeckt: **Das letzte Trennzeichen ist das
     * Dezimaltrennzeichen**, alle davor sind Tausendertrennzeichen. Das gilt
     * für „1.234,56" ebenso wie für „1,234.56", und es gilt auch für „1,29"
     * und „1.29" — dort gibt es nur eines.
     */
    const lastComma = stripped.lastIndexOf(',')
    const lastDot = stripped.lastIndexOf('.')
    const decimal = Math.max(lastComma, lastDot)

    const cleaned =
      decimal === -1
        ? stripped
        : `${stripped.slice(0, decimal).replace(/[.,]/g, '')}.${stripped.slice(decimal + 1)}`

    const parsed = Number(cleaned)
    if (!Number.isFinite(parsed)) return null
    // Ein Trennzeichen im Text heißt: da stand ein Euro-Betrag, keine Cent-Zahl.
    return decimal === -1 ? parsed : Math.round(parsed * 100)
  }

  return null
}

function toUnit(value: unknown): ExtractedUnit | null {
  const raw = text(value)?.toLowerCase()
  if (!raw) return null
  // "Stk", "stück", "st" meinen alle dasselbe.
  if (raw.startsWith('st')) return 'stk'
  return UNITS.includes(raw as ExtractedUnit) ? (raw as ExtractedUnit) : null
}

/**
 * Das Steuerkennzeichen einer Zeile oder einer Steuerblock-Zeile.
 *
 * Zugelassen sind ein bis zwei Buchstaben oder Ziffern — `A`, `B`, `1`, `2`,
 * gelegentlich `AW`. Alles andere ist keins: Damit fällt insbesondere die
 * `Gesamtbetrag`-Zeile aus dem Steuerblock von selbst heraus, ohne dass es dafür
 * eine Sonderregel bräuchte.
 */
function toTaxCode(value: unknown): string | null {
  const raw = text(value)?.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!raw) return null
  return /^[A-Z0-9]{1,2}$/.test(raw) ? raw : null
}

function toKind(value: unknown): ItemKind {
  const raw = text(value)?.toLowerCase()
  if (raw === 'pfand') return 'pfand'
  if (raw === 'rabatt') return 'rabatt'
  return 'artikel'
}

/** Ein ISO-Datum, das es auch wirklich gibt — der 31.02. fällt hier durch. */
function toIsoDate(value: unknown): string | null {
  const raw = text(value)
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? raw : null
}

/**
 * Das gedruckte Währungszeichen als ISO-Code.
 *
 * Auf einem Bon steht selten der saubere Code: „Fr.", „SFr.", „€" sind
 * dasselbe wie „CHF" beziehungsweise „EUR". Die Liste ist bewusst kurz und
 * enthält nur, was an der deutsch-schweizerischen Grenze tatsächlich über den
 * Tisch geht — alles Weitere muss als Dreibuchstaben-Code dastehen.
 *
 * **Nicht geraten wird auch hier:** Steht nichts da, kommt null zurück, und der
 * Bon gilt als Euro-Bon. Ein aus der Anschrift erschlossenes „CHF" wäre die
 * Sorte plausibler Fehler, die niemand bemerkt — und die jede Monatssumme um
 * sieben Prozent verschöbe.
 */
export function toCurrency(value: unknown): string | null {
  const raw = text(value)
  if (raw === null) return null

  const cleaned = raw.toUpperCase().replace(/[^A-Z€$£]/g, '')
  const known: Record<string, string> = {
    '€': 'EUR',
    EUR: 'EUR',
    EURO: 'EUR',
    FR: 'CHF',
    SFR: 'CHF',
    CHF: 'CHF',
    $: 'USD',
    USD: 'USD',
    '£': 'GBP',
    GBP: 'GBP',
  }
  if (known[cleaned]) return known[cleaned]

  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : null
}

function toTime(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

/* ====================================================== Menge und Zeilenprobe */

/**
 * Die Menge in der Anzeige-Einheit — also das, was auf dem Bon steht.
 *
 * Intern ist eine Menge immer eine ganze Zahl in der kleinsten Einheit: 1,120 kg
 * liegen als 1120 (Gramm) da. Für die Rechnung „Menge × Preis je Kilo" muss
 * daraus wieder 1,12 werden.
 */
function displayAmount(base: number, unit: ExtractedUnit): number {
  return unit === 'kg' || unit === 'l' ? base / 1000 : base
}

interface QuantityResult {
  base: number | null
  unit: ExtractedUnit | null
  warnings: ExtractionWarning[]
}

/**
 * Menge und Einheit prüfen, umrechnen und gegen die Zeilensumme gegenprüfen.
 *
 * Zwei Umrechnungen sind möglich, beide belegbar und keine davon geraten:
 *
 *  1. **Kommazahl statt Basiseinheit.** Kommt `1.12` mit Einheit `kg`, kann das
 *     keine Grammzahl sein (1,12 Gramm gibt es auf keinem Bon), also war
 *     1,12 kg gemeint → 1120.
 *  2. **Ganze Zahl in der falschen Einheit.** Kommt `2` mit Einheit `kg`, sind
 *     entweder 2 Gramm oder 2 Kilo gemeint. Entschieden wird das nicht nach
 *     Gefühl, sondern per Rechnung: Nur wenn Menge × Einzelpreis mit der
 *     *einen* Lesart die gedruckte Zeilensumme ergibt und mit der anderen
 *     nicht, wird umgestellt.
 *
 * Geht keine Lesart auf, bleibt der gelieferte Wert stehen — die Zeile fällt
 * dann bei `checkUnitPrice` weiter unten auf. Raten ist auch dem Code verboten.
 */
function resolveQuantity(
  rawAmount: unknown,
  rawUnit: unknown,
  unitPriceCents: number | null,
  totalCents: number | null,
  lineNo: number,
): QuantityResult {
  const unit = toUnit(rawUnit)
  const warnings: ExtractionWarning[] = []

  let amount: number | null = null
  if (isNumber(rawAmount)) amount = rawAmount
  else if (typeof rawAmount === 'string') {
    const parsed = Number(rawAmount.replace(',', '.').replace(/[^\d.-]/g, ''))
    if (Number.isFinite(parsed)) amount = parsed
  }

  // Ohne beides ist es „ohne Mengenangabe" — ein echter Zustand, kein Fehler.
  if (amount === null || amount <= 0 || unit === null) {
    return { base: null, unit: null, warnings }
  }

  let base = amount
  if (!Number.isInteger(base)) {
    // Fall 1: Kommazahl. Bei kg und l ist die Basiseinheit tausendmal kleiner.
    base = unit === 'kg' || unit === 'l' ? Math.round(base * 1000) : Math.round(base)
    warnings.push({
      code: 'menge_umgerechnet',
      lineNo,
      message: `Zeile ${lineNo}: Menge wurde in ${unit === 'kg' ? 'Gramm' : unit === 'l' ? 'Milliliter' : 'ganze Einheiten'} umgerechnet.`,
    })
  }

  // Fall 2: Gegenprobe, sofern es überhaupt etwas zu prüfen gibt.
  if (unitPriceCents !== null && totalCents !== null && totalCents !== 0) {
    const asGiven = Math.round(displayAmount(base, unit) * unitPriceCents)
    const fits = Math.abs(asGiven - totalCents) <= lineTolerance(base, unit)

    if (!fits && (unit === 'kg' || unit === 'l')) {
      const scaled = base * 1000
      const asScaled = Math.round(displayAmount(scaled, unit) * unitPriceCents)
      if (Math.abs(asScaled - totalCents) <= lineTolerance(scaled, unit)) {
        warnings.push({
          code: 'menge_umgerechnet',
          lineNo,
          message: `Zeile ${lineNo}: Menge als ${unit} gelesen und in die Basiseinheit umgerechnet.`,
        })
        return { base: scaled, unit, warnings }
      }
    }

  }

  return { base, unit, warnings }
}

/**
 * Passt der Einzelpreis überhaupt zu dieser Zeile?
 *
 * **Warum das nötig ist.** Auf einem REWE-Bon steht die Mengenzeile eingerückt
 * *unter* dem Artikelnamen:
 *
 *     SPRUEHSAHNE 30%
 *       2 Stk x   0,99          1,98 B
 *     VANILLE MILCHSCHOKOSTR    1,99 B
 *
 * Das Modell hat die 0,99 schon einmal an die *folgende* Position gehängt — die
 * Vanilleschokolade bekam einen Einzelpreis von 0,99 € bei einer Zeilensumme von
 * 1,99 €. Der Prompt sagt inzwischen ausdrücklich, dass eine Mengenzeile zur
 * Position darüber gehört; verlassen sollte man sich darauf trotzdem nicht.
 *
 * Die Rechnung entlarvt so eine Verschiebung zuverlässig, denn sie geht dann
 * nicht auf:
 *
 *   * **mit Menge:** Menge × Einzelpreis muss die Zeilensumme ergeben.
 *   * **ohne Menge:** Dann *ist* der Einzelpreis die Zeilensumme. Etwas anderes
 *     kann er gar nicht sein — genau das war der Fehler oben.
 *
 * Stimmt es nicht, wird der Einzelpreis **verworfen** statt weitergereicht. Er
 * ist der unsicherste der drei Werte, und er ist der einzige, der sich zur Not
 * aus Menge und Zeilensumme zurückrechnen lässt. Menge und Zeilensumme bleiben
 * unangetastet: Welcher der Werte der falsche ist, weiß hier niemand, und ein
 * fehlender Wert ist besser als ein falscher (PROJEKT.md).
 *
 * Pfand- und Rabattzeilen sind ausgenommen. „2 Stück × Einzelpreis" ist bei
 * einem Aktionsrabatt keine sinnvolle Rechnung, und eine Warnung dazu wäre nur
 * Rauschen.
 */
function checkUnitPrice(
  kind: ItemKind,
  base: number | null,
  unit: ExtractedUnit | null,
  unitPriceCents: number | null,
  totalCents: number,
  lineNo: number,
): { unitPriceCents: number | null; warnings: ExtractionWarning[] } {
  const keep = { unitPriceCents, warnings: [] as ExtractionWarning[] }

  if (kind !== 'artikel' || unitPriceCents === null) return keep
  // Eine Nullzeile sagt über den Einzelpreis nichts aus.
  if (totalCents === 0) return keep

  const expected =
    base !== null && unit !== null
      ? Math.round(displayAmount(base, unit) * unitPriceCents)
      : unitPriceCents

  if (Math.abs(expected - totalCents) <= lineTolerance(base, unit)) return keep

  return {
    unitPriceCents: null,
    warnings: [
      {
        code: 'einzelpreis_verworfen',
        lineNo,
        message:
          base === null
            ? `Zeile ${lineNo}: Der Einzelpreis passt nicht zur Zeilensumme und stammt vermutlich aus einer anderen Zeile — verworfen. Menge und Betrag bitte prüfen.`
            : `Zeile ${lineNo}: Menge × Einzelpreis ergibt nicht die Zeilensumme — Einzelpreis verworfen. Menge und Betrag bitte prüfen.`,
      },
    ],
  }
}

/* ============================================================ Der Steuerblock */

/**
 * Abgleich je Steuerklasse — die schärfere Probe.
 *
 * Deutsche Bons drucken am Fuß eine Aufstellung je Steuersatz, und dieselben
 * Kennzeichen stehen an jeder Position:
 *
 *     Steuer %      Netto   Steuer   Brutto
 *     A= 19,0%       1,34     0,25     1,59
 *     B=  7,0%       4,64     0,32     4,96
 *     Gesamtbetrag   5,98     0,57     6,55
 *
 * **Warum das besser ist als der Gesamtabgleich:** Der sagt nur *dass* etwas
 * fehlt, dieser sagt *wo*. Als das Modell zwei getrennte Artikel („VANILLE"
 * 1,99 € und „MILCHSCHOKOSTR" 0,99 €) zu einem zusammenzog, war Klasse A
 * korrekt und in Klasse B fehlten genau 0,99 € — damit ist die Zeile, an der man
 * nachsehen muss, sofort eingegrenzt.
 *
 * Zwei Tore davor, damit die Probe nicht selbst Unsinn meldet:
 *
 *   1. **Der Block muss zu sich selbst passen.** Ergeben die Bruttobeträge
 *      zusammen nicht die gedruckte Gesamtsumme, wurde der Block falsch
 *      gelesen. Dann ist er als Maßstab untauglich und es bleibt beim
 *      Gesamtabgleich.
 *   2. **Jede Position braucht ein Kennzeichen.** Fehlt eines, wäre jede Klasse
 *      zu niedrig und es hagelte Warnungen, die nur ein einziges nicht
 *      gelesenes Kennzeichen bedeuten.
 *
 * Ohne Steuerblock passiert hier gar nichts — dann bleibt es beim
 * Gesamtabgleich, so wie bisher.
 */
function checkTaxGroups(
  items: ExtractedItem[],
  rawBlock: unknown,
  printedTotalCents: number | null,
): { groups: TaxGroup[]; printed: PrintedTaxGroup[]; warnings: ExtractionWarning[] } {
  const warnings: ExtractionWarning[] = []
  const entries = Array.isArray(rawBlock) ? rawBlock : []

  // Gedruckte Bruttobeträge je Kennzeichen. Das erste Vorkommen gewinnt.
  const gross = new Map<string, number>()
  for (const entry of entries) {
    const row = (entry ?? {}) as ModelTaxGroup
    const code = toTaxCode(row.kennzeichen)
    const cents = toCents(row.brutto_cent)
    if (code === null || cents === null || gross.has(code)) continue
    gross.set(code, cents)
  }

  if (gross.size === 0) return { groups: [], printed: [], warnings }

  // Tor 1: Passt der Block zur gedruckten Gesamtsumme?
  const blockTotal = [...gross.values()].reduce((sum, cents) => sum + cents, 0)
  if (printedTotalCents !== null && blockTotal !== printedTotalCents) {
    warnings.push({
      code: 'steuerblock_unstimmig',
      message:
        `Der Steuerblock ergibt ${euro(blockTotal)}, gedruckt sind ${euro(printedTotalCents)} — ` +
        'er wurde vermutlich falsch gelesen. Der Abgleich je Steuerklasse entfällt.',
    })
    return { groups: [], printed: [], warnings }
  }

  const printed: PrintedTaxGroup[] = [...gross.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, grossCents]) => ({ code, grossCents }))

  // Tor 2: Trägt jede Position ein Kennzeichen?
  if (items.some((item) => item.taxCode === null)) {
    warnings.push({
      code: 'steuer_kennzeichen_fehlt',
      message:
        'Nicht jede Position trägt ein Steuerkennzeichen — der genauere Abgleich je ' +
        'Steuerklasse entfällt. Es bleibt beim Abgleich über die Gesamtsumme. Trag das ' +
        'Kennzeichen an der Position nach, dann rechnet der Abgleich mit.',
    })
    return { groups: [], printed, warnings }
  }

  const sums = new Map<string, number>()
  for (const item of items) {
    const code = item.taxCode as string
    sums.set(code, (sums.get(code) ?? 0) + item.totalCents)
  }

  // Ein Kennzeichen an einer Position, das im Block fehlt: Dann stimmt eines von
  // beidem nicht, und diese Positionen tauchen in keiner Klasse auf.
  for (const code of sums.keys()) {
    if (gross.has(code)) continue
    warnings.push({
      code: 'steuerklasse_unbekannt',
      message:
        `Das Steuerkennzeichen „${code}" steht an mindestens einer Position, aber nicht im ` +
        'Steuerblock. Bitte prüfen.',
    })
  }

  const groups: TaxGroup[] = printed.map(({ code, grossCents }) => {
    const itemsTotalCents = sums.get(code) ?? 0
    return {
      code,
      grossCents,
      itemsTotalCents,
      differenceCents: grossCents - itemsTotalCents,
    }
  })

  for (const group of groups) {
    if (group.differenceCents === 0) continue
    const missing = group.differenceCents > 0
    warnings.push({
      code: 'steuerklasse_weicht_ab',
      message:
        `Steuerklasse ${group.code}: Die Positionen ergeben ${euro(group.itemsTotalCents)}, ` +
        `gedruckt sind ${euro(group.grossCents)} — ${euro(Math.abs(group.differenceCents))} ` +
        `${missing ? 'fehlen' : 'zu viel'}. Dort bitte nachsehen.`,
    })
  }

  return { groups, printed, warnings }
}

/* ================================================================ Positionen */

function resolveItem(
  raw: ModelItem,
  lineNo: number,
  warnings: ExtractionWarning[],
  sourceLines: string[] = [],
): ExtractedItem {
  const kind = toKind(raw.art)
  const rawText = text(raw.rohtext)

  if (rawText === null) {
    warnings.push({
      code: 'position_unvollstaendig',
      lineNo,
      message: `Zeile ${lineNo}: Kein Text vom Bon gelesen.`,
    })
  }

  const rawUnitPriceCents = toCents(raw.einzelpreis_cent)
  let totalCents = toCents(raw.zeilensumme_cent)

  if (totalCents === null) {
    warnings.push({
      code: 'betrag_fehlt',
      lineNo,
      message: `Zeile ${lineNo}: Betrag war nicht lesbar und wurde auf 0,00 € gesetzt.`,
    })
    totalCents = 0
  }

  /*
   * Ein Rabatt ist per Definition ein Abzug. Liefert das Modell ihn positiv,
   * wird das Vorzeichen gedreht — das ist keine Schätzung, sondern die
   * Anwendung der Definition. Ohne das ginge die Summenprobe unten schief.
   */
  if (kind === 'rabatt') totalCents = -Math.abs(totalCents)

  const quantity = resolveQuantity(raw.menge, raw.einheit, rawUnitPriceCents, totalCents, lineNo)
  warnings.push(...quantity.warnings)

  // Erst nach dem Umrechnen prüfen: Die Gegenprobe soll gegen die *bereinigte*
  // Menge laufen, sonst würde eine erfolgreich korrigierte Zeile trotzdem
  // auffallen.
  const price = checkUnitPrice(kind, quantity.base, quantity.unit, rawUnitPriceCents, totalCents, lineNo)
  warnings.push(...price.warnings)

  /*
   * Die Konfidenz dieser Position.
   *
   * Sie beginnt bei dem, was `lines.ts` aus der gedruckten Zeile ablesen konnte
   * (siehe `konfidenz` dort), und sinkt hier weiter, sobald eine der Prüfungen
   * angeschlagen hat. Das ist der Punkt: Beide Quellen wissen etwas anderes.
   * `lines.ts` sieht, ob sich die Zeile sauber zerlegen ließ; hier steht,
   * ob die Zahlen darin zueinander passen.
   *
   * Multiplikativ und nicht additiv, damit zwei Auffälligkeiten zusammen tiefer
   * ziehen als eine — und der Wert trotzdem nie unter 0 fällt.
   */
  let confidence = typeof raw.konfidenz === 'number' ? raw.konfidenz : 1
  if (rawText === null) confidence *= 0.3
  if (price.warnings.length > 0) confidence *= 0.6
  if (quantity.warnings.length > 0) confidence *= 0.8

  return {
    lineNo,
    rawText: rawText ?? '(kein Text erkannt)',
    kind,
    quantityBase: quantity.base,
    quantityUnit: quantity.unit,
    unitPriceCents: price.unitPriceCents,
    totalCents,
    // Beide Felder sind in der Datenbank auf „nicht negativ" geprüft, deshalb
    // steht hier der Betrag und im Vorzeichen von totalCents die Richtung.
    depositCents: kind === 'pfand' ? Math.abs(totalCents) : 0,
    discountCents: kind === 'rabatt' ? Math.abs(totalCents) : 0,
    taxCode: toTaxCode(raw.steuer),
    // Zugeordnet wird später — aus der Datenbank oder in Durchgang 2. Pfand und
    // Rabatt sind keine Produkte und bleiben ohne Zuordnung.
    suggestion: null,
    sourceLines,
    confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100,
  }
}

/* ============================================================== Der ganze Bon */

/**
 * Aus der geprüften Modellantwort wird das Ergebnis, mit dem die App arbeitet.
 *
 * Ohne Zusatzangaben: Struktur hat mit den Merkmalen des Haushalts nichts zu
 * tun. Seit Schritt 4c braucht diese Funktion deshalb keinen Kontext mehr —
 * was der Nutzer in den Einstellungen ändert, kann das Abschreiben eines Bons
 * nicht mehr beeinflussen.
 *
 * Der Rückgabewert ist immer vollständig: Auch ein Bon voller Warnungen kommt
 * als `Extraction` zurück. Abgelehnt wird nur in `index.ts`, und zwar nur, wenn
 * das Modell selbst sagt, dass es nichts lesen konnte.
 */
export function validateExtraction(
  model: ModelReceipt,
  /**
   * Der heutige Tag als `JJJJ-MM-TT` — nur für die Datumsprüfung.
   *
   * Als Parameter und nicht als `new Date()` mitten in der Funktion: Sonst
   * hinge das Ergebnis am Kalender des Servers, und der Test daneben würde ab
   * einem bestimmten Datum von selbst rot. Eine reine Funktion bleibt eine
   * reine Funktion.
   */
  today: string = new Date().toISOString().slice(0, 10),
): Extraction {
  const warnings: ExtractionWarning[] = []

  /*
   * Seit Schritt 4d kommt aus dem Modell eine Liste **abgetippter Zeilen**, und
   * was davon eine Position ist, entscheidet `lines.ts`. Der alte Weg über
   * fertige `positionen` bleibt als Rückfallebene stehen — er kostet drei
   * Zeilen und fängt eine Antwort ab, die noch der alten Form folgt.
   */
  const lines = Array.isArray(model.zeilen)
    ? model.zeilen.filter((line): line is string => typeof line === 'string')
    : []

  const parsed = lines.length > 0 ? parseLines(lines, model.unsichere_zeilen) : null
  const rawItems: Array<{ item: ModelItem; sourceLines: string[] }> = parsed
    ? parsed.items.map((item) => ({ item, sourceLines: item.sourceLines }))
    : (Array.isArray(model.positionen) ? model.positionen : []).map((entry) => ({
        item: (entry ?? {}) as ModelItem,
        sourceLines: [],
      }))

  /*
   * Neu durchnummeriert statt die Nummern des Modells zu übernehmen: In der
   * Datenbank ist (receipt_id, line_no) eindeutig, und ein Modell, das zweimal
   * „3" schreibt, würde das Speichern in 4b-2 zum Scheitern bringen.
   */
  const items = rawItems.map((entry, index) =>
    resolveItem(entry.item, index + 1, warnings, entry.sourceLines),
  )

  /*
   * Gesammelt in einer Meldung statt eine je Zeile: Auf einem Bon mit Fußtext
   * wären das schnell fünf gleichlautende Warnungen, und die Zeilen selbst
   * stehen ohnehin im Aufklappbereich „Abgetippte Zeilen".
   */
  const unassignedLines = parsed?.unassigned ?? []
  if (unassignedLines.length > 0) {
    warnings.push({
      code: 'zeile_nicht_zugeordnet',
      message:
        `${unassignedLines.length} abgetippte ${unassignedLines.length === 1 ? 'Zeile trug' : 'Zeilen trugen'} ` +
        `keinen Betrag und ${unassignedLines.length === 1 ? 'wurde' : 'wurden'} keine Position: ` +
        `„${unassignedLines.join('", „')}".`,
    })
  }

  const itemsTotalCents = items.reduce((sum, item) => sum + item.totalCents, 0)
  const printedTotalCents = toCents(model.summe_cent)
  const merchantName = text(model.haendler)
  const purchasedOn = toIsoDate(model.datum)

  if (merchantName === null) {
    warnings.push({ code: 'haendler_fehlt', message: 'Kein Händler erkannt.' })
  }
  if (purchasedOn === null) {
    warnings.push({ code: 'datum_fehlt', message: 'Kein Datum erkannt.' })
  }

  let discrepancyCents: number | null = null
  if (printedTotalCents === null) {
    warnings.push({
      code: 'summe_fehlt',
      message: 'Die gedruckte Gesamtsumme war nicht lesbar — der Abgleich entfällt.',
    })
  } else {
    discrepancyCents = printedTotalCents - itemsTotalCents
    if (Math.abs(discrepancyCents) > TOTAL_TOLERANCE_CENTS) {
      warnings.push({
        code: 'summe_weicht_ab',
        message: `Die Positionen ergeben ${euro(itemsTotalCents)}, gedruckt sind ${euro(printedTotalCents)} — ${euro(Math.abs(discrepancyCents))} Unterschied.`,
      })

      /*
       * Seit Schritt 4d ist diese Aussage möglich — und sie ist die
       * nützlichste im ganzen Screen: Die Positionen entstehen im Code aus den
       * abgetippten Zeilen, und dabei geht kein Betrag verloren. Fehlt also
       * etwas, dann schon beim **Abtippen**. Der Nutzer weiß damit sofort, dass
       * es am Lesen liegt und nicht am Deuten — und dass ein besseres Foto oder
       * ein größeres Modell hilft, kein Prompt-Satz.
       */
      if (parsed) {
        warnings.push({
          code: 'zeilen_fehlen',
          message:
            `Aufgeteilt wurden ${lines.length} abgetippte Zeilen zu ${items.length} ` +
            `${items.length === 1 ? 'Position' : 'Positionen'} — dabei geht kein Betrag ` +
            'verloren, das rechnet die App selbst. Der Unterschied entsteht also schon beim ' +
            'Abtippen: Mindestens eine gedruckte Zeile hat das Modell nicht gelesen. Sieh unter ' +
            '„Abgetippte Zeilen" nach, welche fehlt, und ergänze sie von Hand.',
        })
      }
    }
  }

  // Nach dem Gesamtabgleich, nicht davor: Die Warnung „es fehlen 0,99 €" gehört
  // gelesen, bevor steht, in welcher Steuerklasse sie fehlen.
  const tax = checkTaxGroups(items, model.steuerblock, printedTotalCents)
  warnings.push(...tax.warnings)

  warnings.push(...checkPostenCount(model.posten, items))
  warnings.push(...checkDate(purchasedOn, today))
  warnings.push(...checkMerchant(merchantName))

  return {
    merchantName,
    purchasedOn,
    purchasedAt: toTime(model.uhrzeit),
    currency: toCurrency(model.waehrung),
    printedTotalCents,
    items,
    itemsTotalCents,
    discrepancyCents,
    taxGroups: tax.groups,
    printedTaxGroups: tax.printed,
    lines,
    unassignedLines,
    warnings,
  }
}


/* ================================================ Plausibilität (Schritt 18) */

/**
 * Die gedruckte Postenzahl gegen die erkannten Positionen halten.
 *
 * Viele Bons nennen sie am Fuß („Posten: 35"). Das ist die einzige Angabe auf
 * dem Papier, die sagt, wie viele Zeilen es geben **müsste** — und damit die
 * einzige Möglichkeit, eine fehlende Zeile zu bemerken, deren Betrag zufällig
 * klein genug ist, um im Summenabgleich unterzugehen.
 *
 * **Gewarnt, nicht abgelehnt**, und mit Absicht großzügig: Was eine Kasse als
 * „Posten" zählt, ist nicht einheitlich — mal zählt eine Pfandzeile mit, mal
 * nicht, mal zählt „2 Stk" als ein Posten und mal als zwei. Deshalb wird
 * gemeldet, was gezählt wurde, und die Entscheidung dem Nutzer überlassen.
 */
function checkPostenCount(raw: unknown, items: ExtractedItem[]): ExtractionWarning[] {
  const printed = typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null
  if (printed === null) return []

  // Rabattzeilen sind Abzüge auf einen anderen Posten und keine eigenen.
  const counted = items.filter((item) => item.kind !== 'rabatt').length
  if (counted === printed) return []

  return [
    {
      code: 'postenzahl_weicht_ab',
      message:
        `Der Bon nennt ${printed} ${printed === 1 ? 'Posten' : 'Posten'}, erkannt wurden ` +
        `${counted}. ${
          counted < printed
            ? 'Es fehlt wahrscheinlich mindestens eine Zeile — bitte mit dem Papier abgleichen.'
            : 'Möglicherweise wurde eine Zeile doppelt gelesen.'
        }`,
    },
  ]
}

/**
 * Ist das gelesene Datum plausibel?
 *
 * Zwei Fälle, und beide kommen von einer verlesenen Ziffer:
 *
 *   * **Zukunft.** Ein Einkauf, der noch nicht stattgefunden hat, ist keiner.
 *     Aus „16.07.2026" wird schnell „16.07.2028".
 *   * **Zu lange her.** Aus „25" wird „05", und der Bon landet zwanzig Jahre
 *     in der Vergangenheit — mitten in den Auswertungen, wo ihn niemand sucht.
 *
 * Ein Tag Nachsicht in die Zukunft: Zeitzonen und ein Einkauf um 23:50 Uhr
 * ergeben sonst Fehlalarm.
 */
function checkDate(purchasedOn: string | null, today: string): ExtractionWarning[] {
  if (purchasedOn === null) return []

  const bon = Date.parse(`${purchasedOn}T12:00:00Z`)
  const now = Date.parse(`${today}T12:00:00Z`)
  if (!Number.isFinite(bon) || !Number.isFinite(now)) return []

  const days = (bon - now) / 86_400_000

  if (days > 1) {
    return [
      {
        code: 'datum_unplausibel',
        message: `Das gelesene Datum (${purchasedOn}) liegt in der Zukunft. Bitte prüfen.`,
      },
    ]
  }

  if (days < -365 * 2) {
    return [
      {
        code: 'datum_unplausibel',
        message: `Das gelesene Datum (${purchasedOn}) liegt mehr als zwei Jahre zurück. Bitte prüfen.`,
      },
    ]
  }

  return []
}

/**
 * Sieht der Händlername nach einem Händlernamen aus?
 *
 * Nur zwei sehr grobe Prüfungen, und das ist Absicht: Läden heißen „E center",
 * „NP", „ALDI SÜD Fil. 4711" und alles dazwischen. Wer hier streng prüft,
 * verwirft mehr richtige Namen als falsche.
 *
 * Gemeldet wird deshalb nur, was gar kein Name sein **kann**: eine reine
 * Zahlenfolge (fast immer eine verlesene Steuer- oder Filialnummer aus dem
 * Bonkopf) und ein Text in Satzlänge (dann hat das Modell die Anschrift
 * mitgenommen).
 *
 * **Die Anschrift selbst wird nicht geprüft**, weil sie gar nicht erst erfasst
 * wird: Der Struktur-Prompt fragt bewusst nur nach dem Namen. Jede zusätzliche
 * Frage konkurriert mit dem Abschreiben, und die Anschrift trägt zur
 * Auswertung nichts bei — Händler werden über `merchant_key()` zusammengeführt,
 * nicht über ihre Straße.
 */
function checkMerchant(merchantName: string | null): ExtractionWarning[] {
  if (merchantName === null) return []

  if (/^[\d\s.\-/]+$/.test(merchantName)) {
    return [
      {
        code: 'haendler_unplausibel',
        message: `Als Händler wurde „${merchantName}" gelesen — das sieht nach einer Nummer aus dem Bonkopf aus. Bitte prüfen.`,
      },
    ]
  }

  if (merchantName.length > 60) {
    return [
      {
        code: 'haendler_unplausibel',
        message: 'Der gelesene Händlername ist ungewöhnlich lang — vermutlich ist die Anschrift mit hineingeraten. Bitte prüfen.',
      },
    ]
  }

  return []
}

/**
 * Cent als deutscher Eurobetrag, nur für die Warntexte.
 *
 * Bewusst von Hand statt über `Intl`: Die Warnung entsteht auf dem Server, und
 * dessen Spracheinstellung ist nichts, worauf man sich verlassen sollte.
 */
function euro(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, '0')} €`
}

/** Sagt das Modell selbst, dass es nichts lesen konnte? */
export function isUnreadable(model: ModelReceipt): boolean {
  return model.lesbar === false
}
