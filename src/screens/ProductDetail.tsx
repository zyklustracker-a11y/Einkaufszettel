import { useParams } from 'react-router-dom'
import { Sparkline, SparkAxis } from '../components/charts'
import { Async, EmptyState } from '../components/states'
import { BackLink } from '../components/ui'
import { getMerchantName, getProductPriceDetail, useQuery } from '../data'
import {
  formatBasePrice,
  formatDate,
  formatEuro,
  formatMonthName,
  formatMonthNumeric,
  parseISO,
} from '../lib/format'
import type { ProductPriceDetail } from '../types'
import styles from './ProductDetail.module.css'

/** `März – August 2026`, collapsing the year when both ends share one. */
function historyRange(product: ProductPriceDetail): string {
  const dates = product.purchases.map((p) => p.date)
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
  const state = useQuery(() => getProductPriceDetail(productId ?? ''), [productId])

  return (
    <div className="screen screen--tabbed">
      <BackLink to="/bestpreise">Bestpreise</BackLink>
      <Async state={state}>
        {(product) =>
          product === null ? (
            <EmptyState
              title="Produkt nicht gefunden"
              link={{ to: '/bestpreise', label: 'Zurück zu den Bestpreisen' }}
            >
              Zu diesem Produkt gibt es keine Preise mehr. Vielleicht wurde der Einkauf gelöscht,
              aus dem es stammte.
            </EmptyState>
          ) : (
            <ProductBody product={product} />
          )
        }
      </Async>
    </div>
  )
}

function ProductBody({ product }: { product: ProductPriceDetail }) {
  // Älteste zuerst — so liest sich die Linie von links nach rechts in der Zeit.
  const series = product.purchases.map((p) => p.priceCents)
  // Neueste zuerst für die Liste, günstigste hervorgehoben.
  const history = [...product.purchases]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ ...p, isBest: p.priceCents === product.minCents }))

  return (
    <>
      <h1 className="pageTitle">{product.name}</h1>
      <p className={styles.subtitle}>
        {formatBasePrice(product.basePriceCents, product.baseUnit)} · {product.purchaseCount}{' '}
        {product.purchaseCount === 1 ? 'Kauf' : 'Käufe'} seit{' '}
        {formatMonthNumeric(product.firstPurchasedOn)}
      </p>

      <section className="card">
        <div className={styles.cardHead}>
          <div className="cardTitle">Preisverlauf</div>
          <div className={styles.range}>{historyRange(product)}</div>
        </div>
        {/*
          Ein einziger Kauf ergibt keinen Verlauf. Die Kennzahlen darunter
          stimmen trotzdem — sie beziehen sich dann eben auf diesen einen Preis.
        */}
        {series.length > 1 ? (
          <>
            <Sparkline values={series} height={110} midline label={`Preisverlauf ${product.name}`} />
            <SparkAxis>
              <span>{formatEuro(product.minCents)}</span>
              <span>Ø {formatEuro(product.averageCents)}</span>
              <span>{formatEuro(product.maxCents)}</span>
            </SparkAxis>
          </>
        ) : (
          <EmptyState inline title="Erst ein Kauf erfasst">
            Ab dem zweiten Kauf zeichnet die App hier den Preisverlauf – und zeigt, ob es gerade
            teurer oder günstiger ist als sonst.
          </EmptyState>
        )}
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
    </>
  )
}
