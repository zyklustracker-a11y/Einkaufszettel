import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList } from '../components/ReceiptItemList'
import { Async, EmptyState } from '../components/states'
import { BackLink } from '../components/ui'
import { deleteReceipt, getMerchantName, getReceipt, useQuery } from '../data'
import { receiptDiscrepancy, receiptItemsTotal } from '../lib/derive'
import { formatDate, formatEuro, formatMoney } from '../lib/format'
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
  const routed = useLocation().state as { justSaved?: boolean; updated?: boolean } | null
  const justSaved = routed?.justSaved === true
  const wasUpdated = routed?.updated === true

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
            <PurchaseBody receipt={receipt} justSaved={justSaved} wasUpdated={wasUpdated} />
          )
        }
      </Async>
    </div>
  )
}

function PurchaseBody({
  receipt,
  justSaved,
  wasUpdated,
}: {
  receipt: Receipt
  justSaved: boolean
  /** Aus dem Bearbeiten gekommen und nicht aus einem frischen Scan. */
  wasUpdated: boolean
}) {
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
          {wasUpdated
            ? 'Änderungen gesichert. Korrekturen an Produkten gelten rückwirkend für alle Käufe.'
            : 'Gespeichert. Der Einkauf zählt ab jetzt in der Übersicht mit.'}
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
        {/*
          Mit Trinkgeld: Hier steht, was der Einkauf gekostet hat. Die gedruckte
          Summe allein wäre bei einem Restaurantbesuch die falsche Zahl — und
          die einzige, die die Übersicht daneben nicht zeigt.
        */}
        <div className={styles.total}>
          {formatEuro(receipt.printedTotalCents + receipt.tipCents)}
        </div>
      </div>

      {receipt.tipCents > 0 && (
        <p className={styles.tip}>
          Davon {formatEuro(receipt.tipCents)} Trinkgeld · Bon {formatEuro(receipt.printedTotalCents)}
        </p>
      )}

      {/*
        Der Originalbetrag zusätzlich unter dem Euro-Betrag
        (KONZEPT-ERWEITERUNGEN.md, Abschnitt 5). Der Kurs steht daneben, weil er
        die Zahl darüber erklärt — und weil er eingefroren ist: Ein späterer
        Kurswechsel ändert diesen Bon nicht mehr.
      */}
      {receipt.originalTotalCents !== null && receipt.exchangeRate !== null && (
        <p className={styles.tip}>
          {formatMoney(receipt.originalTotalCents, receipt.currency)} · Kurs{' '}
          {receipt.exchangeRate.toFixed(6).replace('.', ',')}
          {receipt.rateDate ? ` (EZB, ${formatDate(receipt.rateDate)})` : ''}
        </p>
      )}

      {/*
        „Korrigieren" stand hier bis Schritt 4b-2 und führte in den
        Korrektur-Screen, der auf frisch erkannten Daten arbeitete — ein Knopf,
        der etwas anderes tut als er verspricht, ist schlechter als keiner.
        Deshalb war er entfallen.
        Seit Schritt 5b ist er zurück, und diesmal hält er, was er verspricht:
        Der Korrektur-Screen lädt den gespeicherten Bon in dieselbe Entwurfsform
        wie einen frisch gescannten, und beim Sichern wird dieser Bon
        aktualisiert statt ein zweiter angelegt.
      */}
      <div className={styles.actions}>
        <Link to={`/einkauf/${receipt.id}/bearbeiten`} className={styles.action}>
          Bearbeiten
        </Link>
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
