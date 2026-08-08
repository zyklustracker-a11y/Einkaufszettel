import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CapturedImage } from '../lib/camera'
import { getPendingCapture } from '../lib/capture'
import styles from './ScanProcessing.module.css'

/** Milliseconds at which each recognition step reports done. */
const STEP_TIMINGS = [700, 1400, 2400]
const HANDOFF = 2900

/**
 * Platzhalter für die Erkennung.
 *
 * Bis Schritt 4 gibt es hier nichts zu erkennen: Der Screen liest bewusst keine
 * Daten mehr (früher kam der „gescannte" Bon aus den Mocks). Die Schritte
 * beschreiben deshalb, was passieren *wird*, und nennen keine Zahlen, die es
 * noch gar nicht gibt.
 */
const STEPS = [
  'Bild wird hochgeladen…',
  'Händler und Datum werden gelesen…',
  'Positionen werden Kategorien und Merkmalen zugeordnet…',
]

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
 * Zwischenstation nach der Aufnahme.
 *
 * Seit Schritt 4a kommt hier ein echtes Foto an. Solange die Erkennung fehlt
 * (Schritt 4b), zeigt der Screen genau das: das Bild, seine Maße und den
 * Hinweis, dass weder hochgeladen noch gespeichert wird. Nichts vorgaukeln,
 * was es noch nicht gibt.
 *
 * Ohne Foto – etwa nach einem Neuladen der Seite oder beim direkten Aufruf der
 * Adresse – bleibt der bisherige Ablauf des Entwurfs erhalten und führt weiter
 * zum Korrektur-Screen.
 */
export function ScanProcessing() {
  const navigate = useNavigate()
  const [done, setDone] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)

  const capture = getPendingCapture()

  useEffect(() => {
    if (!capture) return
    const url = URL.createObjectURL(capture.blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [capture])

  useEffect(() => {
    if (capture) return
    const timers = STEP_TIMINGS.map((delay, index) =>
      window.setTimeout(() => setDone(index + 1), delay),
    )
    timers.push(window.setTimeout(() => navigate('/scan/pruefen', { replace: true }), HANDOFF))
    return () => timers.forEach(window.clearTimeout)
  }, [capture, navigate])

  if (capture) {
    return (
      <div className={styles.screen}>
        {preview && <img src={preview} alt="Aufgenommener Bon" className={styles.photo} />}

        <div className={styles.note}>
          <h1 className={styles.headline}>Bon aufgenommen</h1>
          <p className={styles.sub}>
            Die Erkennung ist noch nicht gebaut. Das Bild bleibt vorerst auf dem Gerät – es wird
            weder hochgeladen noch gespeichert.
          </p>
          <p className={styles.meta}>
            {dimensions(capture)} · {sizeInKb(capture.blob.size)} · JPEG
          </p>
        </div>

        <Link to="/scan" replace className={styles.skip}>
          Neuen Bon aufnehmen
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.spinner} />
      <div style={{ textAlign: 'center' }}>
        <h1 className={styles.headline}>KI liest deinen Bon…</h1>
        <p className={styles.sub}>Positionen werden erkannt und Kategorien zugeordnet.</p>
      </div>

      <ol className={styles.steps} aria-live="polite">
        {STEPS.map((label, index) => {
          const complete = index < done
          return (
            <li key={label} className={complete ? styles.step : `${styles.step} ${styles['step--pending']}`}>
              <span className={complete ? styles.tick : `${styles.tick} ${styles['tick--pending']}`}>
                {complete ? '✓' : ''}
              </span>
              {label}
            </li>
          )
        })}
      </ol>

      <Link to="/scan/pruefen" replace className={styles.skip}>
        Ergebnis anzeigen
      </Link>
    </div>
  )
}
