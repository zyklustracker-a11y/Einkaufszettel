import { Link, useNavigate } from 'react-router-dom'
import styles from './ScanCamera.module.css'

/**
 * Viewfinder. The preview area is a placeholder — a real build swaps it for a
 * `<video>` element fed by `getUserMedia`, or the file input behind "Upload".
 */
export function ScanCamera() {
  const navigate = useNavigate()
  const capture = () => navigate('/scan/verarbeitung')

  return (
    <div className={styles.screen}>
      <div className={styles.bar}>
        <Link to="/" className={styles.cancel}>
          Abbrechen
        </Link>
        <div className={styles.title}>Bon scannen</div>
      </div>

      <div className={styles.stage}>
        <div className={styles.frame}>
          <span className={`${styles.corner} ${styles['corner--tl']}`} />
          <span className={`${styles.corner} ${styles['corner--tr']}`} />
          <span className={`${styles.corner} ${styles['corner--bl']}`} />
          <span className={`${styles.corner} ${styles['corner--br']}`} />
          <span className={styles.scanLine} />
          <span className={styles.placeholder}>Kamera-Vorschau</span>
        </div>
      </div>

      <p className={styles.hint}>Bon flach und gut beleuchtet fotografieren – gesamte Länge im Rahmen.</p>

      <div className={styles.controls}>
        <button type="button" className={styles.sideButton} onClick={capture}>
          Upload
        </button>
        <button type="button" className={styles.shutter} onClick={capture} aria-label="Auslösen" />
        <div className={`${styles.sideButton} ${styles['sideButton--off']}`} aria-hidden="true">
          Blitz
        </div>
      </div>
    </div>
  )
}
