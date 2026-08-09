import { useState } from 'react'
import { Sparkline } from '../components/charts'
import { Async, EmptyState } from '../components/states'
import { getHealthData, useQuery } from '../data'
import type { HealthData } from '../data'
import { share } from '../lib/derive'
import { formatEuro, formatMonthName, formatMonthShort, formatPercent } from '../lib/format'
import type { TraitSpending } from '../lib/score'
import { weightLabel } from '../lib/weights'
import styles from './Health.module.css'

/** How many critical traits are shown before "Alle anzeigen". */
const VISIBLE_CONCERNS = 5

export function Health() {
  const state = useQuery(getHealthData, [])

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Gesundheit</h1>
      <Async state={state}>{(data) => <HealthBody data={data} />}</Async>
    </div>
  )
}

function HealthBody({ data }: { data: HealthData }) {
  const [showAllConcerns, setShowAllConcerns] = useState(false)

  const scores = data.scores
  /*
   * Seit Schritt 19 enthält die Reihe auch Monate ohne Einkäufe — mit `null`
   * statt einer Zahl, damit die Zeitachse stimmt. Für „aktuell" und „davor"
   * zählen deshalb nur die Monate, in denen wirklich etwas gekauft wurde.
   */
  const withScore = scores.filter(
    (entry): entry is { month: string; score: number } => entry.score !== null,
  )
  const current = withScore.length > 0 ? withScore[withScore.length - 1] : null
  const previous = withScore.length > 1 ? withScore[withScore.length - 2] : null
  const delta = current && previous ? current.score - previous.score : 0

  const foodSpendCents = data.unprocessedCents + data.processedCents
  const unprocessedShare = share(data.unprocessedCents, foodSpendCents)

  // Beide Listen entstehen aus den Merkmalen, nicht aus festem Text: Worauf der
  // Haushalt achtet, taucht hier von selbst auf.
  const critical = data.spending.filter((row) => row.trait.weight < 0)
  // Alles, was nicht kritisiert wird — damit ein positiv gewichtetes Merkmal
  // nicht stillschweigend aus beiden Listen fällt.
  const watched = data.spending.filter((row) => row.trait.weight >= 0)
  const visible = showAllConcerns ? critical : critical.slice(0, VISIBLE_CONCERNS)

  if (current === null) {
    return (
      <EmptyState title="Noch keine Auswertung" scanHint>
        Der Gesundheits-Score entsteht aus den Merkmalen deiner Lebensmittel – Hochverarbeitet,
        Industriezucker, Weizen und die übrigen –, gewichtet nach ihrem Euro-Anteil. Nach dem ersten
        Bon stehen hier eine Zahl von 0 bis 100, der Verlauf über die Monate und deine kritischsten
        Ausgaben.
      </EmptyState>
    )
  }

  return (
    <>
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

        {/*
          Ein einzelner Monat ergibt keine Kurve. Statt einer Linie aus einem
          Punkt steht dann ein Satz da, was hier später zu sehen sein wird.
        */}
        {withScore.length > 1 ? (
          <>
            <div style={{ marginTop: 18 }}>
              <Sparkline
                values={scores.map((s) => s.score)}
                height={90}
                label="Gesundheits-Score im Verlauf"
              />
            </div>
            {/*
              Alle Monate der Reihe, auch die leeren: Nur so steht die
              Beschriftung unter dem Punkt, zu dem sie gehört.
            */}
            <div className={styles.months}>
              {scores.map((s) => (
                <span key={s.month}>{formatMonthShort(s.month)}</span>
              ))}
            </div>
            {scores.length > withScore.length && (
              <p className={styles.gapNote}>
                In {scores.length - withScore.length}{' '}
                {scores.length - withScore.length === 1 ? 'Monat' : 'Monaten'} dazwischen ist kein
                Einkauf erfasst – die Linie setzt dort aus, statt einen Verlauf zu behaupten.
              </p>
            )}
          </>
        ) : (
          <p className={styles.empty} style={{ marginTop: 16 }}>
            Ab dem zweiten Monat mit Einkäufen zeigt sich hier der Verlauf.
          </p>
        )}
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: foodSpendCents > 0 ? 16 : 0 }}>
          Unverarbeitet vs. verarbeitet
        </div>
        {foodSpendCents > 0 ? (
          <>
            <div className={styles.split} role="img" aria-label="Anteil unverarbeiteter Lebensmittel">
              <div
                className={styles.splitUnprocessed}
                style={{ width: `${(unprocessedShare * 100).toFixed(1)}%` }}
              />
              <div
                className={styles.splitProcessed}
                style={{ width: `${((1 - unprocessedShare) * 100).toFixed(1)}%` }}
              />
            </div>
            <div className={styles.splitLegend}>
              <div>
                <span className={styles.splitValue}>{formatPercent(unprocessedShare)}</span>{' '}
                <span className="muted">
                  unverarbeitet · {formatEuro(data.unprocessedCents)}
                </span>
              </div>
              <div>
                <span className={styles.splitValue}>{formatPercent(1 - unprocessedShare)}</span>{' '}
                <span className="muted">{formatEuro(data.processedCents)}</span>
              </div>
            </div>
          </>
        ) : (
          <EmptyState inline title="Noch keine Lebensmittel erfasst">
            Hier teilt sich später dein Lebensmittel-Budget in unverarbeitet und hochverarbeitet
            auf – in Euro, nicht in Stückzahlen.
          </EmptyState>
        )}
      </section>

      <h2 className="sectionLabel">Kritische Ausgaben</h2>
      {critical.length === 0 && (
        <p className={styles.empty}>
          Keine kritischen Merkmale in diesem Zeitraum. Sobald Produkte mit Merkmalen wie
          Industriezucker oder Samenöl dabei sind, stehen sie hier – nach Eurobetrag sortiert.
        </p>
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
                  {/*
                    Bei den positiven Merkmalen steht die Stufe dabei: „Sehr gut"
                    erklärt, warum Rohmilch hier und nicht unter „Kritisch"
                    steht. Bei den neutralen bliebe sie stumm — „Neutral" sagt
                    dasselbe wie die Überschrift „Beobachtet" darüber.
                  */}
                  <div className={styles.watchedDetail}>
                    {row.trait.weight > 0 && `${weightLabel(row.trait.weight)} · `}
                    {row.itemCount} {row.itemCount === 1 ? 'Position' : 'Positionen'}
                  </div>
                </div>
                <div className={styles.watchedAmount}>{formatEuro(row.amountCents)}</div>
              </div>
            ))}
          </section>
        </>
      )}
    </>
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
        {/*
          Die Stufe unter dem Namen, seit Schritt 16. Ohne sie sehen alle
          kritischen Merkmale gleich schwer aus, obwohl „Stark ungünstig" das
          Dreifache von „Leicht ungünstig" wiegt — und die Karten sind nach Euro
          sortiert, nicht nach Gewicht. Gedämpft und nicht in der Farbe der
          Stufe: In diesem Abschnitt ist Rot schon vergeben.
        */}
        <div className={styles.concernTitle}>
          {trait.label}
          <span className={styles.concernLevel}>{weightLabel(trait.weight)}</span>
        </div>
        <div className={styles.concernAmount}>{formatEuro(amountCents)}</div>
      </div>
      <p className={styles.concernDetail}>
        {trait.description} {itemCount} {itemCount === 1 ? 'Position' : 'Positionen'} im Zeitraum.
      </p>
      <div className={styles.tip}>{trait.tip}</div>
    </section>
  )
}
