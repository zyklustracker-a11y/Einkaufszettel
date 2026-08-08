import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList } from '../components/ReceiptItemList'
import { Async, EmptyState } from '../components/states'
import { BackLink } from '../components/ui'
import { deleteReceipt, getMerchantName, getReceipt, useQuery } from '../data'
import { receiptDiscrepancy, receiptItemsTotal } from '../lib/derive'
import { formatDate, formatEuro } from '../lib/format'
import type { Receipt } from '../types'
import styles from './PurchaseDetail.module.css'

export function PurchaseDetail() {
  const { receiptId } = useParams()
  const state = useQuery(() => getReceipt(receiptId ?? ''), [receiptId])

  /*
   * Der Korrektur-Screen setzt das beim Weiterleiten. Es reist im Zustand des
   * Routers und nicht in der Adresse: Ein Neuladen soll die Bestätigung nicht
   * wiederholen — gespeichert wurde ja nur einmal.
   */
  const justSaved = (useLocation().state as { justSaved?: boolean } | null)?.justSaved === true

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
            <PurchaseBody receipt={receipt} justSaved={justSaved} />
          )
        }
      </Async>
    </div>
  )
}

function PurchaseBody({ receipt, justSaved }: { receipt: Receipt; justSaved: boolean }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const itemsTotalCents = receiptItemsTotal(receipt)
  const differenceCents = receiptDiscrepancy(receipt)

  const remove = async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteReceipt(receipt.id)
      navigate('/', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Einkauf konnte nicht gelöscht werden.')
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <>
      {justSaved && (
        <div className={styles.saved} role="status">
          Gespeichert. Der Einkauf zählt ab jetzt in der Übersicht mit.
        </div>
      )}

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

      {/*
        „Korrigieren" stand hier bis Schritt 4b-2 und führte in den
        Korrektur-Screen. Das ist entfallen: Der Screen arbeitet an einem frisch
        erkannten Bon, nicht an einem gespeicherten — ein Knopf, der etwas
        anderes tut als er verspricht, ist schlechter als keiner. Einen
        gespeicherten Bon nachträglich zu ändern kommt später; bis dahin ist der
        Weg: löschen und neu scannen.
      */}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.action} ${styles['action--danger']}`}
          onClick={() => setConfirming(true)}
        >
          Löschen
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

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
          {/*
            Der Unterschied, auf den es ankommt: Gelöscht wird der Einkauf, nicht
            das Gelernte. Die Zuordnungen von Bontext zu Produkt bleiben stehen —
            sonst müsste man nach jedem gelöschten Testbon von vorn anfangen.
          */}
          <p className={styles.confirmText}>
            Was die App gelernt hat, bleibt: Produkte, Kategorien und Merkmale werden nicht
            gelöscht.
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.confirmDelete}
              disabled={deleting}
              onClick={remove}
            >
              {deleting ? 'Wird gelöscht…' : 'Endgültig löschen'}
            </button>
            <button
              type="button"
              className={styles.confirmCancel}
              onClick={() => setConfirming(false)}
            >
              Abbrechen
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
