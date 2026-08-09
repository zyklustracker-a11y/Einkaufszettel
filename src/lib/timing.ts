import { EXPECTED_MS } from './progress.ts'
import type { ExtractionPhase } from './extraction'

/**
 * Wie lange ein Scan wirklich dauert — gemessen statt geschätzt.
 *
 * `EXPECTED_MS` in `progress.ts` war von Anfang an geraten, und
 * `KONZEPT-ERWEITERUNGEN.md` führt das als offene Kleinigkeit: nachjustieren,
 * sobald die tatsächliche Dauer bekannt ist. Sie **ist** bekannt — die Edge
 * Function gibt bei jedem Scan zurück, wie lange der Modellaufruf gebraucht hat
 * (`durationMs`, je Durchgang). Bisher stand die Zahl nur im Aufklappbereich des
 * Korrektur-Screens.
 *
 * Also justiert der Balken sich selbst: Jeder Scan hinterlässt seine Dauer, und
 * die Schätzung ist der **Median der letzten acht**. Nach drei Scans steht der
 * Balken auf den Zahlen dieses Anschlusses, dieses Telefons und dieses Modells —
 * genauer, als eine feste Konstante je sein könnte.
 *
 * Drei Entscheidungen dazu:
 *
 *   * **Median, nicht Mittelwert.** Ein Scan im Funkloch dauert eine Minute; er
 *     soll den Balken nicht für die nächsten zehn Scans träge machen. Derselbe
 *     Grund wie beim Kaufrhythmus.
 *   * **Nur die letzten acht.** Wechselt der Nutzer das Modell oder zieht um,
 *     soll sich die Schätzung in ein paar Scans umstellen und nicht über Monate.
 *   * **`localStorage` und nicht die Datenbank.** Die Dauer hängt am Gerät und
 *     an der Leitung, nicht am Haushalt. Auf dem iPad wäre die Zahl des iPhones
 *     die falsche.
 *
 * Die Rechnung selbst ist rein und steht unten; nur das Lesen und Schreiben
 * fasst den Browser an.
 */

const KEY = 'receipt-ai:phaseDurations'

/** Wie viele Messungen aufbewahrt werden. Acht sind zwei bis drei Wochen Alltag. */
export const SAMPLE_LIMIT = 8

/**
 * Grenzen, außerhalb derer eine Messung nicht als Alltag durchgeht.
 *
 * Unten: Ein Aufruf, der in 200 ms zurückkam, hat kein Modell gesehen. Oben: Ein
 * Scan, der eine Minute brauchte, war ein Funkloch. Beides sind echte
 * Beobachtungen und trotzdem keine Grundlage für eine Schätzung — der Balken
 * soll den Normalfall abbilden.
 */
const MIN_SAMPLE_MS = 300
const MAX_SAMPLE_MS = 60_000

export type PhaseSamples = Partial<Record<ExtractionPhase, number[]>>

/** Der Median einer Messreihe. Leer → null. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

/**
 * Aus Messreihen werden erwartete Dauern.
 *
 * **Erst ab drei Messungen** wird eine Reihe benutzt. Bei einer einzigen wäre
 * die „Schätzung" schlicht der letzte Scan, und ein einzelner Ausreißer
 * verstellte den Balken für alle folgenden. Bis dahin gilt der Voreinstellwert.
 */
export function expectedFrom(
  samples: PhaseSamples,
  defaults: Record<ExtractionPhase, number> = EXPECTED_MS,
): Record<ExtractionPhase, number> {
  const result = { ...defaults }

  for (const phase of Object.keys(defaults) as ExtractionPhase[]) {
    const values = samples[phase] ?? []
    if (values.length < 3) continue
    const value = median(values)
    if (value !== null) result[phase] = value
  }

  return result
}

/** Eine Messung anhängen und die Reihe auf die letzten `SAMPLE_LIMIT` kürzen. */
export function withSample(
  samples: PhaseSamples,
  phase: ExtractionPhase,
  durationMs: number,
): PhaseSamples {
  if (!Number.isFinite(durationMs) || durationMs < MIN_SAMPLE_MS || durationMs > MAX_SAMPLE_MS) {
    return samples
  }

  const values = [...(samples[phase] ?? []), Math.round(durationMs)]
  return { ...samples, [phase]: values.slice(-SAMPLE_LIMIT) }
}

/* ------------------------------------------------- Der Teil mit dem Browser */

function read(): PhaseSamples {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return {}

    // Was hier steht, hat ein früherer Stand der App geschrieben. Geprüft wird
    // trotzdem: Eine kaputte Zeile im Speicher darf keinen Scan verhindern.
    const out: PhaseSamples = {}
    for (const [phase, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(values)) {
        out[phase as ExtractionPhase] = values.filter(
          (value): value is number => typeof value === 'number' && Number.isFinite(value),
        )
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Die Schätzung, die der Verarbeitungs-Screen benutzt. */
export function expectedDurations(): Record<ExtractionPhase, number> {
  return expectedFrom(read())
}

/** Eine gemessene Dauer merken. Scheitert das, bleibt es bei der Schätzung. */
export function recordPhaseDuration(phase: ExtractionPhase, durationMs: number): void {
  try {
    const next = withSample(read(), phase, durationMs)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Privater Modus, voller Speicher: Der Balken schätzt dann eben weiter.
  }
}
