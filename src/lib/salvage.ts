import type { Extraction, ExtractionResponse } from './extraction'

/**
 * Was aus einem misslungenen Scan noch zu retten ist.
 *
 * ---------------------------------------------------------------------------
 * DIE REGEL, UM DIE ES GEHT
 * ---------------------------------------------------------------------------
 *
 * **Ein Teilergebnis ist immer besser als eine Fehlermeldung.**
 *
 * Bis Schritt 18 gab es genau zwei Ausgänge: Entweder der Bon war vollständig
 * gelesen, dann ging es in den Korrektur-Screen — oder irgendetwas ging schief,
 * dann stand „Erkennung fehlgeschlagen" da und der Weg war zu Ende. Ein Bon, bei
 * dem Händler, Datum, Summe und dreißig von fünfunddreißig Positionen gelesen
 * waren, landete im selben Bildschirm wie ein Foto vom Küchentisch.
 *
 * Das ist aus Sicht des Nutzers die teuerste Entscheidung, die die App treffen
 * kann. Der Bon liegt vor ihm, er hat gewartet, und er bekommt nichts — obwohl
 * fünf Minuten Tipparbeit gespart gewesen wären. Der zweite Scan liest denselben
 * Bon oft genauso schlecht.
 *
 * Deshalb entscheidet ab jetzt diese Datei, und zwar nach einer Regel, die man
 * hinschreiben kann: **Ist irgendetwas Verwertbares da, geht es ins Formular.**
 * Der Fehlerbildschirm bleibt für den einen Fall, in dem er die Wahrheit sagt:
 * Es ist wirklich nichts angekommen.
 *
 * Reine Funktionen, damit die Regel neben dieser Datei getestet werden kann und
 * nicht in einer Komponente versteckt liegt.
 */

/** Heute als `JJJJ-MM-TT` — die Vorbelegung für einen Bon ohne Datum. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Ist genug da, um dem Nutzer ein Formular zu zeigen?
 *
 * Drei Anker, und **einer genügt**:
 *
 *   * ein Händlername — dann weiß der Bon wenigstens, wo er herkommt
 *   * eine gedruckte Summe — dann steht der wichtigste Betrag fest
 *   * mindestens eine Position — dann ist echte Arbeit gespart
 *
 * Warum ein einziger reicht: Jeder davon ist mehr, als ein leeres Formular
 * hätte, und alles Übrige kann der Nutzer tippen. Zu verlangen, dass zwei davon
 * stimmen, hieße einen brauchbaren Anfang wegzuwerfen, weil er kein guter Anfang
 * ist.
 */
export function isWorthReviewing(extraction: Extraction | null | undefined): boolean {
  if (!extraction) return false

  const hasMerchant = (extraction.merchantName ?? '').trim() !== ''
  const hasTotal = extraction.printedTotalCents !== null
  const hasItems = Array.isArray(extraction.items) && extraction.items.length > 0

  return hasMerchant || hasTotal || hasItems
}

/**
 * Wie vollständig das Ergebnis ist — für den Hinweis über dem Formular.
 *
 * `vollstaendig` heißt nicht „fehlerfrei": Die Beträge können trotzdem falsch
 * gelesen sein. Es heißt nur, dass die Erkennung ordentlich zu Ende gelaufen
 * ist und nichts abgeschnitten wurde. Alles Weitere sagt der Summenabgleich.
 */
export type ReviewQuality = 'vollstaendig' | 'teilweise'

/**
 * Fehlt an diesem Ergebnis erkennbar etwas?
 *
 * Zwei Anzeichen, und beide sind belegt statt vermutet:
 *
 *   * `antwort_abgeschnitten` — die Antwort endete an der Token-Grenze und
 *     wurde von `repair.ts` geschlossen. Dann fehlt möglicherweise etwas, das
 *     nirgends sonst auffällt.
 *   * `summe_weicht_ab` — die Positionen ergeben nicht die gedruckte Summe.
 *     Das ist der klassische Beleg dafür, dass eine Zeile fehlt.
 *
 * Ein Bon **ohne** jede Position gilt immer als unvollständig, auch wenn keine
 * der beiden Warnungen da ist: Ein Händlername allein ist kein Einkauf.
 */
export function reviewQuality(extraction: Extraction): ReviewQuality {
  const codes = new Set((extraction.warnings ?? []).map((warning) => warning.code))

  if (codes.has('antwort_abgeschnitten')) return 'teilweise'
  if (codes.has('summe_weicht_ab')) return 'teilweise'
  if (codes.has('zeilen_fehlen')) return 'teilweise'
  if (!Array.isArray(extraction.items) || extraction.items.length === 0) return 'teilweise'

  return 'vollstaendig'
}

/**
 * Ein leeres Ergebnis — die Grundlage für „Manuell erfassen".
 *
 * **Warum das überhaupt ein Ergebnis ist und kein eigener Screen:** Der
 * Korrektur-Screen kann bereits alles, was manuelles Erfassen braucht — Händler,
 * Datum, Positionen hinzufügen, Summe, Speichern. Einen zweiten Screen daneben
 * zu bauen, der dasselbe Formular noch einmal enthält, wären zwei Formulare, die
 * auseinanderlaufen. Ein leerer Scan ist derselbe Weg mit weniger Vorbelegung.
 *
 * `model` steht auf `manuell`, damit im Aufklappbereich nicht ein Modellname
 * steht, das nichts getan hat.
 */
export function blankScan(): ExtractionResponse {
  const extraction: Extraction = {
    merchantName: null,
    purchasedOn: todayIso(),
    purchasedAt: null,
    currency: null,
    printedTotalCents: null,
    items: [],
    itemsTotalCents: 0,
    discrepancyCents: null,
    taxGroups: [],
    printedTaxGroups: [],
    lines: [],
    unassignedLines: [],
    warnings: [],
  }

  return {
    extraction,
    model: 'manuell',
    durationMs: 0,
    raw: '',
    assignment: null,
    merchantKind: 'retail',
    exchangeRate: null,
    rateError: null,
  }
}
