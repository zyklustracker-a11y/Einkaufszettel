import { useState } from 'react'
import { GoogleIcon, ReceiptMark } from '../components/icons'
import { useAuth } from '../state/AuthContext'
import styles from './Login.module.css'

export function Login() {
  const { signInWithGoogle, error } = useAuth()
  const [starting, setStarting] = useState(false)

  const start = async () => {
    setStarting(true)
    await signInWithGoogle()
    /*
     * Klappt es, verlässt der Browser diese Seite ohnehin — die Zeile darunter
     * wird dann nie erreicht. Nur im Fehlerfall bleiben wir hier und geben den
     * Knopf wieder frei.
     */
    setStarting(false)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.intro}>
        <div className={styles.mark}>
          <ReceiptMark />
        </div>
        <div>
          <h1 className={styles.name}>Receipt AI</h1>
          <p className={styles.claim}>Scanne deine Kassenzettel, verstehe deine Ausgaben.</p>
        </div>
      </div>

      <div className={styles.actions}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button type="button" className={styles.googleButton} onClick={start} disabled={starting}>
          <GoogleIcon />
          {starting ? 'Weiterleitung zu Google…' : 'Mit Google anmelden'}
        </button>
        <p className={styles.note}>Privater Haushalts-Zugang · Daten bleiben in deinem Konto</p>
      </div>
    </div>
  )
}
