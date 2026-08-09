import { useEffect, useState } from 'react'
import { Toggle } from '../components/ui'
import { getHouseholdId } from '../data'
import {
  disablePush,
  enablePush,
  hasPushSubscription,
  pushPermission,
  pushSupport,
} from '../lib/push'
import styles from './HouseholdSettings.module.css'

/**
 * Benachrichtigungen.
 *
 * Ein Schalter, ein Erklärungsabsatz — und, wenn etwas fehlt, ein Satz, der
 * sagt **was**. Genau das ist hier der schwierige Teil: Auf dem iPhone
 * funktioniert Web Push nur in der über „Zum Home-Bildschirm" installierten App.
 * Im Safari-Tab gibt es die Schnittstelle gar nicht, und ein „nicht unterstützt"
 * wäre die unbrauchbarste aller Antworten.
 *
 * **Die Berechtigung wird erst beim Umlegen erfragt.** Ein Dialog, der ohne
 * Zusammenhang beim Start aufpoppt, wird weggetippt — und danach ist er auf iOS
 * dauerhaft weg, das lässt sich nur noch in den Geräte-Einstellungen zurückholen.
 */
export function NotificationSettings() {
  const support = pushSupport()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void hasPushSubscription().then((has) => {
      if (cancelled) return
      setEnabled(has)
      setChecked(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      if (enabled) {
        await disablePush()
        setEnabled(false)
      } else {
        await enablePush(getHouseholdId())
        setEnabled(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Das hat nicht geklappt.')
    } finally {
      setBusy(false)
    }
  }

  const denied = pushPermission() === 'denied'

  return (
    <section className={styles.card}>
      <div className={styles.cardTitle}>Monatsreport</div>

      {support.ok ? (
        <>
          <div className={styles.member} style={{ borderTop: 'none' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.memberName}>Meldung am Monatsanfang</span>
              <span className={styles.memberMail}>
                {enabled ? 'Dieses Gerät bekommt sie' : 'Aus'}
              </span>
            </span>
            <Toggle
              checked={enabled}
              onChange={() => void toggle()}
              label="Monatsreport als Benachrichtigung"
            />
          </div>

          {busy && <p className={styles.note}>Einen Moment…</p>}

          {denied && !enabled && (
            <p className={styles.warn}>
              Benachrichtigungen sind für diese App abgelehnt. Das lässt sich nur am Gerät wieder
              ändern: Einstellungen → Receipt AI → Mitteilungen.
            </p>
          )}

          <p className={styles.note}>
            Am zweiten Tag jedes Monats kommt eine kurze Meldung mit der Summe des Vormonats, der
            Zahl der Einkäufe und – wenn ein Budget gesetzt ist – wie weit es gereicht hat. Ein Tipp
            darauf öffnet die Analysen.
          </p>
          <p className={styles.note}>
            <strong>Je Gerät einzeln.</strong> Der Schalter gilt für das Gerät, auf dem du gerade
            bist – nicht fürs Konto. So bekommt niemand die Meldung auf einem Telefon, das er kaum
            benutzt.
          </p>
        </>
      ) : (
        <p className={styles.warn}>{support.reason}</p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {!checked && support.ok && <p className={styles.note}>Wird geprüft…</p>}
    </section>
  )
}
