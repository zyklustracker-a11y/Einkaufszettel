/**
 * Prüfen und Umrechnen — der Teil, der dem Modell nicht glaubt.
 *
 * PROJEKT.md: „Die Modellantwort wird nie ungeprüft gespeichert." Deshalb
 * passiert hier alles, was sich ohne Modell entscheiden lässt:
 *
 *   * Ist überhaupt JSON angekommen, und hat es die erwartete Form?
 *   * Sind Beträge ganze Zahlen in Cent? Sind Mengen ganze Basiseinheiten?
 *     Wenn nicht, wird umgerechnet statt abgelehnt.
 *   * Passt Menge × Einzelpreis zur Zeilensumme?
 *   * Passt die Summe der Positionen zur gedruckten Gesamtsumme?
 *   * Kennt der Haushalt die genannte Kategorie und die Merkmale?
 *
 * Grundhaltung überall: **markieren, nicht ablehnen**. Ein Bon mit einer
 * krummen Zeile ist immer noch ein brauchbarer Bon — der Korrektur-Screen zeigt
 * die Warnung, und der Nutzer entscheidet. Abgelehnt wird nur, was gar nicht
 * lesbar ist.
 *
 * Die Datei ist bewusst frei von Netzwerk- und Datenbankzugriffen: reine
 * Funktionen, die aus Eingabe Ausgabe machen.
 */

import type {
  Extraction,
  ExtractedItem,
  ExtractedSuggestion,
  ExtractedUnit,
  ExtractionWarning,
  ItemKind,
  MilkHeat,
  MilkHomogenized,
  ModelItem,
  ModelReceipt,
} from './schema.ts'

/** Erlaubte Anzeige-Einheiten, identisch mit dem Check in der Datenbank. */
const UNITS: ExtractedUnit[] = ['kg', 'g', 'l', 'ml', 'stk']

const MILK_HEATS: MilkHeat[] = ['roh', 'pasteurisiert', 'esl', 'uht', 'unbekannt']
const MILK_HOMOGENIZED: MilkHomogenized[] = ['ja', 'nein', 'unbekannt']

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
 * Geht keine Lesart auf, bleibt der gelieferte Wert stehen und die Zeile
 * bekommt eine Warnung. Raten ist auch dem Code verboten.
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

    if (!fits) {
      warnings.push({
        code: 'menge_unplausibel',
        lineNo,
        message: `Zeile ${lineNo}: Menge × Einzelpreis ergibt nicht die gelesene Zeilensumme. Bitte prüfen.`,
      })
    }
  }

  return { base, unit, warnings }
}

/* ============================================================== Der Vorschlag */

/**
 * Klarname, Kategorie und Merkmale — jeweils gegen die Datenbank geprüft.
 *
 * Der springende Punkt aus PROJEKT.md: Merkmalsschlüssel, die nicht in der Liste
 * des Haushalts stehen, werden **verworfen**, nicht angelegt. Damit kann ein
 * halluziniertes Merkmal nie in die Auswertung geraten. Dasselbe gilt für
 * Kategorien.
 */
function resolveSuggestion(
  raw: ModelItem['vorschlag'],
  lineNo: number,
  categoryKeys: Set<string>,
  traitKeys: Set<string>,
  warnings: ExtractionWarning[],
): ExtractedSuggestion | null {
  if (!raw || typeof raw !== 'object') return null

  const categoryRaw = text(raw.kategorie)
  let categoryKey: string | null = null
  if (categoryRaw !== null) {
    if (categoryKeys.has(categoryRaw)) categoryKey = categoryRaw
    else {
      warnings.push({
        code: 'kategorie_unbekannt',
        lineNo,
        message: `Zeile ${lineNo}: Vorgeschlagene Kategorie „${categoryRaw}" gibt es nicht — Kategorie bleibt offen.`,
      })
    }
  }

  const proposed = Array.isArray(raw.merkmale) ? raw.merkmale : []
  const accepted: string[] = []
  const rejected: string[] = []
  for (const entry of proposed) {
    const key = text(entry)
    if (key === null) continue
    if (traitKeys.has(key)) {
      if (!accepted.includes(key)) accepted.push(key)
    } else if (!rejected.includes(key)) {
      rejected.push(key)
    }
  }

  if (rejected.length > 0) {
    warnings.push({
      code: 'merkmal_verworfen',
      lineNo,
      message: `Zeile ${lineNo}: Unbekannte Merkmale verworfen (${rejected.join(', ')}).`,
    })
  }

  const heat = text(raw.milch_erhitzung)?.toLowerCase()
  const homogenized = text(raw.milch_homogenisiert)?.toLowerCase()

  return {
    name: text(raw.name),
    categoryKey,
    traitKeys: accepted,
    // Alles Unbekannte wird „unbekannt" — nie geraten (PROJEKT.md).
    milkHeat: MILK_HEATS.includes(heat as MilkHeat) ? (heat as MilkHeat) : 'unbekannt',
    milkHomogenized: MILK_HOMOGENIZED.includes(homogenized as MilkHomogenized)
      ? (homogenized as MilkHomogenized)
      : 'unbekannt',
  }
}

/* ================================================================ Positionen */

function resolveItem(
  raw: ModelItem,
  lineNo: number,
  categoryKeys: Set<string>,
  traitKeys: Set<string>,
  warnings: ExtractionWarning[],
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

  const unitPriceCents = toCents(raw.einzelpreis_cent)
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

  const quantity = resolveQuantity(raw.menge, raw.einheit, unitPriceCents, totalCents, lineNo)
  warnings.push(...quantity.warnings)

  return {
    lineNo,
    rawText: rawText ?? '(kein Text erkannt)',
    kind,
    quantityBase: quantity.base,
    quantityUnit: quantity.unit,
    unitPriceCents,
    totalCents,
    // Beide Felder sind in der Datenbank auf „nicht negativ" geprüft, deshalb
    // steht hier der Betrag und im Vorzeichen von totalCents die Richtung.
    depositCents: kind === 'pfand' ? Math.abs(totalCents) : 0,
    discountCents: kind === 'rabatt' ? Math.abs(totalCents) : 0,
    // Pfand und Rabatt sind keine Produkte: kein Klarname, keine Kategorie.
    suggestion:
      kind === 'artikel'
        ? resolveSuggestion(raw.vorschlag, lineNo, categoryKeys, traitKeys, warnings)
        : null,
  }
}

/* ============================================================== Der ganze Bon */

export interface ValidationContext {
  /** Alle Kategorie-Schlüssel des Haushalts. */
  categoryKeys: string[]
  /** Alle **aktiven** Merkmalsschlüssel des Haushalts. */
  traitKeys: string[]
}

/**
 * Aus der geprüften Modellantwort wird das Ergebnis, mit dem die App arbeitet.
 *
 * Der Rückgabewert ist immer vollständig: Auch ein Bon voller Warnungen kommt
 * als `Extraction` zurück. Abgelehnt wird nur in `index.ts`, und zwar nur, wenn
 * das Modell selbst sagt, dass es nichts lesen konnte.
 */
export function validateExtraction(model: ModelReceipt, context: ValidationContext): Extraction {
  const categoryKeys = new Set(context.categoryKeys)
  const traitKeys = new Set(context.traitKeys)
  const warnings: ExtractionWarning[] = []

  const rawItems = Array.isArray(model.positionen) ? model.positionen : []
  /*
   * Neu durchnummeriert statt die Nummern des Modells zu übernehmen: In der
   * Datenbank ist (receipt_id, line_no) eindeutig, und ein Modell, das zweimal
   * „3" schreibt, würde das Speichern in 4b-2 zum Scheitern bringen.
   */
  const items = rawItems.map((entry, index) =>
    resolveItem((entry ?? {}) as ModelItem, index + 1, categoryKeys, traitKeys, warnings),
  )

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
    }
  }

  return {
    merchantName,
    purchasedOn,
    purchasedAt: toTime(model.uhrzeit),
    printedTotalCents,
    items,
    itemsTotalCents,
    discrepancyCents,
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
