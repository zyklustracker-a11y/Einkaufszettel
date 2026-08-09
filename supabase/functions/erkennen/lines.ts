/**
 * Aus abgetippten Bonzeilen werden Positionen — im Code, nicht im Modell.
 *
 * ---------------------------------------------------------------------------
 * WARUM DAS HIER UND NICHT IM PROMPT STEHT
 * ---------------------------------------------------------------------------
 *
 * Auf demselben REWE-Bon hat das Modell dreimal hintereinander dieselben zwei
 * Zeilen zusammengezogen:
 *
 *     VANILLE                    1,99 B
 *     MILCHSCHOKOSTR             0,99 B
 *
 * Auch nachdem der Prompt jede Deutung verboten bekam, kam „VANILLE
 * MILCHSCHOKOSTR" als *eine* Position mit 1,99 € zurück — die 0,99 € fielen
 * heraus. Bemerkenswert daran: Das Modell *kann* die Regel, bei der Sprühsahne
 * darüber wendet es sie richtig an. Es sieht die zweite Zeile nur nicht als
 * eigene. Dagegen hilft kein weiterer Satz.
 *
 * Also bekommt das Modell die Entscheidung gar nicht mehr. Es tippt nur noch ab
 * — jede gedruckte Zeile einzeln, wörtlich. Was davon eine Position ist,
 * entscheidet diese Datei, nach einer Regel, die sich hinschreiben lässt:
 *
 *   1. Zeile endet auf einen Betrag  → eigene Position.
 *   2. Zeile ist eine Mengenzeile    → gehört zur Position, die sie erklärt.
 *   3. Zeile ohne Betrag             → Fortsetzung des Namens.
 *
 * Damit folgt der Schritt demselben Grundsatz wie Summen, Score und
 * Bestpreise (PROJEKT.md): Was eine Regel über Text und Zahlen ist, gehört in
 * den Code, wo Tests es festnageln — nicht in ein Modell, das jedes Mal neu
 * entscheidet.
 *
 * Keine Netz- und keine Datenbankzugriffe: reine Funktionen.
 */

import type { ItemKind, ModelItem } from './validate.ts'

/* ============================================================== Die Muster */

/**
 * Ein Betrag am Zeilenende, mit optionalem Steuerkennzeichen dahinter.
 *
 * Verlangt sind **zwei** Nachkommastellen. Das ist die wichtigste Bremse gegen
 * Fehlalarm: „H-MILCH 1,5" und „SCHOKO 3,5%" sehen sonst aus wie Preise. Ein
 * gedruckter Preis hat immer zwei Stellen.
 *
 * Das Minus darf davor oder dahinter stehen — Kassen drucken „-0,50" und
 * „0,50-" gleichermaßen.
 */
const TRAILING_AMOUNT = /(-)?\s*(\d{1,4})[.,](\d{2})\s*(-)?\s*(?:eur|€)?\s*([A-Za-z]{1,2})?\s*$/i

/**
 * Eine Mengenzeile: „2 Stk x 0,99", „1,120 kg x 1,79 EUR/kg", „3 x 1,29",
 * „38,45 L à 1,779 EUR/L".
 *
 * Am Zeilenanfang verankert (Kassen rücken sie ein), damit ein Artikelname mit
 * einem „x" in der Mitte nicht versehentlich als Mengenzeile gilt.
 *
 * Drei Zugeständnisse an den Tankbeleg (Schritt 7):
 *
 *   * **`à` und `@` als Trennzeichen.** Zapfsäulen drucken „38,45 L à 1,779"
 *     statt „x".
 *   * **`Ltr` und `Liter` als Einheit.** Beides ist auf Tankbelegen üblich.
 *   * **Drei Nachkommastellen beim Einzelpreis.** Sprit wird in Zehntelcent
 *     ausgezeichnet. Ohne diese Stelle läse das Muster aus „1,779" ein „1,77"
 *     heraus und ließe die „9" als Textrest stehen — ein falscher Literpreis,
 *     der dazu noch plausibel aussieht.
 *
 * Auf ganze Cent gerundet wird erst beim Auslesen (`takeQuantity`): Geld ist in
 * dieser App nie eine Kommazahl (PROJEKT.md). Was dabei an Genauigkeit verloren
 * geht, holt die Spritauswertung aus Zeilensumme ÷ Litern zurück.
 */
const QUANTITY_LINE =
  /^(\d+(?:[.,]\d+)?)\s*(stk|stck|stück|st|kg|ml|ltr|liter|l|g)?\s*[x*×à@]\s*(\d{1,4}[.,]\d{2,3})/i

/**
 * Wörter, an denen eine Zeile als Pfand oder Rabatt zu erkennen ist.
 *
 * Bewusst knapp gehalten, und „Aktion" steht ausdrücklich **nicht** dabei: Ein
 * Artikel darf „AKTION VOLLMILCH" heißen, und ihn als Rabatt zu führen würde
 * seinen Betrag ins Minus drehen — aus einem falsch erkannten Wort würde ein
 * falscher Bon. Ein Abzug ist auf deutschen Bons ohnehin negativ gedruckt, und
 * das allein genügt als Erkennungsmerkmal (siehe `kindOf`).
 */
const PFAND = /(pfand|leergut|leihmaterial)/i
const RABATT = /(rabatt|nachlass|coupon|gutschein)/i

/* ============================================================== Das Ergebnis */

/** Eine Position, so wie der Parser sie baut — die Form, die `validate.ts` prüft. */
export interface ParsedItem extends ModelItem {
  /**
   * Die gedruckten Zeilen, aus denen diese Position entstanden ist.
   *
   * Sie bleiben erhalten, damit sich im Korrektur-Screen nachsehen lässt,
   * welche Zeile wohin geflossen ist. Schlägt der Steuerklassen-Abgleich an,
   * ist das die beste Fehlermeldung, die sich bauen lässt.
   */
  sourceLines: string[]
}

export interface ParseResult {
  items: ParsedItem[]
  /**
   * Zeilen, die zu keiner Position geführt haben — etwa ein Namensfragment am
   * Ende ohne folgenden Betrag. Sie werden angezeigt statt verschwiegen.
   */
  unassigned: string[]
}

/* ============================================================== Kleinteile */

/** Mehrfache Leerzeichen zusammenziehen; die Einrückung selbst zählt nicht. */
function tidy(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

interface Amount {
  cents: number
  taxCode: string | null
  /** Was vor dem Betrag stand. */
  before: string
}

/**
 * Den Betrag am Zeilenende abtrennen.
 *
 * Zurück kommt auch der Text davor — er ist der Artikelname, und ihn hier
 * abzuschneiden erspart ein zweites Zerlegen an anderer Stelle.
 */
function takeAmount(text: string): Amount | null {
  const match = TRAILING_AMOUNT.exec(text)
  if (!match) return null

  const [, minusBefore, whole, fraction, minusAfter, code] = match
  const negative = Boolean(minusBefore || minusAfter)
  const cents = Number(whole) * 100 + Number(fraction)

  /*
   * Ein Kennzeichen ist ein bis zwei Buchstaben. Steht dort etwas anderes —
   * „EUR", „kg" —, war es kein Kennzeichen, sondern gehört zum Text davor.
   * Dann ist die Zeile keine Preiszeile: „1,79 EUR/kg" ist eine Mengenangabe.
   */
  const taxCode = code ? code.toUpperCase() : null

  return {
    cents: negative ? -cents : cents,
    taxCode,
    before: text.slice(0, match.index).trim(),
  }
}

interface Quantity {
  amount: number
  unit: string | null
  unitPriceCents: number
  /** Wie viele Zeichen die Mengenangabe eingenommen hat. */
  length: number
}

function takeQuantity(text: string): Quantity | null {
  const match = QUANTITY_LINE.exec(text)
  if (!match) return null

  const [whole, rawAmount, rawUnit, rawPrice] = match
  const amount = Number(rawAmount.replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  const price = rawPrice.replace(',', '.')
  const unitPriceCents = Math.round(Number(price) * 100)

  return {
    amount,
    unit: rawUnit ? rawUnit.toLowerCase() : null,
    unitPriceCents,
    length: whole.length,
  }
}

/** Aus „Stück", „Stk", „ST" wird `stk`, aus „Ltr" und „Liter" wird `l`. */
function normalizeUnit(unit: string | null): string | null {
  if (!unit) return null
  const lower = unit.toLowerCase()
  if (lower.startsWith('st')) return 'stk'
  if (lower === 'ltr' || lower === 'liter') return 'l'
  return lower
}

/** Pfand, Rabatt oder gewöhnlicher Artikel — am gedruckten Wort erkannt. */
function kindOf(name: string, cents: number): ItemKind {
  if (PFAND.test(name)) return 'pfand'
  if (RABATT.test(name)) return 'rabatt'
  // Ein negativer Betrag ohne erklärendes Wort ist ein Abzug. Etwas anderes
  // kann er auf einem Kassenbon nicht sein.
  if (cents < 0) return 'rabatt'
  return 'artikel'
}

/* ============================================================== Die Regel */

/**
 * Aus den abgetippten Zeilen werden Positionen.
 *
 * Der Ablauf in einem Satz: Namensfragmente sammeln, bis eine Zeile mit Betrag
 * kommt — die schließt die Position ab. Eine Mengenzeile gehört entweder zu der
 * Position, die sie gerade abschließt, oder zu der davor.
 *
 * **Zwei Formen von Mengenzeile, und der Unterschied ist wesentlich:**
 *
 *     SPRUEHSAHNE 30%                 <- Name allein, ohne Betrag
 *       2 Stk x   0,99      1,98 B    <- Mengenzeile MIT Zeilensumme
 *
 *     BANANEN                2,00 B   <- Position mit Betrag
 *       1,120 kg x 1,79 EUR/kg        <- Mengenzeile OHNE Zeilensumme
 *
 * Im ersten Fall schließt die Mengenzeile die Position ab, im zweiten reichert
 * sie die vorige an. Beides kommt auf deutschen Bons vor, und beide Fälle sind
 * nebenan getestet.
 */
export function parseLines(rawLines: unknown): ParseResult {
  const lines = Array.isArray(rawLines)
    ? rawLines.filter((line): line is string => typeof line === 'string')
    : []

  const items: ParsedItem[] = []
  const unassigned: string[] = []

  /** Zeilen ohne Betrag, die auf ihre Position warten. */
  let pending: string[] = []

  const push = (item: ParsedItem) => {
    items.push(item)
    pending = []
  }

  for (const raw of lines) {
    const text = tidy(raw)
    if (text === '') continue

    const quantity = takeQuantity(text)

    if (quantity) {
      const rest = text.slice(quantity.length)
      const total = takeAmount(rest)

      if (total) {
        // Mengenzeile mit Zeilensumme: Sie schließt die Position ab, deren Name
        // in den Zeilen darüber steht.
        const name = [...pending, total.before].filter(Boolean).join(' ').trim()
        const sourceLines = [...pending, text]
        push({
          rohtext: name,
          art: kindOf(name, total.cents),
          menge: quantity.amount,
          einheit: normalizeUnit(quantity.unit),
          einzelpreis_cent: quantity.unitPriceCents,
          zeilensumme_cent: total.cents,
          steuer: total.taxCode,
          sourceLines,
        })
        continue
      }

      // Mengenzeile ohne Zeilensumme: Sie erklärt die Position davor.
      const previous = items[items.length - 1]
      if (previous) {
        previous.menge = quantity.amount
        previous.einheit = normalizeUnit(quantity.unit)
        previous.einzelpreis_cent = quantity.unitPriceCents
        previous.sourceLines.push(text)
        continue
      }

      // Eine Mengenzeile ganz ohne Position davor gibt es eigentlich nicht.
      unassigned.push(text)
      continue
    }

    const amount = takeAmount(text)

    if (amount) {
      const name = [...pending, amount.before].filter(Boolean).join(' ').trim()

      /*
       * Ein Betrag ohne jeden Namen ist keine Position, sondern ein Rest aus
       * dem Bon-Fuß — eine Summenzeile etwa, die trotz Anweisung mitkam. Sie
       * als Position zu führen, würde die Rechnung verdoppeln.
       */
      if (name === '') {
        unassigned.push(text)
        continue
      }

      push({
        rohtext: name,
        art: kindOf(name, amount.cents),
        menge: null,
        einheit: null,
        // Ohne Mengenzeile ist der Einzelpreis die Zeilensumme. Etwas anderes
        // kann er nicht sein.
        einzelpreis_cent: amount.cents,
        zeilensumme_cent: amount.cents,
        steuer: amount.taxCode,
        sourceLines: [...pending, text],
      })
      continue
    }

    // Kein Betrag, keine Menge: Das ist ein Stück Name und wartet.
    pending.push(text)
  }

  // Was am Ende noch wartet, gehört zu keiner Position — und wird gezeigt.
  unassigned.push(...pending)

  return { items, unassigned }
}
