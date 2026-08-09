import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ProgressBar } from '../components/ui'
import {
  ExtractionError,
  consumeScanJob,
  extractReceipt,
  getScanJob,
  resumeScan,
  startScanJob,
} from '../data'
import type { CapturedImage } from '../lib/camera'
import type { ExtractionPhase, ExtractionResponse } from '../lib/extraction'
import { getPendingCapture } from '../lib/capture'
import { formatPercent } from '../lib/format'
/*
 * Der Fortschritt selbst steht in `lib/progress.ts` — dort sind auch die
 * Zeitschätzungen die Stellschraube, und dort sind die drei Regeln (nie
 * rückwärts, Halt bei 95 %, 100 % erst mit dem Ergebnis) mit Tests festgenagelt.
 * Hier steht nur, wie oft nachgerechnet und wie das Ergebnis gezeichnet wird.
 */
import {
  advanceProgress,
  COMPLETE,
  FINISH_MS,
  PROGRESS_STEPS,
  TICK_MS,
} from '../lib/progress'
import { clearPendingExtraction, setPendingExtraction } from '../lib/scanResult'
import styles from './ScanProcessing.module.css'

/**
 * Ab wann zusätzlich beruhigt wird.
 *
 * Ein langer Bon braucht beim Modell durchaus zwanzig Sekunden. Ohne Hinweis
 * sieht das nach „hängt" aus, und der Nutzer bricht ab — obwohl die Antwort
 * gleich da wäre.
 */
const PATIENCE_MS = 18_000

/**
 * Gründe, bei denen ein zweiter Versuch nichts bringt: Da fehlt eine Anmeldung
 * oder eine Einrichtung, und die repariert kein Knopfdruck. Dann verschwindet
 * „Noch einmal versuchen", statt in eine Sackgasse zu führen.
 */
const HOPELESS = [
  'nicht_angemeldet',
  'kein_schluessel',
  'kein_haushalt',
  'nicht_eingerichtet',
  // Ein abgelehntes Modell bleibt beim zweiten Versuch abgelehnt. Da hilft nur,
  // das Secret zu ändern — und die Meldung sagt inzwischen genau das.
  'modell_abgelehnt',
]

/** Der Satz für einen Fehlschlag, zu dem der Server nichts Genaueres gesagt hat. */
const GENERIC_FAIL = 'Die Erkennung hat nicht geklappt. Bitte versuch es noch einmal.'

interface ScanError {
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
  retryable: boolean
  /**
   * Die Rohantwort des Modells, falls es eine gab.
   *
   * Gerade wenn das Modell kaputtes JSON geliefert hat, ist sie das einzige,
   * womit sich der Prompt nachschärfen lässt — deshalb steht sie auch im
   * Fehlerfall zur Verfügung und nicht nur bei Erfolg.
   */
  raw: string | null
}

/** Aus einem geworfenen Fehler wird das, was auf dem Screen steht. */
function describe(cause: unknown): ScanError {
  if (cause instanceof ExtractionError) {
    return {
      message: cause.message,
      retryable: !HOPELESS.includes(cause.code),
      raw: cause.raw,
    }
  }
  return { message: GENERIC_FAIL, retryable: true, raw: null }
}

/** Dateigröße in KB – nur zur Kontrolle, dass das Verkleinern wirkt. */
function sizeInKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * Maße als „Quelle → Ergebnis", sobald verkleinert wurde.
 *
 * Steht nur eine Zahl da, war das Kamerabild schon klein genug. Das ist der
 * Unterschied, den man am Gerät sonst nicht sieht: ob ein kleines Bild aus dem
 * Verkleinern kommt oder aus einer Kamera, die nicht mehr hergibt.
 */
function dimensions(capture: CapturedImage): string {
  const result = `${capture.width} × ${capture.height} px`
  if (capture.sourceWidth === capture.width && capture.sourceHeight === capture.height) {
    return result
  }
  return `${capture.sourceWidth} × ${capture.sourceHeight} → ${result}`
}

/**
 * Der Verarbeitungs-Screen: hier läuft die Erkennung.
 *
 * Das aufgenommene Foto geht an die Edge Function, die Mistral befragt und
 * geprüfte Bon-Daten zurückgibt. Das Ergebnis wird **nicht** gespeichert
 * (Schritt 4b-2), sondern im Speicher an den Korrektur-Screen weitergereicht.
 *
 * Ohne Foto — nach einem Neuladen oder beim direkten Aufruf der Adresse — gibt
 * es nichts zu erkennen. Dann steht das hier auch so da, statt eine Erkennung
 * vorzutäuschen, die gar nicht laufen kann.
 */
export function ScanProcessing() {
  const navigate = useNavigate()
  const capture = getPendingCapture()

  const [preview, setPreview] = useState<string | null>(null)
  const [phase, setPhase] = useState<ExtractionPhase>('vorbereiten')
  /*
   * Welche Abschnitte wirklich gelaufen sind.
   *
   * Nötig, weil einer entfallen kann: Kennt der Haushalt jeden Artikel des
   * Bons, findet die Zuordnung gar nicht statt. Ein Häkchen daneben wäre dann
   * eine kleine Lüge — der Schritt bekommt stattdessen „entfällt".
   */
  const [visited, setVisited] = useState<ExtractionPhase[]>(['vorbereiten'])
  /**
   * Das Ergebnis ist da.
   *
   * Ohne diesen Zustand bekäme der letzte Abschnitt nie sein Häkchen: Er ist
   * der laufende, wenn der Screen verschwindet. Mit ihm sind am Ende alle vier
   * abgehakt — und das ist keine Behauptung, sondern der Tatbestand.
   */
  const [done, setDone] = useState(false)

  const enterPhase = (next: ExtractionPhase) => {
    setPhase(next)
    setVisited((current) => (current.includes(next) ? current : [...current, next]))
  }
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<ScanError | null>(null)
  const [slow, setSlow] = useState(false)
  /** Zählt hoch, wenn „Noch einmal versuchen" gedrückt wird. */
  const [attempt, setAttempt] = useState(0)

  /*
   * Die laufende Anfrage, festgehalten statt neu gestartet.
   *
   * React ruft Effekte im Entwicklungsmodus absichtlich doppelt auf (montieren,
   * abräumen, wieder montieren). Würde der Effekt jedes Mal `extractReceipt`
   * aufrufen, liefe jeder Scan zweimal — und jede Anfrage zählt gegen das freie
   * Kontingent. Deshalb wird beim zweiten Durchlauf dasselbe Versprechen
   * weiterverwendet; nur „Noch einmal versuchen" (`attempt`) startet wirklich
   * eine neue Anfrage.
   */
  const requestRef = useRef<{ attempt: number; promise: Promise<ExtractionResponse> } | null>(null)

  /*
   * Der Scan-Job dieses Durchlaufs — der Rettungsweg aus Schritt 6.
   *
   * Wechselt der Nutzer während der vierzehn Sekunden in eine andere App, friert
   * Safari die Seite ein: Die Anfrage steht, die Zeitgeber stehen, und wenn er
   * zurückkommt, ist die Antwort niemandem mehr zustellbar. Die Edge Function
   * hat ihr Ergebnis dann aber in den Job geschrieben, und von dort wird es hier
   * abgeholt (KONZEPT-ERWEITERUNGEN.md, Abschnitt 3).
   */
  const jobIdRef = useRef<string | null>(null)

  /**
   * Der Screen ist fertig — egal, über welchen der beiden Wege.
   *
   * Ohne diese Sperre könnten Antwort und Rettungsweg zugleich ankommen (die
   * eingefrorene Anfrage löst sich manchmal doch noch auf) und der Screen würde
   * zweimal weiterspringen.
   */
  const settledRef = useRef(false)
  const finishTimerRef = useRef(0)

  const finish = useCallback(
    (result: ExtractionResponse) => {
      if (settledRef.current) return
      settledRef.current = true

      setPendingExtraction(result)
      // Erst jetzt die volle Anzeige — vorher wäre sie eine Behauptung.
      setProgress(COMPLETE)
      setDone(true)

      // Der Job hat seine Aufgabe erfüllt und soll sich nicht als offener Scan
      // melden, während der Nutzer den Korrektur-Screen vor sich hat.
      if (jobIdRef.current) void consumeScanJob(jobIdRef.current)

      finishTimerRef.current = window.setTimeout(
        () => navigate('/scan/pruefen', { replace: true }),
        FINISH_MS,
      )
    },
    [navigate],
  )

  const failWith = useCallback((cause: unknown) => {
    if (settledRef.current) return
    settledRef.current = true
    setError(describe(cause))
  }, [])

  /**
   * Nachsehen, ob der Server inzwischen fertig ist.
   *
   * Wird an zwei Stellen aufgerufen: wenn die Seite wieder sichtbar wird, und
   * wenn die Anfrage fehlgeschlagen ist. Beides sind genau die Fälle, in denen
   * das Ergebnis serverseitig fertig sein kann, ohne dass es hier ankam.
   */
  const recover = useCallback(async (): Promise<boolean> => {
    const jobId = jobIdRef.current
    if (!jobId || settledRef.current) return false

    const job = await getScanJob(jobId)
    if (!job || settledRef.current) return false

    if (job.status === 'done' && job.result) {
      try {
        finish(await resumeScan(job.result, enterPhase))
        return true
      } catch (cause) {
        failWith(cause)
        return true
      }
    }

    if (job.status === 'failed') {
      failWith(new ExtractionError(job.errorCode ?? 'unbekannt', job.errorMessage ?? GENERIC_FAIL))
      return true
    }

    // `running`: Die Erkennung läuft noch. Nichts tun — der Balken wartet.
    return false
    // `enterPhase` wird bei jedem Rendern neu erzeugt, ist aber nur ein Melder
    // und trägt keinen Zustand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, failWith])

  /*
   * Zurück aus dem Hintergrund: einmal nachfragen. Das ist der eigentliche
   * Zweck des Jobs — ohne diesen Haken wäre er nur eine Zeile in der Datenbank.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recover()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [recover])

  useEffect(() => {
    if (!capture) return
    const url = URL.createObjectURL(capture.blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [capture])

  useEffect(() => {
    if (!capture || error) return
    const timer = window.setTimeout(() => setSlow(true), PATIENCE_MS)
    return () => window.clearTimeout(timer)
  }, [capture, error, attempt])

  /*
   * Wann der laufende Abschnitt begonnen hat. Als Ref und nicht als Zustand:
   * Der Wert löst kein Neuzeichnen aus, er wird nur beim Nachrechnen gelesen.
   * Dieser Effekt steht bewusst VOR dem Takt-Effekt darunter — React führt
   * Effekte in der Reihenfolge ihrer Deklaration aus, und die neue Startzeit
   * muss stehen, bevor zum ersten Mal damit gerechnet wird.
   */
  const phaseStartRef = useRef(Date.now())
  useEffect(() => {
    phaseStartRef.current = Date.now()
  }, [phase, attempt])

  useEffect(() => {
    if (!capture || error) return

    const tick = () =>
      setProgress((current) =>
        advanceProgress(current, phase, Date.now() - phaseStartRef.current),
      )

    // Sofort einmal, damit der Sprung zum nächsten Abschnitt nicht erst nach
    // einem Takt sichtbar wird.
    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(timer)
  }, [capture, error, phase, attempt])

  useEffect(() => {
    if (!capture) return

    let cancelled = false

    if (requestRef.current?.attempt !== attempt) {
      // Ein Ergebnis aus einem früheren Durchlauf hat hier nichts zu suchen.
      clearPendingExtraction()
      setError(null)
      setSlow(false)
      setPhase('vorbereiten')
      setVisited(['vorbereiten'])
      setDone(false)
      setProgress(0)
      settledRef.current = false
      jobIdRef.current = null
      phaseStartRef.current = Date.now()

      /*
       * Erst der Job, dann das Bild. Der Job kostet eine kurze Anfrage und darf
       * scheitern: Kommt keine id zurück (fehlende Migration, kein Netz), läuft
       * die Erkennung wie vor Schritt 6 — sie überlebt dann nur keinen
       * App-Wechsel. Ein Rettungsweg, der den Normalfall blockiert, wäre ein
       * schlechter Tausch.
       */
      requestRef.current = {
        attempt,
        promise: startScanJob().then((jobId) => {
          jobIdRef.current = jobId
          return extractReceipt(capture, enterPhase, jobId)
        }),
      }
    }

    requestRef.current.promise.then(
      (result) => {
        if (cancelled) return
        finish(result)
      },
      (cause: unknown) => {
        if (cancelled) return
        /*
         * Bevor hier ein Fehler steht: nachsehen, ob der Server fertig ist. Genau
         * das ist der Fall nach einem App-Wechsel — die Anfrage bricht ab, das
         * Ergebnis liegt aber im Job. Ein „Erkennung fehlgeschlagen" wäre dann
         * schlicht falsch, und der Nutzer verbrennte einen zweiten Modellaufruf.
         */
        void recover().then((rescued) => {
          if (!rescued && !cancelled) failWith(cause)
        })
      },
    )

    return () => {
      cancelled = true
      window.clearTimeout(finishTimerRef.current)
    }
  }, [capture, attempt, finish, failWith, recover])

  if (!capture) {
    return (
      <div className={styles.screen}>
        <div className={styles.note}>
          <h1 className={styles.headline}>Kein Bon zum Verarbeiten</h1>
          <p className={styles.sub}>
            Das Foto liegt nur im Arbeitsspeicher und überlebt kein Neuladen der Seite. Nimm den Bon
            bitte noch einmal auf.
          </p>
        </div>
        <Link to="/scan" replace className={styles.skip}>
          Bon aufnehmen
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.screen}>
        {preview && <img src={preview} alt="Aufgenommener Bon" className={styles.photo} />}
        <div className={styles.note} role="alert">
          <h1 className={styles.headline}>Erkennung fehlgeschlagen</h1>
          <p className={styles.sub}>{error.message}</p>
        </div>

        {error.raw && (
          <details className={styles.raw}>
            <summary className={styles.rawSummary}>Rohantwort des Modells</summary>
            <pre className={styles.rawText}>{error.raw}</pre>
          </details>
        )}

        <div className={styles.actions}>
          {error.retryable && (
            <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
              Noch einmal versuchen
            </button>
          )}
          <Link to="/scan" replace className={styles.skip}>
            Neu aufnehmen
          </Link>
        </div>
      </div>
    )
  }

  const current = PROGRESS_STEPS.findIndex((step) => step.phase === phase)

  return (
    <div className={styles.screen}>
      <div className={styles.spinner} />
      <div style={{ textAlign: 'center' }}>
        <h1 className={styles.headline}>KI liest deinen Bon…</h1>
        <p className={styles.sub}>Positionen werden erkannt und Kategorien zugeordnet.</p>
      </div>

      {/*
        Derselbe Balken wie beim Monatsbudget auf der Übersicht — dieselbe
        Komponente, nicht nachgebaut. Damit kann er optisch gar nicht
        auseinanderlaufen.
      */}
      <div className={styles.progress}>
        <ProgressBar fraction={progress / 100} label="Fortschritt der Erkennung" />
        <div className={styles.progressValue}>{formatPercent(progress / 100)}</div>
      </div>

      {/*
        Vier Zustände, und jeder ist an dem zu erkennen, was er bedeutet:
        erledigt (Häkchen), läuft gerade (gefüllter Punkt, Text hervorgehoben),
        entfällt (Strich), kommt noch (leerer Kreis, gedämpft).

        Der laufende Abschnitt braucht seine eigene Anzeige, weil einer von
        ihnen vierzehn Sekunden dauert: Ohne sie stünde die Liste die längste
        Zeit des Scans regungslos da.
      */}
      <ol className={styles.steps} aria-live="polite">
        {PROGRESS_STEPS.map((step, index) => {
          const passed = done || index < current
          // Vorbei, aber nie betreten: Der Abschnitt ist entfallen.
          const skipped = passed && !visited.includes(step.phase)
          const complete = passed && !skipped
          const running = !done && index === current

          const state = complete ? 'done' : skipped ? 'skipped' : running ? 'running' : 'pending'

          return (
            <li key={step.phase} className={`${styles.step} ${styles[`step--${state}`]}`}>
              <span className={`${styles.tick} ${styles[`tick--${state}`]}`} aria-hidden="true">
                {complete ? '✓' : skipped ? '–' : ''}
              </span>
              {step.label}
              {skipped && <span className={styles.skipped}> entfällt, alles schon bekannt</span>}
            </li>
          )
        })}
      </ol>

      {slow && (
        <p className={styles.sub} role="status">
          Ein langer Bon braucht etwas. Bitte noch kurz warten – die Aufnahme läuft noch.
        </p>
      )}

      <p className={styles.meta}>
        {dimensions(capture)} · {sizeInKb(capture.blob.size)} · JPEG
      </p>
    </div>
  )
}
