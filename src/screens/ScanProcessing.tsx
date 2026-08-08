import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ProgressBar } from '../components/ui'
import { ExtractionError, extractReceipt } from '../data'
import type { ExtractionPhase } from '../data'
import type { CapturedImage } from '../lib/camera'
import type { ExtractionResponse } from '../lib/extraction'
import { getPendingCapture } from '../lib/capture'
import { formatPercent } from '../lib/format'
import { clearPendingExtraction, setPendingExtraction } from '../lib/scanResult'
import styles from './ScanProcessing.module.css'

/* ============================================================================
 * DER FORTSCHRITTSBALKEN — und warum er schätzt, ohne zu lügen
 *
 * Wie weit Mistral mit einem Bon ist, sagt uns niemand. Die Schnittstelle
 * antwortet einmal, fertig; einen Zwischenstand gibt es nicht. Der Balken ist
 * deshalb eine **Schätzung**, und damit er trotzdem ehrlich bleibt, gelten drei
 * Regeln:
 *
 *   1. Er läuft nie rückwärts (`Math.max` bei jedem Schritt).
 *   2. Er erreicht 100 % erst, wenn das Ergebnis wirklich da ist. Solange die
 *      Antwort aussteht, wartet er bei WAIT_CEILING. Ein Balken, der bei 100 %
 *      steht und trotzdem weiterlädt, wäre schlimmer als gar keiner.
 *   3. Was er anzeigt, ist an echte Abschnitte gebunden — dieselben drei, die
 *      als Häkchen darunter stehen.
 *
 * Die Zeitschätzungen unten sind die Stellschraube: Wenn sich zeigt, wie lange
 * ein Scan im Alltag wirklich dauert, werden hier die Zahlen angepasst und
 * sonst nichts.
 * ========================================================================== */

/**
 * Wie lange ein Abschnitt typischerweise dauert.
 *
 * `senden` umfasst alles zwischen Absenden und Antwort: Hochladen über
 * Mobilfunk, den Modell-Aufruf selbst und die Prüfung auf dem Server. Das ist
 * mit Abstand das Längste — die Base64-Umwandlung davor dauert Millisekunden.
 */
const EXPECTED_MS: Record<ExtractionPhase, number> = {
  vorbereiten: 800,
  senden: 14_000,
  auswerten: 700,
}

/**
 * Hier wartet der Balken, solange die Antwort aussteht.
 *
 * Bewusst nicht 100: Die letzten Prozent gehören dem Ergebnis, das wirklich
 * eingetroffen ist.
 */
const WAIT_CEILING = 95

/** Und hier, während die eingetroffene Antwort geprüft wird. */
const CHECK_CEILING = 99

/**
 * Die drei Abschnitte mit ihrem Prozentbereich.
 *
 * Die Bereiche sind nach der typischen Dauer gewichtet — 0,8 s : 14 s : 0,7 s
 * entspricht rund 5 % : 90 % : 4 %. Deshalb steht der Balken die meiste Zeit im
 * mittleren Abschnitt, und genau da wird auch am längsten gewartet.
 *
 * Jeder Haken steht weiterhin für einen Abschnitt, der wirklich fertig ist —
 * keiner läuft nach Stoppuhr weiter. Genau deshalb sind es nur drei: Mehr lässt
 * sich von außen nicht beobachten.
 */
const STEPS: Array<{
  phase: ExtractionPhase
  label: string
  from: number
  to: number
}> = [
  { phase: 'vorbereiten', label: 'Bild wird vorbereitet…', from: 0, to: 5 },
  { phase: 'senden', label: 'Mistral liest den Bon…', from: 5, to: WAIT_CEILING },
  { phase: 'auswerten', label: 'Ergebnis wird geprüft…', from: WAIT_CEILING, to: CHECK_CEILING },
]

/** Wie oft der Balken nachrechnet. Fein genug, dass die Bewegung flüssig wirkt. */
const TICK_MS = 100

/**
 * Wie lange die volle Anzeige stehen bleibt, bevor es weitergeht.
 *
 * Ohne diese kurze Pause wäre die 100 nie zu sehen — der Screen verschwände im
 * selben Augenblick, in dem sie erscheint.
 */
const FINISH_MS = 250

/**
 * Der geschätzte Stand innerhalb eines Abschnitts.
 *
 * Gleichmäßig von `from` nach `to` über die erwartete Dauer, danach Halt am
 * oberen Ende. Dieses Stehenbleiben ist der ehrliche Teil: Dauert es länger als
 * geschätzt, wird eben nichts weitergezählt, statt eine Bewegung zu erfinden,
 * die nichts bedeutet.
 */
function estimateProgress(phase: ExtractionPhase, elapsedMs: number): number {
  const step = STEPS.find((entry) => entry.phase === phase)
  if (!step) return 0
  const share = Math.min(1, elapsedMs / EXPECTED_MS[phase])
  return step.from + (step.to - step.from) * share
}

/**
 * Ab wann zusätzlich beruhigt wird.
 *
 * Ein langer Bon braucht beim Modell durchaus zwanzig Sekunden. Ohne Hinweis
 * sieht das nach „hängt" aus, und der Nutzer bricht ab — obwohl die Antwort
 * gleich da wäre.
 */
const PATIENCE_MS = 18_000

/**
 * Gründe, bei denen ein zweiter Versuch nichts bringt: Da fehlt eine Anmeldung
 * oder eine Einrichtung, und die repariert kein Knopfdruck. Dann verschwindet
 * „Noch einmal versuchen", statt in eine Sackgasse zu führen.
 */
const HOPELESS = ['nicht_angemeldet', 'kein_schluessel', 'kein_haushalt', 'nicht_eingerichtet']

interface ScanError {
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
  retryable: boolean
  /**
   * Die Rohantwort des Modells, falls es eine gab.
   *
   * Gerade wenn das Modell kaputtes JSON geliefert hat, ist sie das einzige,
   * womit sich der Prompt nachschärfen lässt — deshalb steht sie auch im
   * Fehlerfall zur Verfügung und nicht nur bei Erfolg.
   */
  raw: string | null
}

/** Aus einem geworfenen Fehler wird das, was auf dem Screen steht. */
function describe(cause: unknown): ScanError {
  if (cause instanceof ExtractionError) {
    return {
      message: cause.message,
      retryable: !HOPELESS.includes(cause.code),
      raw: cause.raw,
    }
  }
  return {
    message: 'Die Erkennung hat nicht geklappt. Bitte versuch es noch einmal.',
    retryable: true,
    raw: null,
  }
}

/** Dateigröße in KB – nur zur Kontrolle, dass das Verkleinern wirkt. */
function sizeInKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * Maße als „Quelle → Ergebnis", sobald verkleinert wurde.
 *
 * Steht nur eine Zahl da, war das Kamerabild schon klein genug. Das ist der
 * Unterschied, den man am Gerät sonst nicht sieht: ob ein kleines Bild aus dem
 * Verkleinern kommt oder aus einer Kamera, die nicht mehr hergibt.
 */
function dimensions(capture: CapturedImage): string {
  const result = `${capture.width} × ${capture.height} px`
  if (capture.sourceWidth === capture.width && capture.sourceHeight === capture.height) {
    return result
  }
  return `${capture.sourceWidth} × ${capture.sourceHeight} → ${result}`
}

/**
 * Der Verarbeitungs-Screen: hier läuft die Erkennung.
 *
 * Das aufgenommene Foto geht an die Edge Function, die Mistral befragt und
 * geprüfte Bon-Daten zurückgibt. Das Ergebnis wird **nicht** gespeichert
 * (Schritt 4b-2), sondern im Speicher an den Korrektur-Screen weitergereicht.
 *
 * Ohne Foto — nach einem Neuladen oder beim direkten Aufruf der Adresse — gibt
 * es nichts zu erkennen. Dann steht das hier auch so da, statt eine Erkennung
 * vorzutäuschen, die gar nicht laufen kann.
 */
export function ScanProcessing() {
  const navigate = useNavigate()
  const capture = getPendingCapture()

  const [preview, setPreview] = useState<string | null>(null)
  const [phase, setPhase] = useState<ExtractionPhase>('vorbereiten')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<ScanError | null>(null)
  const [slow, setSlow] = useState(false)
  /** Zählt hoch, wenn „Noch einmal versuchen" gedrückt wird. */
  const [attempt, setAttempt] = useState(0)

  /*
   * Die laufende Anfrage, festgehalten statt neu gestartet.
   *
   * React ruft Effekte im Entwicklungsmodus absichtlich doppelt auf (montieren,
   * abräumen, wieder montieren). Würde der Effekt jedes Mal `extractReceipt`
   * aufrufen, liefe jeder Scan zweimal — und jede Anfrage zählt gegen das freie
   * Kontingent. Deshalb wird beim zweiten Durchlauf dasselbe Versprechen
   * weiterverwendet; nur „Noch einmal versuchen" (`attempt`) startet wirklich
   * eine neue Anfrage.
   */
  const requestRef = useRef<{ attempt: number; promise: Promise<ExtractionResponse> } | null>(null)

  useEffect(() => {
    if (!capture) return
    const url = URL.createObjectURL(capture.blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [capture])

  useEffect(() => {
    if (!capture || error) return
    const timer = window.setTimeout(() => setSlow(true), PATIENCE_MS)
    return () => window.clearTimeout(timer)
  }, [capture, error, attempt])

  /*
   * Wann der laufende Abschnitt begonnen hat. Als Ref und nicht als Zustand:
   * Der Wert löst kein Neuzeichnen aus, er wird nur beim Nachrechnen gelesen.
   * Dieser Effekt steht bewusst VOR dem Takt-Effekt darunter — React führt
   * Effekte in der Reihenfolge ihrer Deklaration aus, und die neue Startzeit
   * muss stehen, bevor zum ersten Mal damit gerechnet wird.
   */
  const phaseStartRef = useRef(Date.now())
  useEffect(() => {
    phaseStartRef.current = Date.now()
  }, [phase, attempt])

  useEffect(() => {
    if (!capture || error) return

    const tick = () =>
      setProgress((current) =>
        // Nie rückwärts: Beim Abschnittswechsel ist der neue Startwert höher
        // als der alte Stand, bei einem Nachzügler bleibt der alte stehen.
        Math.max(current, estimateProgress(phase, Date.now() - phaseStartRef.current)),
      )

    // Sofort einmal, damit der Sprung zum nächsten Abschnitt nicht erst nach
    // einem Takt sichtbar wird.
    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(timer)
  }, [capture, error, phase, attempt])

  useEffect(() => {
    if (!capture) return

    let cancelled = false
    let finishTimer = 0

    if (requestRef.current?.attempt !== attempt) {
      // Ein Ergebnis aus einem früheren Durchlauf hat hier nichts zu suchen.
      clearPendingExtraction()
      setError(null)
      setSlow(false)
      setPhase('vorbereiten')
      setProgress(0)
      phaseStartRef.current = Date.now()
      requestRef.current = { attempt, promise: extractReceipt(capture, setPhase) }
    }

    requestRef.current.promise.then(
      (result) => {
        if (cancelled) return
        setPendingExtraction(result)
        // Erst jetzt die volle Anzeige — vorher wäre sie eine Behauptung.
        setProgress(100)
        finishTimer = window.setTimeout(
          () => navigate('/scan/pruefen', { replace: true }),
          FINISH_MS,
        )
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(describe(cause))
      },
    )

    return () => {
      cancelled = true
      window.clearTimeout(finishTimer)
    }
  }, [capture, attempt, navigate])

  if (!capture) {
    return (
      <div className={styles.screen}>
        <div className={styles.note}>
          <h1 className={styles.headline}>Kein Bon zum Verarbeiten</h1>
          <p className={styles.sub}>
            Das Foto liegt nur im Arbeitsspeicher und überlebt kein Neuladen der Seite. Nimm den Bon
            bitte noch einmal auf.
          </p>
        </div>
        <Link to="/scan" replace className={styles.skip}>
          Bon aufnehmen
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.screen}>
        {preview && <img src={preview} alt="Aufgenommener Bon" className={styles.photo} />}
        <div className={styles.note} role="alert">
          <h1 className={styles.headline}>Erkennung fehlgeschlagen</h1>
          <p className={styles.sub}>{error.message}</p>
        </div>

        {error.raw && (
          <details className={styles.raw}>
            <summary className={styles.rawSummary}>Rohantwort des Modells</summary>
            <pre className={styles.rawText}>{error.raw}</pre>
          </details>
        )}

        <div className={styles.actions}>
          {error.retryable && (
            <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
              Noch einmal versuchen
            </button>
          )}
          <Link to="/scan" replace className={styles.skip}>
            Neu aufnehmen
          </Link>
        </div>
      </div>
    )
  }

  const current = STEPS.findIndex((step) => step.phase === phase)

  return (
    <div className={styles.screen}>
      <div className={styles.spinner} />
      <div style={{ textAlign: 'center' }}>
        <h1 className={styles.headline}>KI liest deinen Bon…</h1>
        <p className={styles.sub}>Positionen werden erkannt und Kategorien zugeordnet.</p>
      </div>

      {/*
        Derselbe Balken wie beim Monatsbudget auf der Übersicht — dieselbe
        Komponente, nicht nachgebaut. Damit kann er optisch gar nicht
        auseinanderlaufen.
      */}
      <div className={styles.progress}>
        <ProgressBar fraction={progress / 100} label="Fortschritt der Erkennung" />
        <div className={styles.progressValue}>{formatPercent(progress / 100)}</div>
      </div>

      <ol className={styles.steps} aria-live="polite">
        {STEPS.map((step, index) => {
          const complete = index < current
          return (
            <li
              key={step.phase}
              className={complete ? styles.step : `${styles.step} ${styles['step--pending']}`}
            >
              <span className={complete ? styles.tick : `${styles.tick} ${styles['tick--pending']}`}>
                {complete ? '✓' : ''}
              </span>
              {step.label}
            </li>
          )
        })}
      </ol>

      {slow && (
        <p className={styles.sub} role="status">
          Ein langer Bon braucht etwas. Bitte noch kurz warten – die Aufnahme läuft noch.
        </p>
      )}

      <p className={styles.meta}>
        {dimensions(capture)} · {sizeInKb(capture.blob.size)} · JPEG
      </p>
    </div>
  )
}
