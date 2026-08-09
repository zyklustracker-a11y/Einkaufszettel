import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { consumeScanJob, findOpenScanJob, germanDataError, resumeScan } from '../data'
import type { ScanJob } from '../data'
import { setPendingExtraction } from '../lib/scanResult'
import styles from './OpenScanNotice.module.css'

/**
 * „Ein Scan liegt noch bereit."
 *
 * Der zweite Teil des Rettungswegs aus Schritt 6. Der erste steckt im
 * Verarbeitungs-Screen und greift, solange die Seite noch lebt; dieser hier
 * greift, wenn iOS sie ganz aus dem Speicher geworfen hat
 * (KONZEPT-ERWEITERUNGEN.md, Abschnitt 3). Dann ist beim nächsten Öffnen alles
 * weg — das Foto, der Fortschritt, der Screen —, aber das Ergebnis liegt in
 * `scan_jobs`.
 *
 * **Das Foto ist in diesem Fall verloren, das Ergebnis nicht.** Das ist die
 * Grenze, die bleibt, und sie ist hinnehmbar: Das Ergebnis ist der teure Teil.
 *
 * Steht auf der Übersicht, weil das der Screen ist, auf dem die App startet. Ist
 * nichts offen — der Normalfall —, zeichnet die Komponente gar nichts.
 */
export function OpenScanNotice() {
  const navigate = useNavigate()
  const [job, setJob] = useState<ScanJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void findOpenScanJob().then((found) => {
      if (!cancelled) setJob(found)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!job) return null

  /*
   * Ein Job, der noch läuft, ist kein Angebot: Dahinter liegt noch nichts. Er
   * verschwindet von selbst, sobald die Funktion fertig ist — und wer die App
   * gerade wieder öffnet, hat den Verarbeitungs-Screen ohnehin verlassen. Ihn zu
   * zeigen hieße, einen Knopf anzubieten, der ins Leere führt.
   */
  if (job.status === 'running') return null

  const dismiss = async () => {
    setBusy(true)
    await consumeScanJob(job.id)
    setJob(null)
  }

  const open = async () => {
    if (!job.result) return
    setBusy(true)
    setError(null)
    try {
      /*
       * Durchgang 2 läuft erst jetzt: Er ist billig, er braucht kein Bild, und
       * er soll mit den Merkmalen laufen, die **heute** gelten. Im Job liegt
       * bewusst nur das Ergebnis von Durchgang 1.
       */
      setPendingExtraction(await resumeScan(job.result))
      await consumeScanJob(job.id)
      navigate('/scan/pruefen')
    } catch (cause) {
      setError(germanDataError(cause))
      setBusy(false)
    }
  }

  if (job.status === 'failed') {
    return (
      <section className={`${styles.card} ${styles['card--failed']}`} role="status">
        <div className={styles.title}>Der letzte Scan ist nicht durchgelaufen</div>
        <p className={styles.text}>
          {job.errorMessage ?? 'Die Erkennung hat nicht geklappt.'} Das Foto ist inzwischen weg –
          bitte noch einmal aufnehmen.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void dismiss().then(() => navigate('/scan'))}
          >
            Neu scannen
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void dismiss()}
          >
            Ausblenden
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.card} role="status">
      <div className={styles.title}>Ein gescannter Bon wartet auf dich</div>
      <p className={styles.text}>
        Die Erkennung ist fertig geworden, während die App im Hintergrund war. Die Positionen
        stehen bereit – du musst sie nur noch prüfen.
      </p>
      {error && (
        <p className={styles.text} role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void open()}>
          {busy ? 'Wird geöffnet…' : 'Ergebnis prüfen'}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => void dismiss()}
        >
          Verwerfen
        </button>
      </div>
    </section>
  )
}
