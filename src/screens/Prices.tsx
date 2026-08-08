import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Async, EmptyState } from '../components/states'
import { SearchField } from '../components/ui'
import { getMerchantName, getPriceOverview, useQuery } from '../data'
import { formatAge, formatBasePrice, formatDate, formatEuro, todayISO } from '../lib/format'
import type { ProductPriceOverview } from '../types'
import styles from './Prices.module.css'

export function Prices() {
  const state = useQuery(getPriceOverview, [])

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Bestpreise</h1>
      <Async state={state}>{(products) => <PricesBody products={products} />}</Async>
    </div>
  )
}

function PricesBody({ products }: { products: ProductPriceOverview[] }) {
  const [query, setQuery] = useState('')
  const today = todayISO()

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return products
    return products.filter((product) => product.name.toLowerCase().includes(needle))
  }, [products, query])

  // Ohne ein einziges Produkt hilft auch kein Suchfeld — dann steht hier nur
  // die Erklärung.
  if (products.length === 0) {
    return (
      <EmptyState title="Noch keine Preise erfasst" scanHint>
        Nach dem zweiten Einkauf desselben Produkts vergleicht die App die Preise: Du siehst je
        Produkt den günstigsten je bezahlten Preis, wo es ihn gab und wie alt er ist.
      </EmptyState>
    )
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <SearchField value={query} onChange={setQuery} placeholder="Produkt suchen" />
      </div>

      {matches.length === 0 && <p className={styles.empty}>Keine Produkte gefunden.</p>}

      {matches.map((product) => (
        <Link key={product.id} to={`/bestpreise/${product.id}`} className={styles.card}>
          <span className={styles.cardHead}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.name}>{product.name}</span>
              <span className={styles.basePrice}>
                {formatBasePrice(product.basePriceCents, product.baseUnit)}
              </span>
            </span>
            <span className={styles.age}>{formatAge(product.best.date, today)}</span>
          </span>

          <span className={styles.best}>
            <span className={styles.bestLabel}>Bestpreis</span>
            <span className={styles.bestMerchant}>{getMerchantName(product.best.merchantId)}</span>
            <span className={styles.bestPrice}>{formatEuro(product.best.priceCents)}</span>
          </span>

          {product.others.length > 0 && (
            <span className={styles.others}>
              {product.others.map((other) => (
                <span key={other.merchantId} className={styles.other}>
                  <span className={styles.otherMerchant}>{getMerchantName(other.merchantId)}</span>
                  <span className={styles.otherDate}>{formatDate(other.date)}</span>
                  <span className={styles.otherPrice}>{formatEuro(other.priceCents)}</span>
                </span>
              ))}
            </span>
          )}
        </Link>
      ))}
    </>
  )
}
