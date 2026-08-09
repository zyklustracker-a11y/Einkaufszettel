import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SectionSwitch } from '../components/SectionSwitch'
import { Async, EmptyState } from '../components/states'
import { SearchField } from '../components/ui'
import { getMerchantName, getPriceOverview, useQuery } from '../data'
import { formatAge, formatBasePrice, formatUnitPrice, todayISO } from '../lib/format'
import type { ProductPriceOverview } from '../types'
import styles from './Prices.module.css'

/**
 * Wie der Preis heißen darf, den die Karte zeigt.
 *
 * „Bestpreis" ist eine Aussage über einen **Vergleich**. Bei einem einzigen Kauf
 * gibt es keinen, und bei einem einzigen Laden auch nicht — dann wäre das Wort
 * eine Behauptung, die die Daten nicht hergeben. Die Zahl darunter stimmt in
 * allen drei Fällen; nur ihre Bezeichnung ändert sich.
 */
function priceLabel(product: ProductPriceOverview): string {
  if (product.purchaseCount === 1) return 'Einmal bezahlt'
  if (product.merchantCount < 2) return 'Günstigster Preis'
  return 'Bestpreis'
}

/**
 * Die Bestpreise sind seit Schritt 15 der zweite Bereich der Analysen.
 *
 * Die Überschrift heißt deshalb „Analysen" und nicht mehr „Bestpreise": Der
 * Umschalter direkt darunter sagt bereits, welcher der beiden Bereiche zu sehen
 * ist. Zweimal dasselbe Wort untereinander wäre eine verschenkte Zeile — und
 * eine Überschrift, die sich beim Umschalten ändert, ließe den Eindruck
 * entstehen, man hätte den Bereich verlassen. Route und Screen sind unverändert.
 *
 * Das Suchfeld steht bewusst unmittelbar unter dem Umschalter: Die Produktsuche
 * ist der Grund, warum es die Bestpreise gibt. Sie darf durch den Umweg über die
 * Analysen keine Zeile tiefer rutschen als nötig.
 */
export function Prices() {
  const state = useQuery(getPriceOverview, [])

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Analysen</h1>
      <SectionSwitch />
      <Async state={state}>{(products) => <PricesBody products={products} />}</Async>
    </div>
  )
}

/**
 * Wie viele Einmalkäufe die Liste zeigt, bevor sie den Rest hinter einen Knopf
 * legt. Sie tragen keinen Vergleich bei — sie sagen nur, dass es noch keinen
 * gibt, und das steht in jeder Karte dreizeilig.
 */
const VISIBLE_SINGLES = 5

function PricesBody({ products }: { products: ProductPriceOverview[] }) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const today = todayISO()

  /*
   * Sortiert nach Vergleichbarkeit, nicht nach Alphabet.
   *
   * Bis Schritt 19 stand hier `.order('product_name')`, und die Liste öffnete
   * mit „Artikel 1, Artikel 10, Artikel 11 …" — bei 61 Produkten waren 57 davon
   * Einmalkäufe, und die vier mit einem echten Preisvergleich lagen weit unten.
   * Der Screen führte damit mit dem, was am wenigsten nützt.
   *
   * Zuerst die Produkte mit mehreren Läden (dort gibt es einen Bestpreis), dann
   * die mit mehreren Käufen (dort gibt es einen Verlauf), dann der Rest.
   */
  const sorted = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          b.merchantCount - a.merchantCount ||
          b.purchaseCount - a.purchaseCount ||
          a.name.localeCompare(b.name, 'de'),
      ),
    [products],
  )

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((product) => product.name.toLowerCase().includes(needle))
  }, [sorted, query])

  /*
   * Gesucht wird in allem; ohne Suchbegriff werden die Einmalkäufe eingeklappt.
   * Wer ein bestimmtes Produkt sucht, findet es trotzdem sofort — die Suche ist
   * der Grund, warum es die Bestpreise gibt.
   */
  const comparable = matches.filter((product) => product.purchaseCount > 1)
  const singles = matches.filter((product) => product.purchaseCount === 1)
  const searching = query.trim() !== ''
  const shownSingles = searching || showAll ? singles : singles.slice(0, VISIBLE_SINGLES)
  const hiddenSingles = singles.length - shownSingles.length
  const visible = [...comparable, ...shownSingles]

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

      {visible.map((product) => (
        <Link key={product.id} to={`/bestpreise/${product.id}`} className={styles.card}>
          <span className={styles.cardHead}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.name}>{product.name}</span>
              {/*
                Bei Ware nach Gewicht **ist** der Bestpreis der Grundpreis — er
                steht unten mit „/kg" daneben. Ihn hier ein zweites Mal
                hinzuschreiben war dieselbe Zahl zweimal, einmal ohne Einheit.
                Übrig bleibt die Zeile für Stückware, wo sie etwas sagt.
              */}
              {product.baseUnit === null && (
                <span className={styles.basePrice}>
                  {formatBasePrice(product.basePriceCents, product.baseUnit)}
                </span>
              )}
            </span>
            <span className={styles.age}>{formatAge(product.best.date, today)}</span>
          </span>

          <span className={styles.best}>
            <span className={styles.bestLabel}>{priceLabel(product)}</span>
            <span className={styles.bestMerchant}>{getMerchantName(product.best.merchantId)}</span>
            <span className={styles.bestPrice}>
              {formatUnitPrice(product.best.priceCents, product.baseUnit)}
            </span>
          </span>

          {/*
            Bei einem einzigen Laden gibt es nichts zu vergleichen — dann steht
            hier, was noch fehlt, statt einer leeren Fläche. Ein Preisvergleich
            entsteht erst mit dem zweiten Laden, und das ist ein Satz wert.
          */}
          {product.merchantCount < 2 && (
            <span className={styles.hint}>
              {product.purchaseCount === 1
                ? 'Erst einmal gekauft. Ab dem zweiten Kauf zeigt die App den Verlauf, ab dem zweiten Laden den Vergleich.'
                : 'Bisher nur bei einem Laden gekauft – für einen Vergleich fehlt der zweite.'}
            </span>
          )}

        </Link>
      ))}

      {hiddenSingles > 0 && (
        <button type="button" className={styles.showAll} onClick={() => setShowAll(true)}>
          {hiddenSingles} weitere ohne Vergleich anzeigen
        </button>
      )}
    </>
  )
}
