import { Link } from 'react-router-dom'
import { CategoryDonut } from '../components/charts'
import { GearIcon } from '../components/icons'
import { OpenScanNotice } from '../components/OpenScanNotice'
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

/**
 * Ab welchem Tag des Monats die Hochrechnung überhaupt etwas aussagt.
 *
 * Vorher steht der bisherige Umsatz durch ein bis sechs Tage geteilt — das
 * schwankt so stark, dass die Zahl täglich um Hunderte Euro springt.
 */
const FORECAST_FROM_DAY = 7

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

      {/*
        Ganz oben und außerhalb von <Async>: Ein Scan, der auf dem Server fertig
        geworden ist, während iOS die Seite aus dem Speicher geworfen hat, soll
        auch dann zu sehen sein, wenn die Monatszahlen noch laden.
      */}
      <OpenScanNotice />

      <Async state={state}>{(data) => <DashboardBody data={data} />}</Async>
    </div>
  )
}

function DashboardBody({ data }: { data: DashboardData }) {
  const { summary } = data
  const budget = budgetState(summary)
  const slices = categorySlices(data.categoryTotals, getCategories())
  const categorisedCents = data.categoryTotals.reduce((sum, total) => sum + total.amountCents, 0)
  const uncategorisedCents = budget.spentCents - categorisedCents
  const previousMonthName = formatMonthName(shiftMonth(summary.month, -1))

  const foodSpendCents = data.unprocessedCents + data.processedCents
  const unprocessedShare = share(data.unprocessedCents, foodSpendCents)
  // Die Reihe enthält seit Schritt 19 auch Monate ohne Einkäufe (`score: null`).
  // Gezeigt wird der jüngste Monat, für den es wirklich eine Zahl gibt.
  const currentScore =
    [...data.scores].reverse().find((entry) => entry.score !== null)?.score ?? null

  const nothingThisMonth = budget.spentCents === 0 && summary.receiptCount === 0

  /*
   * Die Hochrechnung ist ein Dreisatz auf den heutigen Tag im Monat. Am 1. heißt
   * das „mal 31": Ein Wocheneinkauf für 50 € ergäbe „ca. 1.550 €" und „1.150 €
   * über Budget", am 2. wären es 775 €. Mathematisch richtig, als Aussage
   * unbrauchbar — und sie steht in Rot. Deshalb erscheint sie erst, wenn der
   * Monat genug Tage hat, um überhaupt ein Tempo zu zeigen.
   */
  const forecastDay = dayOfMonth(summary.asOf)
  const forecastReady = forecastDay >= FORECAST_FROM_DAY

  return (
    <>
      {nothingThisMonth ? (
        <EmptyState title={`Noch keine Einkäufe im ${formatMonth(summary.month)}`} scanHint>
          Sobald du den ersten Kassenzettel scannst, stehen hier deine Ausgaben – getrennt nach
          Lebensmitteln und Non-Food, mit dem Stand von heute.
        </EmptyState>
      ) : (
        <section className="card">
          {/*
            Vier Zahlen statt drei (KONZEPT-ERWEITERUNGEN.md, Abschnitt 1).
            Nebeneinander wären sie auf 390 px zu eng — bei 4-stelligen Beträgen
            bräche die Zeile um. Deshalb steht „Gesamt" groß in einer eigenen
            Zeile und die drei Teilbeträge kleiner darunter. Sie ergeben zusammen
            genau die große Zahl; dafür sorgt die Sicht, die Gastronomie aus
            „Lebensmittel" und „Non-Food" heraushält.
          */}
          <div className={styles.grandRow}>
            <div className={styles.totalLabel}>Gesamt</div>
            <div className={styles.grandTotalValue}>{formatEuro(budget.spentCents)}</div>
          </div>
          <div className={styles.totals}>
            <div className={styles.part}>
              <div className={styles.partLabel}>Lebensmittel</div>
              <div className={styles.partValue}>{formatEuro(summary.foodCents)}</div>
            </div>
            <div className={styles.part}>
              <div className={styles.partLabel}>Auswärts</div>
              <div className={styles.partValue}>{formatEuro(summary.diningCents)}</div>
            </div>
            <div className={styles.part}>
              <div className={styles.partLabel}>Non-Food</div>
              <div className={styles.partValue}>{formatEuro(summary.nonFoodCents)}</div>
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
            link={{ to: '/einstellungen/budget', label: 'Budget festlegen' }}
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
            ) : !forecastReady ? (
              <div className={`${styles.forecast} ${styles['forecast--ok']}`}>
                <div className={styles.forecastTitle}>Für eine Hochrechnung ist es noch früh</div>
                <div className={styles.forecastDetail}>
                  Ab dem {FORECAST_FROM_DAY}. steht hier, worauf der Monat bei diesem Tempo
                  hinausläuft. Vorher sagt ein einzelner Einkauf mehr über den Tag als über den
                  Monat.
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
          <>
            {/*
              Die Zahl in der Mitte ist die Summe der **Segmente**, nicht die
              Monatssumme. Bis Schritt 19 stand dort die Monatssumme, und der
              Ring behauptete damit, sie aufzuteilen — er kann es aber nicht:
              Trinkgeld gehört zu keiner Kategorie, Pfand- und Rabattzeilen auch
              nicht, und einer Position ohne Produkt fehlt sie noch. Wer die
              Legende addierte, kam auf einen anderen Betrag als auf die Mitte.
            */}
            <CategoryDonut slices={slices} totalCents={categorisedCents} />
            {uncategorisedCents > 0 && (
              <p className={styles.donutNote}>
                Dazu {formatEuro(uncategorisedCents)} ohne Kategorie – Trinkgeld, Pfand, Rabatte
                und Positionen, denen noch ein Produkt fehlt.
              </p>
            )}
          </>
        ) : (
          <EmptyState inline title="Noch keine Kategorien">
            Der Ring füllt sich, sobald Positionen erfasst und einem Produkt zugeordnet sind – Obst
            &amp; Gemüse, Milchprodukte, Non-Food und die übrigen.
          </EmptyState>
        )}
      </section>

      {currentScore === null ? (
        <section className="card">
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
