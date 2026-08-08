import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ExtractionError, extractReceipt } from '../data'
import type { ExtractionPhase } from '../data'
import type { CapturedImage } from '../lib/camera'
import type { ExtractionResponse } from '../lib/extraction'
import { getPendingCapture } from '../lib/capture'
import { clearPendingExtraction, setPendingExtraction } from '../lib/scanResult'
import styles from './ScanProcessing.module.css'

/**
 * Die drei Abschnitte in der Reihenfolge, in der sie durchlaufen werden, mit
 * dem Text, den der Nutzer dazu liest.
 *
 * Jeder Haken hier steht für einen Abschnitt, der wirklich fertig ist — keiner
 * läuft nach Stoppuhr weiter. Genau deshalb sind es nur drei: Mehr lässt sich
 * von außen nicht beobachten.
 */
const STEPS: Array<{ phase: ExtractionPhase; label: string }> = [
  { phase: 'vorbereiten', label: 'Bild wird vorbereitet…' },
  { phase: 'senden', label: 'Mistral liest den Bon…' },
  { phase: 'auswerten', label: 'Ergebnis wird geprüft…' },
]

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

  useEffect(() => {
    if (!capture) return

    let cancelled = false

    if (requestRef.current?.attempt !== attempt) {
      // Ein Ergebnis aus einem früheren Durchlauf hat hier nichts zu suchen.
      clearPendingExtraction()
      setError(null)
      setSlow(false)
      setPhase('vorbereiten')
      requestRef.current = { attempt, promise: extractReceipt(capture, setPhase) }
    }

    requestRef.current.promise.then(
      (result) => {
        if (cancelled) return
        setPendingExtraction(result)
        navigate('/scan/pruefen', { replace: true })
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(describe(cause))
      },
    )

    return () => {
      cancelled = true
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
