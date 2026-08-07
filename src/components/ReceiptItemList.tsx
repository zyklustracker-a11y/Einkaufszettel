import { getCategory, getHealthFlagLegend } from '../data'
import { formatEuro, formatQuantity } from '../lib/format'
import type { ReceiptItem } from '../types'
import { CategoryChip, FlagBadge } from './ui'
import styles from './ReceiptItemList.module.css'

function Row({ item }: { item: ReceiptItem }) {
  return (
    <>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.meta}>
          <CategoryChip>{getCategory(item.categoryId)?.name ?? item.categoryId}</CategoryChip>
          {item.flags.map((flag) => (
            <FlagBadge key={flag} flag={flag} />
          ))}
        </span>
      </span>
      <span style={{ textAlign: 'right' }}>
        <span className={styles.total}>{formatEuro(item.totalCents)}</span>
        <span className={styles.quantity}>{formatQuantity(item.quantity)}</span>
      </span>
    </>
  )
}

/**
 * The line items of a receipt. Pass `onEdit` on the correction screen to make
 * each row tappable; the read-only purchase detail leaves it out.
 */
export function ReceiptItemList({
  items,
  onEdit,
}: {
  items: ReceiptItem[]
  onEdit?: (item: ReceiptItem) => void
}) {
  return (
    <div className={styles.list}>
      {items.map((item) =>
        onEdit ? (
          <button
            key={item.id}
            type="button"
            className={`${styles.row} ${styles['row--tappable']}`}
            onClick={() => onEdit(item)}
          >
            <Row item={item} />
          </button>
        ) : (
          <div key={item.id} className={styles.row}>
            <Row item={item} />
          </div>
        ),
      )}
    </div>
  )
}

/** Key for the single-letter health badges. */
export function FlagLegend() {
  return (
    <div className={styles.legend}>
      {getHealthFlagLegend().map((flag) => (
        <span key={flag.id}>
          {flag.letter} {flag.label}
        </span>
      ))}
    </div>
  )
}
