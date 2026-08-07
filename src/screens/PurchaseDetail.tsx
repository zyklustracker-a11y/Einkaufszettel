import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList } from '../components/ReceiptItemList'
import { BackLink } from '../components/ui'
import { getReceipt } from '../data'
import { receiptDiscrepancy, receiptItemsTotal } from '../lib/derive'
import { formatDate, formatEuro } from '../lib/format'
import styles from './PurchaseDetail.module.css'

export function PurchaseDetail() {
  const { receiptId } = useParams()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const receipt = receiptId ? getReceipt(receiptId) : undefined
  if (!receipt) return <Navigate to="/" replace />

  const itemsTotal = receiptItemsTotal(receipt)
  const difference = receiptDiscrepancy(receipt)

  return (
    <div className="screen screen--tabbed">
      <BackLink to="/">Übersicht</BackLink>

      <div className={styles.head}>
        <div>
          <h1 className={styles.merchant}>{receipt.merchant}</h1>
          <div className={styles.meta}>
            {formatDate(receipt.date)} · {receipt.items.length} Positionen
          </div>
        </div>
        <div className={styles.total}>{formatEuro(receipt.printedTotal)}</div>
      </div>

      <div className={styles.actions}>
        <Link to="/scan/pruefen" className={styles.action}>
          Korrigieren
        </Link>
        <button
          type="button"
          className={`${styles.action} ${styles['action--danger']}`}
          onClick={() => setConfirming(true)}
        >
          Löschen
        </button>
      </div>

      <ReceiptItemList items={receipt.items} />

      <p className={styles.footnote}>
        Positionssumme {formatEuro(itemsTotal)}
        {difference === 0
          ? ' · stimmt mit dem Bon-Total überein.'
          : ` · Abweichung ${formatEuro(Math.abs(difference))} zum Bon-Total.`}
      </p>

      {confirming && (
        <BottomSheet title="Einkauf löschen?" onClose={() => setConfirming(false)}>
          <p className={styles.confirmText}>
            {receipt.merchant} vom {formatDate(receipt.date)} mit {receipt.items.length} Positionen wird
            dauerhaft entfernt. Die Preishistorie dieser Produkte verliert diesen Eintrag.
          </p>
          <div className={styles.confirmActions}>
            {/* Deletion is a no-op against mock data; it just returns to the dashboard. */}
            <button type="button" className={styles.confirmDelete} onClick={() => navigate('/', { replace: true })}>
              Endgültig löschen
            </button>
            <button type="button" className={styles.confirmCancel} onClick={() => setConfirming(false)}>
              Abbrechen
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}
