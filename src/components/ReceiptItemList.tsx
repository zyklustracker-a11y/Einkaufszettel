import { getActiveTraits, getCategory } from '../data'
import { formatEuro, formatQuantity } from '../lib/format'
import { itemTraits } from '../lib/score'
import type { ReceiptItem, Trait } from '../types'
import { CategoryChip, TraitBadge, TraitOverflow } from './ui'
import styles from './ReceiptItemList.module.css'

/**
 * At most this many badges per row; the rest collapse into `+N`. Without the
 * cap a heavily tagged item (the ready lasagne carries six) tears the row.
 */
const MAX_BADGES = 3

function Row({
  item,
  traits,
  learned,
}: {
  item: ReceiptItem
  traits: Trait[]
  learned: boolean
}) {
  const applied = itemTraits(item, traits)
  const shown = applied.slice(0, MAX_BADGES)
  const hidden = applied.slice(MAX_BADGES)

  return (
    <>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.meta}>
          <CategoryChip>{getCategory(item.categoryId)?.name ?? item.categoryId}</CategoryChip>
          {shown.map((trait) => (
            <TraitBadge key={trait.id} trait={trait} />
          ))}
          {hidden.length > 0 && <TraitOverflow hidden={hidden} />}
          {/*
            Dezent und ohne Farbe: Die Zeile ist nichts Besonderes, sie war nur
            schon bekannt. Sichtbar soll trotzdem sein, was die App bereits
            gelernt hat — das ist der halbe Sinn des Lernkreises.
          */}
          {learned && (
            <span className={styles.learned} title="Zuordnung kam aus der Datenbank">
              gelernt
            </span>
          )}
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
 *
 * `learnedIds` marks the rows whose product came from the household's own
 * database rather than from the model.
 */
export function ReceiptItemList({
  items,
  onEdit,
  learnedIds,
}: {
  items: ReceiptItem[]
  onEdit?: (item: ReceiptItem) => void
  learnedIds?: readonly string[]
}) {
  const traits = getActiveTraits()
  const learned = new Set(learnedIds ?? [])

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
            <Row item={item} traits={traits} learned={learned.has(item.id)} />
          </button>
        ) : (
          <div key={item.id} className={styles.row}>
            <Row item={item} traits={traits} learned={learned.has(item.id)} />
          </div>
        ),
      )}
    </div>
  )
}

/**
 * Key for the badges, built from the traits that actually occur in `items`.
 * Not hard-wired: a new trait shows up here on its own, and a trait hidden
 * behind `+2` is still explained.
 */
export function TraitLegend({ items }: { items: ReceiptItem[] }) {
  const traits = getActiveTraits()
  const seen = new Set(items.flatMap((item) => itemTraits(item, traits)).map((trait) => trait.id))
  const legend = traits.filter((trait) => seen.has(trait.id))

  if (legend.length === 0) return null

  return (
    <div className={styles.legend}>
      {legend.map((trait) => (
        <span key={trait.id}>
          <span className={styles.legendShort}>{trait.short}</span> {trait.label}
        </span>
      ))}
    </div>
  )
}
