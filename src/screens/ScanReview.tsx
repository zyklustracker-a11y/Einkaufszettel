import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList, TraitLegend } from '../components/ReceiptItemList'
import { getCategories, getMerchantName, getScannedReceipt } from '../data'
import { receiptItemsTotal } from '../lib/derive'
import { formatDate, formatEuro, roundCents } from '../lib/format'
import type { CategoryId, Quantity, ReceiptItem } from '../types'
import styles from './ScanReview.module.css'

/**
 * Recomputes the line total after an edit, keeping quantity × price honest.
 * A weight times a €/kg price lands between cents, so the result is rounded.
 */
function applyPricing(
  quantity: Quantity,
  amount: number,
  priceCents: number,
): { quantity: Quantity; totalCents: number } {
  switch (quantity.kind) {
    case 'count': {
      const count = Math.max(1, Math.round(amount))
      return {
        quantity: { kind: 'count', count, unitPriceCents: priceCents },
        totalCents: roundCents(count * priceCents),
      }
    }
    case 'weight':
      return {
        quantity: { ...quantity, amount, pricePerUnitCents: priceCents },
        totalCents: roundCents(amount * priceCents),
      }
    case 'unknown':
      return { quantity, totalCents: priceCents }
  }
}

/** Starting values for the edit sheet's two numeric fields. */
function pricingFields(item: ReceiptItem): { amount: number; priceCents: number } {
  switch (item.quantity.kind) {
    case 'count':
      return { amount: item.quantity.count, priceCents: item.quantity.unitPriceCents }
    case 'weight':
      return { amount: item.quantity.amount, priceCents: item.quantity.pricePerUnitCents }
    case 'unknown':
      return { amount: 0, priceCents: item.totalCents }
  }
}

export function ScanReview() {
  const navigate = useNavigate()
  const receipt = getScannedReceipt()
  // Corrections live here until "Speichern"; a real build would post them.
  const [items, setItems] = useState<ReceiptItem[]>(receipt.items)
  const [editing, setEditing] = useState<ReceiptItem | null>(null)

  const itemsTotalCents = receiptItemsTotal({ ...receipt, items })
  const differenceCents = receipt.printedTotalCents - itemsTotalCents
  const reconciles = differenceCents === 0

  const save = (updated: ReceiptItem) => {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    setEditing(null)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.scroll}>
        <div className={styles.head}>
          <Link to="/scan" replace className={styles.rescan}>
            Erneut scannen
          </Link>
          <div className={styles.headTitle}>Prüfen &amp; korrigieren</div>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryTop}>
            <div style={{ flex: 1 }}>
              <div className={styles.merchant}>{getMerchantName(receipt.merchantId)}</div>
              <div className={styles.date}>
                {formatDate(receipt.date)} · {items.length} Positionen
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={styles.totalLabel}>Bon-Summe</div>
              <div className={styles.total}>{formatEuro(receipt.printedTotalCents)}</div>
            </div>
          </div>

          <div className={reconciles ? `${styles.banner} ${styles['banner--ok']}` : styles.banner}>
            <div className={styles.bannerIcon} aria-hidden="true">
              {reconciles ? '✓' : '!'}
            </div>
            <div className={styles.bannerText}>
              {reconciles
                ? `Positionssumme ${formatEuro(itemsTotalCents)} stimmt mit dem Bon-Total überein.`
                : `Positionssumme ${formatEuro(itemsTotalCents)} weicht um ${formatEuro(Math.abs(differenceCents))} ab – bitte prüfen.`}
            </div>
          </div>
        </div>

        <div className={styles.hint}>Zeile antippen zum Bearbeiten</div>
        <ReceiptItemList items={items} onEdit={setEditing} />
        <TraitLegend items={items} />
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.save} onClick={() => navigate('/', { replace: true })}>
          Speichern · {formatEuro(receipt.printedTotalCents)}
        </button>
      </div>

      {editing && <EditSheet item={editing} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  )
}

function EditSheet({
  item,
  onCancel,
  onSave,
}: {
  item: ReceiptItem
  onCancel: () => void
  onSave: (item: ReceiptItem) => void
}) {
  const initial = pricingFields(item)
  const [name, setName] = useState(item.name)
  // Fields show and accept German decimals in euros; `parseInput` takes them
  // back to numbers and `parsePrice` back to cents.
  const [amount, setAmount] = useState(String(initial.amount).replace('.', ','))
  const [price, setPrice] = useState((initial.priceCents / 100).toFixed(2).replace('.', ','))
  const [categoryId, setCategoryId] = useState<CategoryId>(item.categoryId)

  const isWeight = item.quantity.kind === 'weight'
  const hasAmount = item.quantity.kind !== 'unknown'
  const amountLabel = isWeight && item.quantity.kind === 'weight' ? `Menge (${item.quantity.unit})` : 'Menge'
  const priceLabel = hasAmount ? 'Einzelpreis' : 'Preis'

  const parseInput = (value: string) => Number(value.replace(',', '.')) || 0
  /** The field is euros, the domain is cents. */
  const parsePrice = (value: string) => roundCents(parseInput(value) * 100)

  const apply = () => {
    const { quantity, totalCents } = applyPricing(item.quantity, parseInput(amount), parsePrice(price))
    onSave({ ...item, name: name.trim() || item.name, categoryId, quantity, totalCents })
  }

  return (
    <BottomSheet title="Position bearbeiten" onClose={onCancel}>
      <div className={styles.form}>
        <div>
          <div className={styles.fieldLabel}>Name</div>
          <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>{amountLabel}</div>
            <input
              className={`${styles.input} ${styles['input--number']}`}
              type="text"
              inputMode="decimal"
              value={hasAmount ? amount : ''}
              placeholder="ohne Mengenangabe"
              disabled={!hasAmount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>{priceLabel}</div>
            <input
              className={`${styles.input} ${styles['input--number']}`}
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
        </div>

        <div>
          <div className={styles.fieldLabel} style={{ marginBottom: 8 }}>
            Kategorie
          </div>
          <div className={styles.categoryGrid}>
            {getCategories().map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={category.id === categoryId}
                className={
                  category.id === categoryId
                    ? `${styles.categoryOption} ${styles['categoryOption--selected']}`
                    : styles.categoryOption
                }
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button type="button" className={styles.apply} onClick={apply}>
        Übernehmen
      </button>
    </BottomSheet>
  )
}
