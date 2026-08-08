import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList } from '../components/ReceiptItemList'
import { Async, EmptyState } from '../components/states'
import { BackLink } from '../components/ui'
import { getMerchantName, getReceipt, useQuery } from '../data'
import { receiptDiscrepancy, receiptItemsTotal } from '../lib/derive'
import { formatDate, formatEuro } from '../lib/format'
import type { Receipt } from '../types'
import styles from './PurchaseDetail.module.css'

export function PurchaseDetail() {
  const { receiptId } = useParams()
  const state = useQuery(() => getReceipt(receiptId ?? ''), [receiptId])

  return (
    <div className="screen screen--tabbed">
      <BackLink to="/">Übersicht</BackLink>
      <Async state={state}>
        {(receipt) =>
          receipt === null ? (
            <EmptyState title="Einkauf nicht gefunden" link={{ to: '/', label: 'Zur Übersicht' }}>
              Diesen Einkauf gibt es nicht mehr. Möglicherweise wurde er auf einem anderen Gerät
              gelöscht.
            </EmptyState>
          ) : (
            <PurchaseBody receipt={receipt} />
          )
        }
      </Async>
    </div>
  )
}

function PurchaseBody({ receipt }: { receipt: Receipt }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  const itemsTotalCents = receiptItemsTotal(receipt)
  const differenceCents = receiptDiscrepancy(receipt)

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1 className={styles.merchant}>{getMerchantName(receipt.merchantId)}</h1>
          <div className={styles.meta}>
            {formatDate(receipt.date)} · {receipt.items.length}{' '}
            {receipt.items.length === 1 ? 'Position' : 'Positionen'}
          </div>
        </div>
        <div className={styles.total}>{formatEuro(receipt.printedTotalCents)}</div>
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

      {receipt.items.length === 0 ? (
        <EmptyState inline title="Keine Positionen erfasst">
          Zu diesem Bon wurden keine einzelnen Zeilen gespeichert – nur die gedruckte Summe.
        </EmptyState>
      ) : (
        <>
          <ReceiptItemList items={receipt.items} />
          <p className={styles.footnote}>
            Positionssumme {formatEuro(itemsTotalCents)}
            {differenceCents === 0
              ? ' · stimmt mit dem Bon-Total überein.'
              : ` · Abweichung ${formatEuro(Math.abs(differenceCents))} zum Bon-Total.`}
          </p>
        </>
      )}

      {confirming && (
        <BottomSheet title="Einkauf löschen?" onClose={() => setConfirming(false)}>
          <p className={styles.confirmText}>
            {getMerchantName(receipt.merchantId)} vom {formatDate(receipt.date)} mit{' '}
            {receipt.items.length} Positionen wird dauerhaft entfernt. Die Preishistorie dieser
            Produkte verliert diesen Eintrag.
          </p>
          <div className={styles.confirmActions}>
            {/* Das Löschen selbst kommt in Schritt 4, zusammen mit dem Speichern. */}
            <button
              type="button"
              className={styles.confirmDelete}
              onClick={() => navigate('/', { replace: true })}
            >
              Endgültig löschen
            </button>
            <button type="button" className={styles.confirmCancel} onClick={() => setConfirming(false)}>
              Abbrechen
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
