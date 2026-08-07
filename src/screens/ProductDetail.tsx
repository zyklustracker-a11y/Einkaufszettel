import { Navigate, useParams } from 'react-router-dom'
import { Sparkline, SparkAxis } from '../components/charts'
import { BackLink } from '../components/ui'
import { getMerchantName, getProduct } from '../data'
import { comparePrices, firstPurchaseDate, purchaseHistory } from '../lib/derive'
import {
  formatBasePrice,
  formatDate,
  formatEuro,
  formatMonthName,
  formatMonthNumeric,
  parseISO,
} from '../lib/format'
import type { Product } from '../types'
import styles from './ProductDetail.module.css'

/** `März – August 2026`, collapsing the year when both ends share one. */
function historyRange(product: Product): string {
  const dates = product.purchases.map((p) => p.date).sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  const firstYear = parseISO(first).getFullYear()
  const lastYear = parseISO(last).getFullYear()
  if (firstYear === lastYear) {
    return `${formatMonthName(first)} – ${formatMonthName(last)} ${lastYear}`
  }
  return `${formatMonthName(first)} ${firstYear} – ${formatMonthName(last)} ${lastYear}`
}

export function ProductDetail() {
  const { productId } = useParams()
  const product = productId ? getProduct(productId) : undefined
  if (!product) return <Navigate to="/bestpreise" replace />

  const { basePriceCents, baseUnit, averageCents, minCents, maxCents } = comparePrices(product)
  const history = purchaseHistory(product)
  // Oldest first, so the line reads left to right in time.
  const series = [...product.purchases].sort((a, b) => a.date.localeCompare(b.date)).map((p) => p.priceCents)

  return (
    <div className="screen screen--tabbed">
      <BackLink to="/bestpreise">Bestpreise</BackLink>
      <h1 className="pageTitle">{product.name}</h1>
      <p className={styles.subtitle}>
        {formatBasePrice(basePriceCents, baseUnit)} · {product.purchases.length} Käufe seit{' '}
        {formatMonthNumeric(firstPurchaseDate(product))}
      </p>

      <section className="card">
        <div className={styles.cardHead}>
          <div className="cardTitle">Preisverlauf</div>
          <div className={styles.range}>{historyRange(product)}</div>
        </div>
        <Sparkline values={series} height={110} midline label={`Preisverlauf ${product.name}`} />
        <SparkAxis>
          <span>{formatEuro(minCents)}</span>
          <span>Ø {formatEuro(averageCents)}</span>
          <span>{formatEuro(maxCents)}</span>
        </SparkAxis>
      </section>

      <section className={styles.historyCard}>
        <div className={styles.historyTitle}>Alle Käufe</div>
        {history.map((purchase) => (
          <div key={`${purchase.merchantId}-${purchase.date}`} className={styles.row}>
            <span className={styles.merchant}>{getMerchantName(purchase.merchantId)}</span>
            <span className={styles.date}>{formatDate(purchase.date)}</span>
            <span className={purchase.isBest ? `${styles.price} ${styles['price--best']}` : styles.price}>
              {formatEuro(purchase.priceCents)}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}
