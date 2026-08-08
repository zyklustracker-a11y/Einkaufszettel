import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

export function ScanProcessing() {
  const navigate = useNavigate()
  const [done, setDone] = useState(0)

  useEffect(() => {
    const timers = STEP_TIMINGS.map((delay, index) =>
      window.setTimeout(() => setDone(index + 1), delay),
    )
    timers.push(window.setTimeout(() => navigate('/scan/pruefen', { replace: true }), HANDOFF))
    return () => timers.forEach(window.clearTimeout)
  }, [navigate])

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
