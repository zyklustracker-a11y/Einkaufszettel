import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SearchField } from '../components/ui'
import { getProducts, getToday } from '../data'
import { comparePrices, searchProducts } from '../lib/derive'
import { formatAge, formatBasePrice, formatDate, formatEuro } from '../lib/format'
import styles from './Prices.module.css'

export function Prices() {
  const [query, setQuery] = useState('')
  const today = getToday()
  const matches = useMemo(() => searchProducts(getProducts(), query), [query])

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Bestpreise</h1>

      <div style={{ marginBottom: 16 }}>
        <SearchField value={query} onChange={setQuery} placeholder="Produkt suchen" />
      </div>

      {matches.length === 0 && <p className={styles.empty}>Keine Produkte gefunden.</p>}

      {matches.map((product) => {
        const { best, others, basePrice, baseUnit } = comparePrices(product)
        return (
          <Link key={product.id} to={`/bestpreise/${product.id}`} className={styles.card}>
            <span className={styles.cardHead}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className={styles.name}>{product.name}</span>
                <span className={styles.basePrice}>{formatBasePrice(basePrice, baseUnit)}</span>
              </span>
              <span className={styles.age}>{formatAge(best.date, today)}</span>
            </span>

            <span className={styles.best}>
              <span className={styles.bestLabel}>Bestpreis</span>
              <span className={styles.bestMerchant}>{best.merchant}</span>
              <span className={styles.bestPrice}>{formatEuro(best.price)}</span>
            </span>

            <span className={styles.others}>
              {others.map((other) => (
                <span key={other.merchant} className={styles.other}>
                  <span className={styles.otherMerchant}>{other.merchant}</span>
                  <span className={styles.otherDate}>{formatDate(other.date)}</span>
                  <span className={styles.otherPrice}>{formatEuro(other.price)}</span>
                </span>
              ))}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
