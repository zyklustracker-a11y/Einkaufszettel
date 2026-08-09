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
  summe_cent?: unknown
  /**
   * Die abgetippten Zeilen des Artikelbereichs — seit Schritt 4d der Weg, auf
   * dem Positionen entstehen. Was davon eine Position ist, entscheidet
   * `lines.ts` und nicht mehr das Modell.
   */
  zeilen?: unknown
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

/* ========================================================== JSON herausholen */

/**
 * Das JSON aus der Modellantwort schälen.
 *
 * Trotz aller Anweisungen schreiben Modelle gern noch „Hier ist das Ergebnis:"
 * davor oder packen alles in einen ```json-Block. Beides wird hier entfernt.
 * Bewusst wird nur *geschält*, nicht repariert: Fehlt eine Klammer, ist die
 * Antwort kaputt und soll das auch bleiben — der Nutzer sieht dann den Rohtext
 * im Aufklappbereich und kann den Prompt nachschärfen.
 */
export function parseModelJson(raw: string): ModelReceipt | null {
  const withoutFences = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(withoutFences.slice(start, end + 1))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ModelReceipt
  } catch {
    return null
  }
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
    const cleaned = value.replace(/[^\d,.-]/g, '').replace(',', '.')
    if (cleaned === '' || cleaned === '-') return null
    const parsed = Number(cleaned)
    if (!Number.isFinite(parsed)) return null
    // Ein Komma im Text heißt: da stand ein Euro-Betrag.
    return cleaned.includes('.') ? Math.round(parsed * 100) : parsed
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
    const fits = Math.abs(asGiven - totalCents) <= LINE_TOLERANCE_CENTS

    if (!fits && (unit === 'kg' || unit === 'l')) {
      const scaled = base * 1000
      const asScaled = Math.round(displayAmount(scaled, unit) * unitPriceCents)
      if (Math.abs(asScaled - totalCents) <= LINE_TOLERANCE_CENTS) {
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

  if (Math.abs(expected - totalCents) <= LINE_TOLERANCE_CENTS) return keep

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
export function validateExtraction(model: ModelReceipt): Extraction {
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

  const parsed = lines.length > 0 ? parseLines(lines) : null
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
    if (discrepancyCents !== 0) {
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

  return {
    merchantName,
    purchasedOn,
    purchasedAt: toTime(model.uhrzeit),
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
