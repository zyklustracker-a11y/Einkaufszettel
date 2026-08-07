import { Sparkline } from '../components/charts'
import { getHealthConcerns, getHealthFlag, getHealthSummary } from '../data'
import { formatEuro, formatEuroWhole, formatMonthName, formatMonthShort, formatPercent } from '../lib/format'
import styles from './Health.module.css'

export function Health() {
  const health = getHealthSummary()
  const scores = health.scores
  const current = scores[scores.length - 1]
  const previous = scores[scores.length - 2]
  const delta = previous ? current.score - previous.score : 0

  const foodSpend = health.unprocessed + health.processed
  const unprocessedShare = health.unprocessed / foodSpend

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Gesundheit</h1>

      <section className={styles.scoreCard}>
        <div className={styles.scoreRow}>
          <div className={styles.score}>{current.score}</div>
          <div className={styles.scoreMeta}>
            <div className={styles.scoreOf}>von 100 · {formatMonthName(current.month)}</div>
            {previous && (
              <div className={delta >= 0 ? styles.delta : `${styles.delta} ${styles['delta--down']}`}>
                {delta >= 0 ? '+' : '−'}
                {Math.abs(delta)} gegenüber {formatMonthName(previous.month)}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <Sparkline values={scores.map((s) => s.score)} height={90} label="Gesundheits-Score im Verlauf" />
        </div>
        <div className={styles.months}>
          {scores.map((s) => (
            <span key={s.month}>{formatMonthShort(s.month)}</span>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: 16 }}>
          Unverarbeitet vs. verarbeitet
        </div>
        <div className={styles.split} role="img" aria-label="Anteil unverarbeiteter Lebensmittel">
          <div className={styles.splitUnprocessed} style={{ width: `${(unprocessedShare * 100).toFixed(1)}%` }} />
          <div className={styles.splitProcessed} style={{ width: `${((1 - unprocessedShare) * 100).toFixed(1)}%` }} />
        </div>
        <div className={styles.splitLegend}>
          <div>
            <span className={styles.splitValue}>{formatPercent(unprocessedShare)}</span>{' '}
            <span className="muted">unverarbeitet · {formatEuro(health.unprocessed)}</span>
          </div>
          <div>
            <span className={styles.splitValue}>{formatPercent(1 - unprocessedShare)}</span>{' '}
            <span className="muted">{formatEuro(health.processed)}</span>
          </div>
        </div>
      </section>

      <h2 className="sectionLabel">Kritische Ausgaben</h2>
      {getHealthConcerns().map((concern) => (
        <section key={concern.flag} className={styles.concern}>
          <div className={styles.concernHead}>
            <div className={styles.concernIcon} aria-hidden="true">
              {getHealthFlag(concern.flag).letter}
            </div>
            <div className={styles.concernTitle}>{concern.title}</div>
            <div className={styles.concernAmount}>{formatEuroWhole(concern.amount)}</div>
          </div>
          <p className={styles.concernDetail}>{concern.detail}</p>
          <div className={styles.tip}>{concern.tip}</div>
        </section>
      ))}
    </div>
  )
}
