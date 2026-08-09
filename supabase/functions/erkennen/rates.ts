/**
 * Der EZB-Referenzkurs — beschafft, zwischengespeichert, nachvollziehbar.
 *
 * Die Europäische Zentralbank veröffentlicht ihre Referenzkurse frei zugänglich,
 * ohne Anmeldung und ohne Schlüssel. Das passt zur harten Rahmenbedingung aus
 * PROJEKT.md: Das Projekt muss kostenlos bleiben.
 *
 * **Warum hier und nicht im Browser:** Hier liegen die Netzwerkrechte, und das
 * Ergebnis lässt sich gleich in `exchange_rates` ablegen. Ein Abruf aus der App
 * heraus müsste außerdem an den CORS-Regeln der EZB vorbei.
 *
 * ---------------------------------------------------------------------------
 * DIE DREI DINGE, DIE HIER RICHTIG SEIN MÜSSEN
 * ---------------------------------------------------------------------------
 *
 * 1. **Die Richtung des Kurses.** Die EZB veröffentlicht „wie viele Franken
 *    kostet ein Euro" (0,9347). Gerechnet wird in der App andersherum: Betrag ×
 *    Kurs = Euro. Gespeichert wird deshalb der Kehrwert (1,069862) — die Form,
 *    in der gerechnet wird, und die Form, die im Korrektur-Screen steht.
 *
 * 2. **Der Stichtag.** Der Kurs richtet sich nach dem Bon-Datum, nicht nach
 *    heute. An Wochenenden und Feiertagen veröffentlicht die EZB nichts; dann
 *    gilt der letzte verfügbare Werktag, und **welcher das war, wird
 *    mitgegeben** — sonst ließe sich später nicht mehr nachvollziehen, woher die
 *    Zahl stammt.
 *
 * 3. **Ein Fehlschlag darf nichts mitreißen.** Netz weg, EZB nicht erreichbar,
 *    Währung unbekannt: Der Scan läuft trotzdem durch. Der Korrektur-Screen
 *    zeigt dann ein Kursfeld für diesen einen Bon. Markieren statt ablehnen,
 *    wie überall in dieser Funktion.
 *
 * Die reinen Funktionen (Zerlegen, Auswählen, Umkehren) stehen bewusst getrennt
 * vom Netz- und Datenbankteil: Nur so lassen sie sich mit `node --test`
 * festnageln, ohne dass ein Test ins Internet greift.
 */

/** Ein Kurs, so wie die App ihn braucht. */
export interface ExchangeRate {
  /**
   * Euro je **eine** Einheit der Fremdwährung. 45,00 CHF × 1,069862 = 48,14 €.
   * Auf sechs Nachkommastellen gerundet — genau die Genauigkeit der Spalte
   * `exchange_rates.rate`.
   */
  rate: number
  /**
   * Der Tag, für den dieser Kurs veröffentlicht wurde. Bei einem Bon vom
   * Samstag steht hier der Freitag davor.
   */
  rateDate: string
}

/**
 * Warum es nicht geklappt hat. Der Code ist für die App, der Satz für den
 * Nutzer — er steht in `message`.
 */
export type RateFailureCode = 'waehrung_unbekannt' | 'kein_kurs' | 'netz'

export interface RateFailure {
  code: RateFailureCode
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
}

export type RateOutcome = { ok: true; value: ExchangeRate } | { ok: false; failure: RateFailure }

/**
 * Wie weit zurück nach dem letzten veröffentlichten Kurs gesucht wird.
 *
 * Vierzehn Tage sind reichlich: Die längste Lücke im EZB-Kalender sind die
 * Feiertage um Weihnachten und Neujahr, und selbst die bleiben unter einer
 * Woche. Ein größeres Fenster kostet nichts (es ist dieselbe eine Anfrage),
 * ein zu kleines dagegen einen Fehlschlag ohne Not.
 */
export const LOOKBACK_DAYS = 14

/** Zeitlimit für den Abruf. Die EZB antwortet in Millisekunden oder gar nicht. */
const TIMEOUT_MS = 8000

/* ============================================================ reine Funktionen */

/** `2026-08-09` minus n Tage, wieder als ISO-Datum. */
export function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

/** Ein ISO-Datum, das es auch wirklich gibt — der 31.02. fällt hier durch. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/**
 * Ein Währungscode, wie die Datenbank ihn annimmt: drei Großbuchstaben.
 *
 * Null bei allem anderen — auch bei `EUR`. Für Euro gibt es keinen Kurs zu
 * holen, und ein Kurs von 1,0 wäre eine Zahl ohne Aussage.
 */
export function toForeignCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code) || code === 'EUR') return null
  return code
}

/** Eine Zeile der EZB-Antwort: Tag und „wie viele Einheiten kostet ein Euro". */
export interface EcbObservation {
  date: string
  /** Fremdwährung je Euro — die Richtung, in der die EZB veröffentlicht. */
  perEuro: number
}

/**
 * Die CSV-Antwort der EZB zerlegen.
 *
 * Die Datei hat über dreißig Spalten, von denen genau zwei interessieren:
 * `TIME_PERIOD` und `OBS_VALUE`. Gesucht werden sie **über die Kopfzeile** und
 * nicht über feste Nummern — die EZB darf ihre Metadatenspalten jederzeit
 * umsortieren, und ein Kurs, der dann stillschweigend aus der falschen Spalte
 * käme, wäre der teuerste denkbare Fehler.
 *
 * Anführungszeichen kommen nur in den Titelspalten am Ende vor, also hinter
 * beiden gesuchten Feldern. Ein voller CSV-Zerleger wäre trotzdem die
 * ehrlichere Lösung — deshalb wird jede Zeile verworfen, deren Datum oder Wert
 * nicht plausibel ist, statt sie zurechtzubiegen.
 */
export function parseEcbCsv(csv: string): EcbObservation[] {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const header = lines[0].split(',')
  const dateColumn = header.indexOf('TIME_PERIOD')
  const valueColumn = header.indexOf('OBS_VALUE')
  if (dateColumn === -1 || valueColumn === -1) return []

  const observations: EcbObservation[] = []
  for (const line of lines.slice(1)) {
    const fields = line.split(',')
    const date = (fields[dateColumn] ?? '').trim()
    const raw = (fields[valueColumn] ?? '').trim()
    if (!isIsoDate(date)) continue

    const perEuro = Number(raw)
    // Ein leerer Wert kommt vor: Die EZB liefert für manche Tage eine Zeile
    // ohne Beobachtung. Sie ist keine Null, sondern eine Lücke.
    if (!Number.isFinite(perEuro) || perEuro <= 0) continue

    observations.push({ date, perEuro })
  }

  return observations.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Der jüngste veröffentlichte Kurs, der nicht nach dem Bon-Datum liegt.
 *
 * Damit sind Wochenende und Feiertag erledigt, ohne dass irgendwo ein Kalender
 * stünde: Für einen Bon vom Samstag ist die letzte Beobachtung die vom Freitag.
 * Ein Kurs **nach** dem Bon-Datum wird nie genommen — er hätte am Bontag noch
 * gar nicht existiert.
 */
export function pickObservation(
  observations: EcbObservation[],
  onDate: string,
): EcbObservation | null {
  let best: EcbObservation | null = null
  for (const observation of observations) {
    if (observation.date > onDate) continue
    if (best === null || observation.date > best.date) best = observation
  }
  return best
}

/**
 * Von „Franken je Euro" zu „Euro je Franken".
 *
 * Sechs Nachkommastellen, weil `exchange_rates.rate` genau so viele hat. Würde
 * hier feiner gerechnet und dort gerundet, stünde im Korrektur-Screen ein
 * anderer Kurs als später im gespeicherten Bon.
 */
export function toEuroRate(perEuro: number): number {
  return Math.round((1 / perEuro) * 1_000_000) / 1_000_000
}

/* ================================================================ Der Abruf */

/**
 * Die Adresse der EZB-Zeitreihe für eine Währung.
 *
 * `D.CHF.EUR.SP00.A` heißt: tägliche Reihe, Franken gegen Euro,
 * Kassakurs, Durchschnitt. `format=csvdata` liefert eine flache Tabelle —
 * deutlich weniger Angriffsfläche als das SDMX-XML derselben Schnittstelle, für
 * das es einen richtigen Parser bräuchte.
 */
export function ecbUrl(currency: string, from: string, to: string): string {
  return (
    `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A` +
    `?startPeriod=${from}&endPeriod=${to}&format=csvdata`
  )
}

const FAILURES: Record<RateFailureCode, string> = {
  waehrung_unbekannt:
    'Für diese Währung veröffentlicht die EZB keinen Referenzkurs. Trag den Kurs für diesen Bon von Hand ein.',
  kein_kurs:
    'Die EZB hat für diesen Zeitraum keinen Kurs veröffentlicht. Trag den Kurs für diesen Bon von Hand ein.',
  netz: 'Der EZB-Kurs war gerade nicht abrufbar. Trag den Kurs für diesen Bon von Hand ein.',
}

function fail(code: RateFailureCode): RateOutcome {
  return { ok: false, failure: { code, message: FAILURES[code] } }
}

/** Holt die Zeitreihe bei der EZB. Wirft nie — ein Fehlschlag ist eine leere Liste. */
async function fetchObservations(
  currency: string,
  from: string,
  to: string,
): Promise<EcbObservation[] | null> {
  try {
    const response = await fetch(ecbUrl(currency, from, to), {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    /*
     * 404 heißt bei dieser Schnittstelle „diese Zeitreihe gibt es nicht" — also
     * eine Währung, für die die EZB keinen Kurs führt. Das ist etwas anderes
     * als eine Störung, und der Nutzer bekommt deshalb einen anderen Satz.
     */
    if (response.status === 404) return []
    if (!response.ok) return null

    return parseEcbCsv(await response.text())
  } catch (cause) {
    console.error('EZB nicht erreichbar:', cause instanceof Error ? cause.message : cause)
    return null
  }
}

/* ========================================================= Zwischenspeicher */

/** So wenig wie möglich vom Supabase-Client — nur, was hier gebraucht wird. */
export interface RateStore {
  /** Der gespeicherte Kurs für genau diesen Tag, oder null. */
  read(currency: string, onDate: string): Promise<number | null>
  /** Legt Kurse ab. Ein bereits gespeicherter Tag wird nie überschrieben. */
  write(currency: string, observations: EcbObservation[]): Promise<void>
}

/**
 * Kurs beschaffen: erst der Zwischenspeicher, dann die EZB.
 *
 * **Der Zwischenspeicher hält nur echte Veröffentlichungstage.** Für einen Bon
 * vom Samstag wird deshalb jedes Mal neu bei der EZB gefragt — ein Kurs unter
 * dem Datum „Samstag" abzulegen wäre eine Behauptung über einen Tag, an dem
 * nichts veröffentlicht wurde, und `receipts.rate_date` verlöre seine Aussage.
 * Der Preis dafür ist eine zusätzliche Anfrage, wenn derselbe Wochenendbon ein
 * zweites Mal gescannt wird. Für den Normalfall — ein Werktagsbon — wird genau
 * einmal gefragt und danach nie wieder.
 */
export async function resolveExchangeRate(
  store: RateStore,
  currency: unknown,
  onDate: string,
): Promise<RateOutcome> {
  const code = toForeignCurrency(currency)
  if (code === null) return fail('waehrung_unbekannt')
  if (!isIsoDate(onDate)) return fail('kein_kurs')

  const cached = await store.read(code, onDate)
  if (cached !== null && cached > 0) {
    return { ok: true, value: { rate: cached, rateDate: onDate } }
  }

  const observations = await fetchObservations(code, shiftDays(onDate, -LOOKBACK_DAYS), onDate)
  if (observations === null) return fail('netz')
  if (observations.length === 0) return fail('waehrung_unbekannt')

  // Erst ablegen, dann auswählen: Auch die Tage vor dem gesuchten sind für den
  // nächsten Bon nützlich, und die eine Anfrage hat sie ohnehin schon geliefert.
  await store.write(code, observations)

  const picked = pickObservation(observations, onDate)
  if (picked === null) return fail('kein_kurs')

  return { ok: true, value: { rate: toEuroRate(picked.perEuro), rateDate: picked.date } }
}
