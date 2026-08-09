import { useState } from 'react'
import { BarChart, CategoryBars, SparkAxis, Sparkline } from '../components/charts'
import { Async, EmptyState } from '../components/states'
import { SearchField } from '../components/ui'
import { getAnalyticsData, getCategories, getMerchantName, searchItemSpending, useQuery } from '../data'
import type { AnalyticsData } from '../data'
import { categorySlices } from '../lib/derive'
import {
  formatEuro,
  formatEuroSigned,
  formatEuroWhole,
  formatLitres,
  formatMonth,
  formatMonthShort,
  formatPricePerLitre,
} from '../lib/format'
import { rangeLabel, trendPoints } from '../lib/trend'
import type { FuelMonth, RangeId } from '../types'
import styles from './Analytics.module.css'

const RANGE_IDS: RangeId[] = ['week', 'month', 'year', 'custom']

export function Analytics() {
  const state = useQuery(getAnalyticsData, [])

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Analysen</h1>
      <Async state={state}>{(data) => <AnalyticsBody data={data} />}</Async>
    </div>
  )
}

function AnalyticsBody({ data }: { data: AnalyticsData }) {
  const [range, setRange] = useState<RangeId>('year')

  const bars = trendPoints(data.buckets, range)
  const labels = rangeLabel(data.buckets, range, data.month)
  const slices = categorySlices(data.categoryTotals, getCategories())
  const excessCents = data.savings.reduce((sum, row) => sum + row.excessCents, 0)

  // Nur Monatstöpfe können ein Monatsbudget reißen, deshalb gilt der Hinweis
  // ausschließlich für den Jahresverlauf – und nur, wenn überhaupt eines gesetzt ist.
  const overBudget =
    range === 'year' && data.budgetCents > 0
      ? bars.filter((bar) => bar.amountCents > data.budgetCents)
      : []

  const hasTrend = bars.some((bar) => bar.amountCents > 0)

  return (
    <>
      <div className={styles.ranges} role="tablist" aria-label="Zeitraum">
        {RANGE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === range}
            className={id === range ? `${styles.range} ${styles['range--active']}` : styles.range}
            onClick={() => setRange(id)}
          >
            {rangeLabel(data.buckets, id, data.month).tab}
          </button>
        ))}
      </div>

      <section className="card">
        <div className={styles.cardHead}>
          <div className="cardTitle">Ausgabenverlauf</div>
          <div className={styles.periodLabel}>{labels.period}</div>
        </div>
        {hasTrend ? (
          <>
            <BarChart
              bars={bars}
              overThresholdCents={range === 'year' && data.budgetCents > 0 ? data.budgetCents : undefined}
            />
            {overBudget.map((bar) => (
              <div key={bar.label} className={styles.footnote}>
                {bar.label} lag mit {formatEuro(bar.amountCents)} über dem Budget von{' '}
                {formatEuroWhole(data.budgetCents)}.
              </div>
            ))}
          </>
        ) : (
          <EmptyState inline title="Noch keine Ausgaben in diesem Zeitraum">
            Hier wachsen die Balken mit jedem Bon – pro Tag, pro Kalenderwoche oder pro Monat, je
            nach gewähltem Zeitraum.
          </EmptyState>
        )}
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: slices.length > 0 ? 16 : 0 }}>
          Kategorien
        </div>
        {slices.length > 0 ? (
          <CategoryBars slices={slices} />
        ) : (
          <EmptyState inline title="Noch keine Kategorien">
            Sobald Positionen einem Produkt zugeordnet sind, stehen hier die neun Kategorien mit
            ihren Summen.
          </EmptyState>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">Sparpotenzial</div>
        {data.savings.length === 0 ? (
          <EmptyState inline title="Noch kein Vergleich möglich">
            Sobald du dasselbe Produkt in mehreren Läden gekauft hast, rechnet die App hier aus, wie
            viel du im Monat mehr bezahlt hast als beim günstigsten bekannten Preis.
          </EmptyState>
        ) : (
          <>
            <p className={styles.savingsIntro}>
              {data.savings.length}{' '}
              {data.savings.length === 1 ? 'Produkt gab es' : 'Produkte gab es'} laut deiner
              Historie woanders günstiger –{' '}
              <span className={styles.savingsTotal}>{formatEuro(excessCents)} Mehrkosten</span> im{' '}
              {formatMonth(data.month)}.
            </p>
            {data.savings.map((row) => (
              <div key={row.productId} className={styles.savingsRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.savingsName}>{row.productName}</div>
                  <div className={styles.savingsHint}>
                    {getMerchantName(row.cheapest.merchantId)} {formatEuro(row.cheapest.priceCents)}{' '}
                    statt {getMerchantName(row.worst.merchantId)}{' '}
                    {formatEuro(row.worst.priceCents)} · {row.overpaidCount} ×
                  </div>
                </div>
                <div className={styles.savingsDiff}>{formatEuroSigned(row.excessCents)}</div>
              </div>
            ))}
          </>
        )}
      </section>

      <FuelCard months={data.fuelMonths} />

      <ProductSearch month={data.month} />

      <section className={styles.listCard}>
        <div className={styles.listTitle}>Top 10 teuerste Produkte</div>
        {data.topProducts.length === 0 ? (
          <EmptyState inline title="Noch keine Produkte">
            Hier stehen später die zehn Produkte, für die du in diesem Monat am meisten ausgegeben
            hast.
          </EmptyState>
        ) : (
          data.topProducts.map((product, index) => (
            <div key={product.name} className={styles.topRow}>
              <span className={styles.rank}>{index + 1}</span>
              <span className={styles.topName}>{product.name}</span>
              <span className={styles.topCount}>{product.purchaseCount} ×</span>
              <span className={styles.topAmount}>{formatEuro(product.amountCents)}</span>
            </div>
          ))
        )}
      </section>
    </>
  )
}

/**
 * Spritkosten — die eigene Auswertung aus Abschnitt 4 des Konzepts.
 *
 * **Sie erscheint nur, wenn es Tankbelege gibt.** Kraftstoff bleibt in der
 * Kopfkarte Non-Food; eine fünfte Zahl dort wäre auf 390 px zu viel
 * (KONZEPT-ERWEITERUNGEN.md). Wer nie tankt, sieht hier nichts.
 *
 * **„Verbrauch" heißt Liter je Monat, nicht Liter je 100 km.** Auf einem
 * Tankbeleg steht kein Kilometerstand. Ihn abzufragen wäre eine Eingabe, die
 * niemand zuverlässig macht — und eine Verbrauchsangabe aus lückenhaften
 * Kilometerständen wäre schlimmer als keine. Gezeigt wird, was auf den Belegen
 * steht.
 *
 * **Der Literpreis eines Monats ist Kosten ÷ Liter, kein Mittel der einzelnen
 * Preise.** Sonst zählte eine Fünf-Liter-Notfüllung so viel wie eine volle
 * Tankfüllung.
 */
function FuelCard({ months }: { months: FuelMonth[] }) {
  if (months.length === 0) return null

  // Die Sicht liefert aufsteigend; der jüngste Monat steht damit am Ende.
  const latest = months[months.length - 1]
  const totalCents = months.reduce((sum, month) => sum + month.amountCents, 0)
  const totalMillilitres = months.reduce((sum, month) => sum + month.millilitres, 0)
  const fills = months.reduce((sum, month) => sum + month.fillCount, 0)

  return (
    <section className="card">
      <div className={styles.cardHead}>
        <div className="cardTitle">Kraftstoff</div>
        <div className={styles.periodLabel}>{formatMonth(latest.month)}</div>
      </div>

      <div className={styles.fuelHead}>
        <div className={styles.fuelFigure}>
          <div className={styles.fuelValue}>{formatPricePerLitre(latest.pricePerLitreCents)}</div>
          <div className={styles.fuelCaption}>zuletzt im Schnitt</div>
        </div>
        <div className={styles.fuelFigure}>
          <div className={styles.fuelValue}>{formatEuro(latest.amountCents)}</div>
          <div className={styles.fuelCaption}>{formatLitres(latest.millilitres)} getankt</div>
        </div>
      </div>

      {/*
        Zwei Messpunkte sind das Minimum für eine Linie. Bei einem einzigen wäre
        sie ein Punkt in der Mitte und behauptete einen Verlauf, den es nicht
        gibt.
      */}
      {months.length >= 2 && (
        <>
          <Sparkline
            values={months.map((month) => month.pricePerLitreCents)}
            height={92}
            midline
            label="Literpreis im Zeitverlauf"
          />
          <SparkAxis>
            {months.map((month) => (
              <span key={month.month}>{formatMonthShort(month.month)}</span>
            ))}
          </SparkAxis>
        </>
      )}

      <div className={styles.fuelRows}>
        {[...months].reverse().map((month) => (
          <div key={month.month} className={styles.fuelRow}>
            <span className={styles.fuelMonth}>{formatMonth(month.month)}</span>
            <span className={styles.fuelDetail}>
              {formatLitres(month.millilitres)} · {formatPricePerLitre(month.pricePerLitreCents)}
            </span>
            <span className={styles.fuelAmount}>{formatEuro(month.amountCents)}</span>
          </div>
        ))}
      </div>

      <p className={styles.footnote}>
        {fills} {fills === 1 ? 'Tankfüllung' : 'Tankfüllungen'} ·{' '}
        {formatLitres(totalMillilitres)} · {formatEuro(totalCents)} in{' '}
        {months.length === 1 ? 'einem Monat' : `${months.length} Monaten`}. Welche Tankstelle
        günstiger war, steht unter Bestpreise.
      </p>
    </section>
  )
}

/**
 * Produktsuche im laufenden Monat.
 *
 * Eigene Komponente mit eigenem Ladezustand: Die Suche läuft bei jedem
 * Tastendruck neu, und das darf nicht den ganzen Screen in den Ladezustand
 * werfen.
 */
function ProductSearch({ month }: { month: string }) {
  const [query, setQuery] = useState('')
  const state = useQuery(() => searchItemSpending(query, month), [query, month])

  const result = state.data ?? { purchaseCount: 0, amountCents: 0 }

  return (
    <section className="card">
      <div className="cardTitle" style={{ marginBottom: 12 }}>
        Produktsuche im Zeitraum
      </div>
      <SearchField value={query} onChange={setQuery} placeholder="z. B. Käse" />
      {state.error ? (
        <p className={styles.footnote}>{state.error}</p>
      ) : (
        <div className={styles.searchResult}>
          <div className={styles.searchCount}>
            {query.trim() === ''
              ? `Suchbegriff eingeben · ${formatMonth(month)}`
              : `${result.purchaseCount} ${result.purchaseCount === 1 ? 'Kauf' : 'Käufe'} · ${formatMonth(month)}`}
          </div>
          <div className={styles.searchAmount}>{formatEuro(result.amountCents)}</div>
        </div>
      )}
    </section>
  )
}
