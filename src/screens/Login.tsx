import { useNavigate } from 'react-router-dom'
import { GoogleIcon, ReceiptMark } from '../components/icons'
import styles from './Login.module.css'

export function Login() {
  const navigate = useNavigate()

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
        {/* Hooked up to Supabase Auth later; for now it just enters the app. */}
        <button type="button" className={styles.googleButton} onClick={() => navigate('/', { replace: true })}>
          <GoogleIcon />
          Mit Google anmelden
        </button>
        <p className={styles.note}>Privater Haushalts-Zugang · Daten bleiben in deinem Konto</p>
      </div>
    </div>
  )
}
