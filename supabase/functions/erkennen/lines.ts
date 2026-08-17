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
 *
 * ---------------------------------------------------------------------------
 * ERWEITERT MIT SCHRITT 18: ZIFFERN ALS STEUERKENNZEICHEN
 * ---------------------------------------------------------------------------
 *
 * Das Kennzeichen am Zeilenende durfte bisher nur aus **Buchstaben** bestehen
 * (`A`, `B`, `AW`). Das ist die Edeka- und REWE-Schreibweise. Baumärkte und
 * viele andere Kassen drucken stattdessen den **Steuersatz als Zahl**:
 *
 *     4250787606599 2,000 STK a 5,99 Calibrachoa-Mix   11,98  7
 *     4042448169419 1,000 STK       Klett für Fenste   14,99 19
 *
 * Und weil das Muster bis zum Zeilenende reichen muss, hat die „7" nicht etwa
 * ein falsches Kennzeichen ergeben — sie hat den **ganzen Treffer verhindert**.
 * Für jede solche Zeile kam kein Betrag zurück, sie wurde zum Namensfragment,
 * und der ganze Bon hatte null Positionen. Ein toom-Bon war damit nicht bloß
 * ungenau erfasst, sondern gar nicht.
 *
 * Zusätzlich zugelassen ist jetzt der **Tausenderpunkt**: „1.234,56" kommt auf
 * einem Baumarktbon durchaus vor, und ohne ihn läse das Muster daraus 234,56 —
 * ein plausibel aussehender, um 1000 Euro falscher Betrag.
 */
const TRAILING_AMOUNT =
  /(-)?\s*(\d{1,3}(?:\.\d{3})*|\d{1,4})[.,](\d{2})\s*(-)?\s*(?:eur|€)?\s*([A-Za-z]{1,2}|\d{1,2})?\s*$/i

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
  /^(?:\d{6,14}\s+)?(\d+(?:[.,]\d+)?)\s*(stk|stck|stück|st|kg|ml|ltr|liter|l|g)?\s*(?:[x*×à@]|a(?=\s))\s*(\d{1,4}[.,]\d{2,3})/i

/**
 * Eine Mengenangabe **mitten** in der Zeile: „0,99 € x 2".
 *
 * Der Edeka-Bon druckt sie so, und zwar vor der Zeilensumme:
 *
 *     BIO ALNA.D.BR   0,99 € x 2      1,98 A
 *
 * `QUANTITY_LINE` oben greift hier nicht, weil es am Zeilenanfang verankert ist
 * — und das aus gutem Grund: Ohne Anker würde ein Artikelname mit einem „x" in
 * der Mitte zur Mengenzeile. Deshalb ein zweites, engeres Muster, das
 * ausdrücklich nur auf dem Textteil **vor** der Zeilensumme sucht und dort am
 * Ende verankert ist.
 *
 * Die Reihenfolge ist gegenüber der Mengenzeile vertauscht: erst der
 * Einzelpreis, dann die Stückzahl. Ohne dieses Muster wäre der Einzelpreis
 * dieser Zeile 1,98 statt 0,99 — und der Bestpreisvergleich verglichen dann
 * Doppelpackungen mit Einzelstücken.
 */
const INLINE_QUANTITY = /(\d{1,4}[.,]\d{2})\s*(?:eur|€)?\s*[x*×]\s*(\d{1,3})\s*$/i

/**
 * Der Vorspann einer Baumarkt-Zeile: Artikelnummer, dann Menge und Einheit.
 *
 *     4388950829864 1,000 STK LAVENDEL WEISS   2,99 7
 *     └──── EAN ───┘ └ Menge ┘
 *
 * `QUANTITY_LINE` greift hier nicht, weil dort ein **Einzelpreis** hinter der
 * Menge stehen muss („a 5,99"). Bei einem Stück druckt die Kasse keinen —
 * Einzelpreis und Zeilensumme wären dieselbe Zahl.
 *
 * Ohne dieses Muster bliebe der ganze Vorspann im Artikelnamen stehen. Das ist
 * nicht bloß unschön: Der Rohtext ist der **Schlüssel des Lernkreises**
 * (`product_mappings`). Steht die Artikelnummer darin, wird jede Zeile zu einem
 * eigenen, nie wieder auftauchenden Schlüssel — und der Haushalt lernt nichts,
 * weil er denselben Artikel nie zweimal sieht.
 *
 * Verlangt sind mindestens sechs Ziffern am Stück. Kein Artikelname beginnt so;
 * „1,5 % FETT" oder „3 X 0,99" sind kürzer und tragen ein Trennzeichen.
 */
const ARTICLE_PREFIX =
  /^(\d{6,14})\s+(?:(\d+(?:[.,]\d+)?)\s*(stk|stck|stück|st|kg|ml|ltr|liter|l|g)\b\s*)?/i

interface ArticlePrefix {
  /** Was nach dem Vorspann übrig bleibt. */
  rest: string
  amount: number | null
  unit: string | null
}

/** Den Vorspann abtrennen, falls es einen gibt. */
function takeArticlePrefix(text: string): ArticlePrefix {
  const match = ARTICLE_PREFIX.exec(text)
  if (!match) return { rest: text, amount: null, unit: null }

  const amount = match[2] === undefined ? null : Number(match[2].replace(',', '.'))

  return {
    rest: text.slice(match[0].length),
    amount: amount !== null && Number.isFinite(amount) && amount > 0 ? amount : null,
    unit: match[3] ?? null,
  }
}

/**
 * Zeilen, die kein Artikel sind, auch wenn ein Betrag darauf steht.
 *
 * Der Prompt sagt dem Modell, es solle den Bonfuß weglassen — und meistens hält
 * es sich daran. „Meistens" genügt hier nicht: Käme „SUMME 120,67" als Position
 * durch, stünde der Gesamtbetrag ein zweites Mal in der Liste, die
 * Positionssumme wäre doppelt so hoch, und der Summenabgleich meldete einen
 * Fehler, den es nicht gibt.
 *
 * **Warum diese Zeilen in `unassigned` landen und keine eigene `art` bekommen:**
 * `art` wird in der Datenbank gespeichert und ist dort auf `artikel`, `pfand`
 * und `rabatt` geprüft. Ein vierter Wert bräuchte eine Migration — für etwas,
 * das gar kein Bestandteil des Einkaufs ist. Sie werden stattdessen angezeigt
 * und nicht mitgezählt: Der Aufklappbereich „Abgetippte Zeilen" führt sie
 * weiterhin auf, sodass niemand raten muss, wo eine Zeile geblieben ist.
 *
 * `PFAND` und `RABATT` stehen hier ausdrücklich **nicht**: Sie sind Teil des
 * Einkaufs, haben eigene Arten und gehören in die Rechnung.
 */
const NICHT_ARTIKEL =
  /^(summe|zu\s*zahlen|gesamt(betrag|summe)?|total|geg(eben)?|bar|rückgeld|rueckgeld|wechselgeld|netto-?entgelt|mwst|ust|steuer|posten|payback|kundenbeleg|zahlung|karte|ec[- ]?card|mastercard|visa|girocard|trinkgeld|umsatz|netto|brutto)\b/i

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

/**
 * Wie sicher eine Zeile gelesen wurde — gerechnet, nicht geschätzt.
 *
 * ---------------------------------------------------------------------------
 * WARUM DIE ZAHL HIER ENTSTEHT UND NICHT IM MODELL
 * ---------------------------------------------------------------------------
 *
 * Der naheliegende Weg wäre, das Modell je Zeile nach einer Zahl zwischen 0 und
 * 1 zu fragen. Er ist aus zwei Gründen der schlechtere.
 *
 * Erstens: Es wären fünfzig zusätzliche Schätzaufgaben neben dem Abtippen, und
 * genau solche Nebenaufgaben haben die Erkennung schon zweimal verdorben (siehe
 * den Kopf von `prompt.ts`). Zweitens sind Sprachmodelle bei kalibrierten
 * Zahlen notorisch schlecht — sie schreiben 0,95 unter alles, auch unter das,
 * was sie erfunden haben.
 *
 * Das Modell bekommt deshalb nur die eine Aufgabe, die es gut kann: mit dem
 * Finger auf die Zeilen zeigen, die es nicht entziffern konnte
 * (`unsichere_zeilen`). Alles Weitere ist hier ablesbar, und zwar an der Zeile
 * selbst:
 *
 *   * Hat das Modell diese Zeile als unsicher markiert?
 *   * Blieb überhaupt ein Name übrig, oder war die Zeile nur ein Betrag?
 *   * Steht in dem Namen wenigstens ein Buchstabe? Ein „Artikel" aus reinen
 *     Ziffern und Satzzeichen ist fast immer ein Lesefehler.
 *   * Wimmelt es von Zeichen, die auf keinem Kassenbon stehen? Thermodruck wird
 *     bei schlechtem Foto zu Zeichensalat, und der ist sichtbar.
 *
 * Multiplikativ verrechnet: Zwei Auffälligkeiten ziehen zusammen tiefer als
 * eine, und der Wert bleibt zwischen 0 und 1.
 */
const UNSICHER_FAKTOR = 0.5
const KURZER_NAME_FAKTOR = 0.7
const OHNE_BUCHSTABE_FAKTOR = 0.5
const ZEICHENSALAT_FAKTOR = 0.7

/** Zeichen, die auf einem deutschen Kassenbon vorkommen dürfen. */
const SAUBERE_ZEICHEN = /[A-Za-zÄÖÜäöüß0-9 .,\-+%&/()'*:x]/

function konfidenz(name: string, unsicher: boolean): number {
  let wert = 1

  if (unsicher) wert *= UNSICHER_FAKTOR
  if (name.length < 3) wert *= KURZER_NAME_FAKTOR
  if (!/[A-Za-zÄÖÜäöüß]/.test(name)) wert *= OHNE_BUCHSTABE_FAKTOR

  /*
   * Anteil ungewöhnlicher Zeichen. Ab einem Zehntel wird es verdächtig: Auf
   * einem sauber gelesenen Bon steht so gut wie nichts außerhalb der Liste
   * oben, und wenn doch, dann einzeln.
   */
  const fremd = [...name].filter((zeichen) => !SAUBERE_ZEICHEN.test(zeichen)).length
  if (name.length > 0 && fremd / name.length > 0.1) wert *= ZEICHENSALAT_FAKTOR

  return Math.round(Math.min(1, Math.max(0, wert)) * 100) / 100
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
  // Der Tausenderpunkt ist eine Lesehilfe und keine Ziffer: „1.234" sind 1234.
  const cents = Number(whole.replace(/\./g, '')) * 100 + Number(fraction)

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
export function parseLines(
  rawLines: unknown,
  /**
   * Die Nummern der Zeilen, die das Modell selbst als unsicher gemeldet hat —
   * 0-basiert, bezogen auf `rawLines`. Leer, wenn es nichts gemeldet hat oder
   * das Feld nicht kennt.
   */
  rawUncertain: unknown = [],
): ParseResult {
  const lines = Array.isArray(rawLines)
    ? rawLines.filter((line): line is string => typeof line === 'string')
    : []

  const uncertain = new Set(
    Array.isArray(rawUncertain)
      ? rawUncertain.filter((entry): entry is number => Number.isInteger(entry))
      : [],
  )

  const items: ParsedItem[] = []
  const unassigned: string[] = []

  /** Zeilen ohne Betrag, die auf ihre Position warten. */
  let pending: string[] = []
  /**
   * Die Nummern dieser wartenden Zeilen.
   *
   * Getrennt von `pending` mitgeführt, weil die Konfidenz nicht am Text hängt,
   * sondern an der Zeile: Eine Position aus drei gedruckten Zeilen ist unsicher,
   * sobald das Modell **eine** davon nicht entziffern konnte — auch wenn genau
   * dieser Teil im zusammengesetzten Namen unauffällig aussieht.
   */
  let pendingIndexes: number[] = []

  const push = (item: ParsedItem) => {
    items.push(item)
    pending = []
    pendingIndexes = []
  }

  /** War eine der beteiligten Zeilen vom Modell als unsicher gemeldet? */
  const anyUncertain = (index: number) =>
    uncertain.has(index) || pendingIndexes.some((entry) => uncertain.has(entry))

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
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
        const sicherheit = konfidenz(name, anyUncertain(index))
        push({
          rohtext: name,
          art: kindOf(name, total.cents),
          konfidenz: sicherheit,
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

    /*
     * Erst den Vorspann abtrennen, dann den Betrag suchen. Die Reihenfolge ist
     * wesentlich: Der Name entsteht aus dem, was vor dem Betrag steht — läge
     * die Artikelnummer da noch drin, stünde sie im Namen und damit im
     * Lernschlüssel.
     */
    const prefix = takeArticlePrefix(text)
    const amount = takeAmount(prefix.rest)

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

      /*
       * Dasselbe, nur mit Namen: „SUMME 120,67", „GEGEBEN 150,00",
       * „MwSt-Betrag 4,51". Sie tragen einen Betrag und sehen damit aus wie
       * Positionen, sind aber keine — sie fassen zusammen, was schon dasteht.
       */
      if (NICHT_ARTIKEL.test(name)) {
        unassigned.push(text)
        pending = []
        pendingIndexes = []
        continue
      }

      /*
       * Steht die Menge mitten in der Zeile („0,99 € x 2"), wird sie hier
       * herausgelöst — vor dem Namen, damit sie nicht darin stehen bleibt.
       */
      const inline = INLINE_QUANTITY.exec(name)
      const count = inline ? Number(inline[2]) : 0
      const usable = inline !== null && count > 0

      push({
        rohtext: usable ? name.slice(0, inline.index).trim() : name,
        art: kindOf(name, amount.cents),
        konfidenz: konfidenz(name, anyUncertain(index)),
        menge: usable ? count : prefix.amount,
        // Ohne gedruckte Einheit ist eine Stückzahl gemeint — etwas anderes
        // lässt sich „x 2" nicht entnehmen.
        einheit: usable ? 'stk' : normalizeUnit(prefix.unit),
        // Ohne Mengenzeile ist der Einzelpreis die Zeilensumme. Etwas anderes
        // kann er nicht sein.
        einzelpreis_cent: usable
          ? Math.round(Number(inline[1].replace(',', '.')) * 100)
          : amount.cents,
        zeilensumme_cent: amount.cents,
        steuer: amount.taxCode,
        sourceLines: [...pending, text],
      })
      continue
    }

    // Kein Betrag, keine Menge: Das ist ein Stück Name und wartet.
    pending.push(text)
    pendingIndexes.push(index)
  }

  // Was am Ende noch wartet, gehört zu keiner Position — und wird gezeigt.
  unassigned.push(...pending)

  return { items, unassigned }
}
