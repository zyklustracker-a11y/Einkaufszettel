import { Link } from 'react-router-dom'
import { CategoryDonut } from '../components/charts'
import { GearIcon } from '../components/icons'
import { Avatar, ProgressBar } from '../components/ui'
import {
  getCategories,
  getCategoryTotals,
  getHealthSummary,
  getMonthSummary,
  getRecentReceipts,
} from '../data'
import { budgetState, categorySlices } from '../lib/derive'
import {
  dayOfMonth,
  formatDate,
  formatEuro,
  formatEuroSigned,
  formatEuroWhole,
  formatLongDate,
  formatMonth,
  formatMonthName,
  formatPercent,
  shiftMonth,
} from '../lib/format'
import { useAppState } from '../state/AppState'
import styles from './Dashboard.module.css'

export function Dashboard() {
  const { settings } = useAppState()
  const summary = { ...getMonthSummary(), budget: settings.monthlyBudget }
  const budget = budgetState(summary)
  const slices = categorySlices(getCategoryTotals(), getCategories())
  const health = getHealthSummary()
  const recent = getRecentReceipts()

  const score = health.scores[health.scores.length - 1].score
  const foodSpend = health.unprocessed + health.processed
  const unprocessedShare = health.unprocessed / foodSpend
  const previousMonthName = formatMonthName(shiftMonth(summary.month, -1))

  return (
    <div className="screen screen--tabbed">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Übersicht</div>
          <h1 className={styles.month}>{formatMonth(summary.month)}</h1>
        </div>
        <Link to="/einstellungen" className={styles.iconButton} aria-label="Einstellungen">
          <GearIcon />
        </Link>
      </header>

      <section className="card">
        <div className={styles.totals}>
          <div style={{ flex: 1 }}>
            <div className={styles.totalLabel}>Lebensmittel</div>
            <div className={styles.totalValue}>{formatEuro(summary.food)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className={styles.totalLabel}>Non-Food</div>
            <div className={styles.totalValue}>{formatEuro(summary.nonFood)}</div>
          </div>
          <div className={styles.grandTotal}>
            <div className={styles.totalLabel}>Gesamt</div>
            <div className={styles.grandTotalValue}>{formatEuro(budget.spent)}</div>
          </div>
        </div>
        <div className={styles.asOf}>
          Stand: {formatLongDate(summary.asOf)} · {summary.receiptCount} Einkäufe
        </div>
      </section>

      <section className="card">
        <div className={styles.cardHead}>
          <div className="cardTitle">Monatsbudget</div>
          <div className={styles.budgetSpent}>
            {formatEuro(budget.spent)} von {formatEuro(budget.budget)}
          </div>
        </div>
        <ProgressBar
          fraction={budget.barFraction}
          markerFraction={budget.budgetMarkFraction}
          over={budget.spent > budget.budget}
          label="Monatsbudget"
        />
        <div className={styles.scaleRow}>
          <div>{formatPercent(budget.usedFraction)} genutzt</div>
          <div>Budget {formatEuroWhole(budget.budget)}</div>
        </div>

        {budget.overBudget > 0 ? (
          <div className={styles.forecast}>
            <div className={styles.forecastTitle}>Bei diesem Tempo: ca. {formatEuroWhole(budget.forecast)}</div>
            <div className={styles.forecastDetail}>
              {formatEuroWhole(budget.overBudget)} über Budget zum Monatsende
            </div>
          </div>
        ) : (
          <div className={`${styles.forecast} ${styles['forecast--ok']}`}>
            <div className={styles.forecastTitle}>Bei diesem Tempo: ca. {formatEuroWhole(budget.forecast)}</div>
            <div className={styles.forecastDetail}>
              {formatEuroWhole(Math.abs(budget.overBudget))} unter Budget zum Monatsende
            </div>
          </div>
        )}

        <div className={styles.comparison}>
          <span className={budget.vsPreviousMonth > 0 ? styles.delta : `${styles.delta} ${styles['delta--down']}`}>
            {formatEuroSigned(budget.vsPreviousMonth)}
          </span>
          gegenüber {previousMonthName} am {dayOfMonth(summary.asOf)}. (
          {formatEuro(summary.previousMonthToDate)})
        </div>
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: 16 }}>
          Ausgaben pro Kategorie
        </div>
        <CategoryDonut slices={slices} total={budget.spent} />
      </section>

      <Link to="/gesundheit" className={`card ${styles.healthCard}`}>
        <div style={{ flex: 1 }}>
          <div className="cardTitle">Gesundheits-Score</div>
          <div className={styles.healthSplit}>
            Unverarbeitet {formatPercent(unprocessedShare)} · verarbeitet {formatPercent(1 - unprocessedShare)}
          </div>
          <div className={styles.healthTrack}>
            <div className={styles.healthFill} style={{ width: `${score}%` }} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={styles.score}>{score}</div>
          <div className={styles.scoreCaption}>von 100</div>
        </div>
      </Link>

      <section className={styles.listCard}>
        <div className={styles.listTitle}>Letzte Einkäufe</div>
        {recent.map((receipt) => (
          <Link key={receipt.id} to={`/einkauf/${receipt.id}`} className={styles.receiptRow}>
            <Avatar name={receipt.merchant} />
            <span style={{ flex: 1 }}>
              <span className={styles.merchant}>{receipt.merchant}</span>
              <span className={styles.receiptMeta}>
                {formatDate(receipt.date)} · {receipt.items.length} Positionen
              </span>
            </span>
            <span className={styles.receiptTotal}>{formatEuro(receipt.printedTotal)}</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
