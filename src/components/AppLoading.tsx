import { ReceiptMark } from './icons'
import styles from './AppLoading.module.css'

/**
 * Was zu sehen ist, solange die Sitzung geprüft wird.
 *
 * Bewusst weder Anmelde-Screen noch Dashboard: Welcher von beiden richtig ist,
 * steht erst fest, wenn Supabase geantwortet hat. Zeigte man vorher einen davon,
 * blitzte beim Start die falsche Seite auf.
 */
export function AppLoading() {
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <div className={styles.mark}>
        <ReceiptMark />
      </div>
      <span className="visuallyHidden">Anmeldung wird geprüft…</span>
    </div>
  )
}
