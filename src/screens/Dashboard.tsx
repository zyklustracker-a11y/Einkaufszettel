import { Link } from 'react-router-dom'
import { CategoryDonut } from '../components/charts'
import { GearIcon } from '../components/icons'
import { Async, EmptyState } from '../components/states'
import { Avatar, ProgressBar } from '../components/ui'
import { getCategories, getDashboardData, getMerchantName, useQuery } from '../data'
import type { DashboardData } from '../data'
import { budgetState, categorySlices, share } from '../lib/derive'
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
import styles from './Dashboard.module.css'

export function Dashboard() {
  const state = useQuery(getDashboardData, [])

  return (
    <div className="screen screen--tabbed">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Übersicht</div>
          <h1 className={styles.month}>
            {state.data ? formatMonth(state.data.summary.month) : 'Übersicht'}
          </h1>
        </div>
        <Link to="/einstellungen" className={styles.iconButton} aria-label="Einstellungen">
          <GearIcon />
        </Link>
      </header>

      <Async state={state}>{(data) => <DashboardBody data={data} />}</Async>
    </div>
  )
}

function DashboardBody({ data }: { data: DashboardData }) {
  const { summary } = data
  const budget = budgetState(summary)
  const slices = categorySlices(data.categoryTotals, getCategories())
  const previousMonthName = formatMonthName(shiftMonth(summary.month, -1))

  const foodSpendCents = data.unprocessedCents + data.processedCents
  const unprocessedShare = share(data.unprocessedCents, foodSpendCents)
  const currentScore = data.scores.length > 0 ? data.scores[data.scores.length - 1].score : null

  const nothingThisMonth = budget.spentCents === 0 && summary.receiptCount === 0

  return (
    <>
      {nothingThisMonth ? (
        <EmptyState title={`Noch keine Einkäufe im ${formatMonth(summary.month)}`} scanHint>
          Sobald du den ersten Kassenzettel scannst, stehen hier deine Ausgaben – getrennt nach
          Lebensmitteln und Non-Food, mit dem Stand von heute.
        </EmptyState>
      ) : (
        <section className="card">
          <div className={styles.totals}>
            <div style={{ flex: 1 }}>
              <div className={styles.totalLabel}>Lebensmittel</div>
              <div className={styles.totalValue}>{formatEuro(summary.foodCents)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className={styles.totalLabel}>Non-Food</div>
              <div className={styles.totalValue}>{formatEuro(summary.nonFoodCents)}</div>
            </div>
            <div className={styles.grandTotal}>
              <div className={styles.totalLabel}>Gesamt</div>
              <div className={styles.grandTotalValue}>{formatEuro(budget.spentCents)}</div>
            </div>
          </div>
          <div className={styles.asOf}>
            Stand: {formatLongDate(summary.asOf)} · {summary.receiptCount}{' '}
            {summary.receiptCount === 1 ? 'Einkauf' : 'Einkäufe'}
          </div>
        </section>
      )}

      <section className="card">
        <div className={styles.cardHead}>
          <div className="cardTitle">Monatsbudget</div>
          {budget.hasBudget && (
            <div className={styles.budgetSpent}>
              {formatEuro(budget.spentCents)} von {formatEuro(budget.budgetCents)}
            </div>
          )}
        </div>

        {!budget.hasBudget ? (
          <EmptyState
            inline
            title="Noch kein Budget gesetzt"
            link={{ to: '/einstellungen', label: 'Budget festlegen' }}
          >
            Leg in den Einstellungen fest, wie viel du im Monat ausgeben möchtest. Danach siehst du
            hier, wie viel davon schon verbraucht ist.
          </EmptyState>
        ) : (
          <>
            <ProgressBar
              fraction={budget.barFraction}
              markerFraction={budget.budgetMarkFraction}
              over={budget.spentCents > budget.budgetCents}
              label="Monatsbudget"
            />
            <div className={styles.scaleRow}>
              <div>{formatPercent(budget.usedFraction)} genutzt</div>
              <div>Budget {formatEuroWhole(budget.budgetCents)}</div>
            </div>

            {/*
              Ohne Ausgaben gibt es nichts hochzurechnen — die Zeile „0 € bei
              diesem Tempo" wäre richtig, aber nichtssagend.
            */}
            {budget.spentCents === 0 ? (
              <div className={`${styles.forecast} ${styles['forecast--ok']}`}>
                <div className={styles.forecastTitle}>Noch nichts ausgegeben</div>
                <div className={styles.forecastDetail}>
                  Die Hochrechnung erscheint, sobald der erste Einkauf erfasst ist.
                </div>
              </div>
            ) : (
              <div
                className={
                  budget.overBudgetCents > 0
                    ? styles.forecast
                    : `${styles.forecast} ${styles['forecast--ok']}`
                }
              >
                <div className={styles.forecastTitle}>
                  Bei diesem Tempo: ca. {formatEuroWhole(budget.forecastCents)}
                </div>
                <div className={styles.forecastDetail}>
                  {formatEuroWhole(Math.abs(budget.overBudgetCents))}{' '}
                  {budget.overBudgetCents > 0 ? 'über' : 'unter'} Budget zum Monatsende
                </div>
              </div>
            )}

            {summary.previousMonthToDateCents > 0 && (
              <div className={styles.comparison}>
                <span
                  className={
                    budget.vsPreviousMonthCents > 0
                      ? styles.delta
                      : `${styles.delta} ${styles['delta--down']}`
                  }
                >
                  {formatEuroSigned(budget.vsPreviousMonthCents)}
                </span>
                gegenüber {previousMonthName} am {dayOfMonth(summary.asOf)}. (
                {formatEuro(summary.previousMonthToDateCents)})
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: slices.length > 0 ? 16 : 0 }}>
          Ausgaben pro Kategorie
        </div>
        {slices.length > 0 ? (
          <CategoryDonut slices={slices} totalCents={budget.spentCents} />
        ) : (
          <EmptyState inline title="Noch keine Kategorien">
            Der Ring füllt sich, sobald Positionen erfasst und einem Produkt zugeordnet sind – Obst
            &amp; Gemüse, Milchprodukte, Non-Food und die übrigen.
          </EmptyState>
        )}
      </section>

      {currentScore === null ? (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="cardTitle">Gesundheits-Score</div>
          <EmptyState inline title="Noch kein Score">
            Der Score entsteht aus den Merkmalen deiner Lebensmittel, gewichtet nach ihrem
            Euro-Anteil. Nach dem ersten Bon steht hier eine Zahl von 0 bis 100.
          </EmptyState>
        </section>
      ) : (
        <Link to="/gesundheit" className={`card ${styles.healthCard}`}>
          <div style={{ flex: 1 }}>
            <div className="cardTitle">Gesundheits-Score</div>
            <div className={styles.healthSplit}>
              Unverarbeitet {formatPercent(unprocessedShare)} · verarbeitet{' '}
              {formatPercent(1 - unprocessedShare)}
            </div>
            <div className={styles.healthTrack}>
              <div className={styles.healthFill} style={{ width: `${currentScore}%` }} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={styles.score}>{currentScore}</div>
            <div className={styles.scoreCaption}>von 100</div>
          </div>
        </Link>
      )}

      <section className={styles.listCard}>
        <div className={styles.listTitle}>Letzte Einkäufe</div>
        {data.recent.length === 0 ? (
          <EmptyState inline title="Noch keine Einkäufe">
            Hier stehen später deine letzten drei Einkäufe mit Laden, Datum und Summe.
          </EmptyState>
        ) : (
          data.recent.map((receipt) => (
            <Link key={receipt.id} to={`/einkauf/${receipt.id}`} className={styles.receiptRow}>
              <Avatar name={getMerchantName(receipt.merchantId ?? '')} />
              <span style={{ flex: 1 }}>
                <span className={styles.merchant}>
                  {getMerchantName(receipt.merchantId ?? '')}
                </span>
                <span className={styles.receiptMeta}>
                  {formatDate(receipt.date)} · {receipt.itemCount}{' '}
                  {receipt.itemCount === 1 ? 'Position' : 'Positionen'}
                </span>
              </span>
              <span className={styles.receiptTotal}>{formatEuro(receipt.totalCents)}</span>
            </Link>
          ))
        )}
      </section>
    </>
  )
}
