import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { FlagLegend, ReceiptItemList } from '../components/ReceiptItemList'
import { getCategories, getScannedReceipt } from '../data'
import { receiptItemsTotal } from '../lib/derive'
import { formatDate, formatEuro, toCents } from '../lib/format'
import type { CategoryId, Quantity, ReceiptItem } from '../types'
import styles from './ScanReview.module.css'

/** Recomputes the line total after an edit, keeping quantity × price honest. */
function applyPricing(quantity: Quantity, amount: number, price: number): { quantity: Quantity; total: number } {
  switch (quantity.kind) {
    case 'count': {
      const count = Math.max(1, Math.round(amount))
      return { quantity: { kind: 'count', count, unitPrice: price }, total: toCents(count * price) }
    }
    case 'weight':
      return {
        quantity: { ...quantity, amount, pricePerUnit: price },
        total: toCents(amount * price),
      }
    case 'unknown':
      return { quantity, total: toCents(price) }
  }
}

/** Starting values for the edit sheet's two numeric fields. */
function pricingFields(item: ReceiptItem): { amount: number; price: number } {
  switch (item.quantity.kind) {
    case 'count':
      return { amount: item.quantity.count, price: item.quantity.unitPrice }
    case 'weight':
      return { amount: item.quantity.amount, price: item.quantity.pricePerUnit }
    case 'unknown':
      return { amount: 0, price: item.total }
  }
}

export function ScanReview() {
  const navigate = useNavigate()
  const receipt = getScannedReceipt()
  // Corrections live here until "Speichern"; a real build would post them.
  const [items, setItems] = useState<ReceiptItem[]>(receipt.items)
  const [editing, setEditing] = useState<ReceiptItem | null>(null)

  const itemsTotal = receiptItemsTotal({ ...receipt, items })
  const difference = toCents(receipt.printedTotal - itemsTotal)
  const reconciles = difference === 0

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
              <div className={styles.merchant}>{receipt.merchant}</div>
              <div className={styles.date}>
                {formatDate(receipt.date)} · {items.length} Positionen
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={styles.totalLabel}>Bon-Summe</div>
              <div className={styles.total}>{formatEuro(receipt.printedTotal)}</div>
            </div>
          </div>

          <div className={reconciles ? `${styles.banner} ${styles['banner--ok']}` : styles.banner}>
            <div className={styles.bannerIcon} aria-hidden="true">
              {reconciles ? '✓' : '!'}
            </div>
            <div className={styles.bannerText}>
              {reconciles
                ? `Positionssumme ${formatEuro(itemsTotal)} stimmt mit dem Bon-Total überein.`
                : `Positionssumme ${formatEuro(itemsTotal)} weicht um ${formatEuro(Math.abs(difference))} ab – bitte prüfen.`}
            </div>
          </div>
        </div>

        <div className={styles.hint}>Zeile antippen zum Bearbeiten</div>
        <ReceiptItemList items={items} onEdit={setEditing} />
        <FlagLegend />
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.save} onClick={() => navigate('/', { replace: true })}>
          Speichern · {formatEuro(receipt.printedTotal)}
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
  // Fields show and accept German decimals; `parseInput` takes them back to numbers.
  const [amount, setAmount] = useState(String(initial.amount).replace('.', ','))
  const [price, setPrice] = useState(initial.price.toFixed(2).replace('.', ','))
  const [categoryId, setCategoryId] = useState<CategoryId>(item.categoryId)

  const isWeight = item.quantity.kind === 'weight'
  const hasAmount = item.quantity.kind !== 'unknown'
  const amountLabel = isWeight && item.quantity.kind === 'weight' ? `Menge (${item.quantity.unit})` : 'Menge'
  const priceLabel = hasAmount ? 'Einzelpreis' : 'Preis'

  const parseInput = (value: string) => Number(value.replace(',', '.')) || 0

  const apply = () => {
    const { quantity, total } = applyPricing(item.quantity, parseInput(amount), parseInput(price))
    onSave({ ...item, name: name.trim() || item.name, categoryId, quantity, total })
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
