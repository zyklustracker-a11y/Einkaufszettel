import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getMerchantName, getScannedReceipt } from '../data'
import { formatDate } from '../lib/format'
import styles from './ScanProcessing.module.css'

/** Milliseconds at which each recognition step reports done. */
const STEP_TIMINGS = [700, 1400, 2400]
const HANDOFF = 2900

/**
 * Stand-in for the OCR round trip. Steps tick over one by one, then the flow
 * moves on to the correction screen by itself; the link is there for anyone who
 * does not want to wait.
 */
export function ScanProcessing() {
  const navigate = useNavigate()
  const receipt = getScannedReceipt()
  const [done, setDone] = useState(0)

  useEffect(() => {
    const timers = STEP_TIMINGS.map((delay, index) => window.setTimeout(() => setDone(index + 1), delay))
    timers.push(window.setTimeout(() => navigate('/scan/pruefen', { replace: true }), HANDOFF))
    return () => timers.forEach(window.clearTimeout)
  }, [navigate])

  const steps = [
    `Händler erkannt: ${getMerchantName(receipt.merchantId)}`,
    `Datum: ${formatDate(receipt.date)}`,
    `${receipt.items.length} Positionen normalisieren…`,
  ]

  return (
    <div className={styles.screen}>
      <div className={styles.spinner} />
      <div style={{ textAlign: 'center' }}>
        <h1 className={styles.headline}>KI liest deinen Bon…</h1>
        <p className={styles.sub}>Positionen werden erkannt und Kategorien zugeordnet.</p>
      </div>

      <ol className={styles.steps} aria-live="polite">
        {steps.map((label, index) => {
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
