import { useState } from 'react'
import { Sparkline } from '../components/charts'
import { getFoodItems, getHealthSummary, getTraits } from '../data'
import { formatEuro, formatMonthName, formatMonthShort, formatPercent } from '../lib/format'
import { traitSpending } from '../lib/score'
import type { TraitSpending } from '../lib/score'
import styles from './Health.module.css'

/** How many critical traits are shown before "Alle anzeigen". */
const VISIBLE_CONCERNS = 5

export function Health() {
  const health = getHealthSummary()
  const [showAllConcerns, setShowAllConcerns] = useState(false)

  const scores = health.scores
  const current = scores[scores.length - 1]
  const previous = scores[scores.length - 2]
  const delta = previous ? current.score - previous.score : 0

  const foodSpendCents = health.unprocessedCents + health.processedCents
  const unprocessedShare = health.unprocessedCents / foodSpendCents

  // Both lists come from the traits, not from hard-wired copy: whatever the
  // household watches shows up here on its own.
  const spending = traitSpending(getFoodItems(), getTraits())
  const critical = spending.filter((row) => row.trait.weight < 0)
  // Everything that is not criticised, so a positively weighted trait cannot
  // silently fall out of both lists.
  const watched = spending.filter((row) => row.trait.weight >= 0)
  const visible = showAllConcerns ? critical : critical.slice(0, VISIBLE_CONCERNS)

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
            <span className="muted">unverarbeitet · {formatEuro(health.unprocessedCents)}</span>
          </div>
          <div>
            <span className={styles.splitValue}>{formatPercent(1 - unprocessedShare)}</span>{' '}
            <span className="muted">{formatEuro(health.processedCents)}</span>
          </div>
        </div>
      </section>

      <h2 className="sectionLabel">Kritische Ausgaben</h2>
      {critical.length === 0 && (
        <p className={styles.empty}>Keine kritischen Merkmale in diesem Zeitraum.</p>
      )}
      {visible.map((row) => (
        <ConcernCard key={row.trait.id} row={row} />
      ))}
      {critical.length > VISIBLE_CONCERNS && !showAllConcerns && (
        <button type="button" className={styles.showAll} onClick={() => setShowAllConcerns(true)}>
          Alle anzeigen ({critical.length})
        </button>
      )}

      {watched.length > 0 && (
        <>
          <h2 className="sectionLabel">Beobachtet</h2>
          <section className={styles.watchedCard}>
            {watched.map((row) => (
              <div key={row.trait.id} className={styles.watchedRow}>
                <div
                  className={`${styles.concernIcon} ${
                    row.trait.weight > 0 ? styles['concernIcon--positive'] : styles['concernIcon--neutral']
                  }`}
                  aria-hidden="true"
                >
                  {row.trait.short}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.watchedTitle}>{row.trait.label}</div>
                  <div className={styles.watchedDetail}>
                    {row.itemCount} {row.itemCount === 1 ? 'Position' : 'Positionen'}
                  </div>
                </div>
                <div className={styles.watchedAmount}>{formatEuro(row.amountCents)}</div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  )
}

function ConcernCard({ row }: { row: TraitSpending }) {
  const { trait, amountCents, itemCount } = row
  return (
    <section className={styles.concern}>
      <div className={styles.concernHead}>
        <div className={styles.concernIcon} aria-hidden="true">
          {trait.short}
        </div>
        <div className={styles.concernTitle}>{trait.label}</div>
        <div className={styles.concernAmount}>{formatEuro(amountCents)}</div>
      </div>
      <p className={styles.concernDetail}>
        {trait.description} {itemCount} {itemCount === 1 ? 'Position' : 'Positionen'} im Zeitraum.
      </p>
      <div className={styles.tip}>{trait.tip}</div>
    </section>
  )
}
