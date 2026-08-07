import { useMemo, useState } from 'react'
import { BarChart, CategoryBars } from '../components/charts'
import { SearchField } from '../components/ui'
import {
  getCategories,
  getCategoryTotals,
  getMerchantName,
  getMonthRange,
  getMonthSummary,
  getProducts,
  getRangeLabels,
  getReceipts,
  getTopProducts,
  getTrend,
} from '../data'
import {
  categorySlices,
  rankedTopProducts,
  savingsRows,
  searchReceiptItems,
  totalExcess,
} from '../lib/derive'
import { formatEuro, formatEuroSigned, formatEuroWhole, formatMonth } from '../lib/format'
import type { RangeId } from '../types'
import { useAppState } from '../state/AppState'
import styles from './Analytics.module.css'

const RANGE_IDS: RangeId[] = ['week', 'month', 'year', 'custom']

export function Analytics() {
  const { settings } = useAppState()
  const [range, setRange] = useState<RangeId>('year')
  const [query, setQuery] = useState('Käse')

  const labels = getRangeLabels()
  const bars = getTrend(range)
  const budgetCents = settings.monthlyBudgetCents
  const slices = categorySlices(getCategoryTotals(), getCategories())
  const monthRange = getMonthRange()

  const savings = useMemo(() => savingsRows(getProducts(), monthRange.start, monthRange.end), [monthRange.start, monthRange.end])
  const excessCents = totalExcess(savings)
  const search = useMemo(() => searchReceiptItems(getReceipts(), query), [query])

  // Only monthly buckets can breach a monthly budget, so the note is year-only.
  const overBudget = range === 'year' ? bars.filter((bar) => bar.amountCents > budgetCents) : []

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Analysen</h1>

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
            {labels[id].tab}
          </button>
        ))}
      </div>

      <section className="card">
        <div className={styles.cardHead}>
          <div className="cardTitle">Ausgabenverlauf</div>
          <div className={styles.periodLabel}>{labels[range].period}</div>
        </div>
        <BarChart
          bars={bars.map((b) => ({ label: b.label, amountCents: b.amountCents }))}
          overThresholdCents={range === 'year' ? budgetCents : undefined}
        />
        {overBudget.map((bar) => (
          <div key={bar.label} className={styles.footnote}>
            {bar.label} lag mit {formatEuro(bar.amountCents)} über dem Budget von {formatEuroWhole(budgetCents)}.
          </div>
        ))}
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: 16 }}>
          Kategorien
        </div>
        <CategoryBars slices={slices} />
      </section>

      <section className="card">
        <div className="cardTitle">Sparpotenzial</div>
        <p className={styles.savingsIntro}>
          {savings.length} Produkte gab es laut deiner Historie woanders günstiger –{' '}
          <span className={styles.savingsTotal}>{formatEuro(excessCents)} Mehrkosten</span> im{' '}
          {formatMonth(getMonthSummary().month)}.
        </p>
        {savings.map((row) => (
          <div key={row.productId} className={styles.savingsRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={styles.savingsName}>{row.productName}</div>
              <div className={styles.savingsHint}>
                {getMerchantName(row.cheapest.merchantId)} {formatEuro(row.cheapest.priceCents)} statt{' '}
                {getMerchantName(row.worst.merchantId)} {formatEuro(row.worst.priceCents)} ·{' '}
                {row.overpaidCount} ×
              </div>
            </div>
            <div className={styles.savingsDiff}>{formatEuroSigned(row.excessCents)}</div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="cardTitle" style={{ marginBottom: 12 }}>
          Produktsuche im Zeitraum
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="z. B. Käse" />
        <div className={styles.searchResult}>
          <div className={styles.searchCount}>
            {search.purchaseCount} {search.purchaseCount === 1 ? 'Kauf' : 'Käufe'} · {labels.month.period}
          </div>
          <div className={styles.searchAmount}>{formatEuro(search.amountCents)}</div>
        </div>
      </section>

      <section className={styles.listCard}>
        <div className={styles.listTitle}>Top 10 teuerste Produkte</div>
        {rankedTopProducts(getTopProducts()).map((product, index) => (
          <div key={product.name} className={styles.topRow}>
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.topName}>{product.name}</span>
            <span className={styles.topCount}>{product.purchaseCount} ×</span>
            <span className={styles.topAmount}>{formatEuro(product.amountCents)}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
