import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { captureFrame, fileToJpeg } from '../lib/camera'
import type { CapturedImage } from '../lib/camera'
import { clearPendingCapture, setPendingCapture } from '../lib/capture'
import styles from './ScanCamera.module.css'

/**
 * `starting` – die Kamera wird angefragt, das Bild steht noch nicht.
 * `live` – der Kamerastrom läuft im Screen.
 * `fallback` – keine Kamera in der App; der Auslöser öffnet die Kamera von iOS.
 */
type Mode = 'starting' | 'live' | 'fallback'

/** Das aufgenommene Bild plus die Adresse, unter der die Vorschau es anzeigt. */
interface Shot {
  image: CapturedImage
  url: string
}

/**
 * Rückkamera, so hoch aufgelöst wie das Gerät sie hergibt.
 *
 * **Nur eine Kante vorgeben.** Hier stand einmal `width: 2000` *und*
 * `height: 2000`. Zwei Vorgaben zusammen sind für den Browser ein
 * Seitenverhältnis, und er darf das Sensorbild dafür beschneiden: Auf dem
 * iPhone kam ein quadratischer Strom von 2000 × 2000 heraus, bei dem der
 * untere Teil des Bons – und damit die Gesamtsumme – schon vor dem Canvas
 * fehlte. Mit einer einzigen Vorgabe bleibt das natürliche Seitenverhältnis
 * der Kamera erhalten.
 *
 * Vorgegeben wird die **Höhe**, weil die App hochkant benutzt wird und der Bon
 * die lange Kante füllt. 1920 ist bewusst nicht höher: Was darüber liegt,
 * würde `MAX_EDGE` ohnehin wieder wegrechnen, kostet aber Akku und macht die
 * Vorschau träge.
 *
 * `facingMode` ist bewusst eine weiche Angabe ohne `exact`. Auf einem Rechner
 * ohne Rückkamera nimmt der Browser dann die vorhandene, statt abzubrechen –
 * sonst wäre der Screen in der Entwicklung gar nicht zu sehen.
 */
const CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', height: { ideal: 1920 } },
  audio: false,
}

/**
 * Format des Rahmens, solange die Kamera ihres noch nicht gemeldet hat –
 * Breite geteilt durch Höhe, wie im Entwurf.
 */
const DESIGN_ASPECT = 3 / 4.2

const HINTS: Record<Mode, string> = {
  starting: 'Kamera wird gestartet…',
  live: 'Bon flach und gut beleuchtet fotografieren – gesamte Länge im Rahmen.',
  fallback: 'Tippen, um die Kamera zu öffnen.',
}

/**
 * Der Kamera-Screen.
 *
 * Primärweg ist das Livebild über `getUserMedia`: Die Aufnahme passiert
 * innerhalb der App, ohne Wechsel in die Fotos-App. Der Auslöser zeichnet das
 * aktuelle Videobild auf ein Canvas und erzeugt daraus ein JPEG.
 *
 * Gibt es kein `getUserMedia` oder wird die Berechtigung verweigert, springt
 * der Screen in den Rückfallweg: ein verstecktes `<input type="file" capture>`,
 * das die iOS-Kamera als Overlay über der App öffnet. Der Rahmen zum Ausrichten
 * entfällt dabei, alles Weitere bleibt gleich.
 *
 * Bekannte iOS-Eigenheit: Eine installierte PWA fragt die Kameraberechtigung
 * teils bei jedem Start neu ab. Das ist kein Fehler in diesem Code – wird sie
 * verweigert, greift der Rückfallweg.
 */
export function ScanCamera() {
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  /** Nur der erste Fehlversuch öffnet die iOS-Kamera von selbst. */
  const autoOpenedRef = useRef(false)
  /** Ob der Strom nach einem Wechsel in den Hintergrund wieder anlaufen soll. */
  const wantsLiveRef = useRef(false)
  /** Die Adresse der aktuellen Vorschau, damit sie sicher freigegeben wird. */
  const shotUrlRef = useRef<string | null>(null)

  const [mode, setMode] = useState<Mode>('starting')
  const [shot, setShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Das Format des Rahmens folgt dem Kamerabild, nicht umgekehrt.
   *
   * Sonst zeigte der Rahmen einen anderen Ausschnitt als der, der aufgenommen
   * wird, und der Bon würde falsch ausgerichtet – sichtbar wäre der Fehler
   * erst auf dem fertigen Foto.
   */
  const [aspect, setAspect] = useState(DESIGN_ASPECT)

  /*
   * Kamerastrom starten und – das ist der eigentliche Punkt – zuverlässig
   * wieder beenden. Läuft der Strom weiter, leuchtet die Kamera-Anzeige des
   * iPhones und der Akku leidet. Beendet wird deshalb an drei Stellen:
   * beim Verlassen des Screens (auch beim Zurückwischen, das den Screen
   * abbaut), beim Wechsel in den Hintergrund und beim Schließen des Tabs.
   */
  useEffect(() => {
    // Ein alter Bon aus einem früheren Durchlauf hat hier nichts zu suchen.
    clearPendingCapture()

    let cancelled = false

    const stopStream = () => {
      const stream = streamRef.current
      streamRef.current = null
      if (stream) for (const track of stream.getTracks()) track.stop()
      if (videoRef.current) videoRef.current.srcObject = null
    }

    const fallBack = () => {
      if (cancelled) return
      wantsLiveRef.current = false
      setMode('fallback')
      /*
       * Der Rückfallweg soll sich von selbst öffnen. Ob das gelingt, hängt an
       * iOS: Ein programmatischer Klick auf ein Datei-Feld braucht eine noch
       * frische Nutzergeste. Kommt er nicht durch, passiert schlicht nichts –
       * und der Auslöser darunter öffnet die iOS-Kamera auf Tipp.
       */
      if (!autoOpenedRef.current) {
        autoOpenedRef.current = true
        cameraInputRef.current?.click()
      }
    }

    const start = async () => {
      if (cancelled || streamRef.current) return
      if (!navigator.mediaDevices?.getUserMedia) {
        fallBack()
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
        // Der Screen kann in der Wartezeit längst verlassen worden sein.
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          // Safari startet einen nachgereichten Strom nicht immer von allein.
          await video.play().catch(() => undefined)
        }
        wantsLiveRef.current = true
        setMode('live')
      } catch {
        fallBack()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopStream()
      else if (wantsLiveRef.current) void start()
    }

    void start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    // `pagehide` statt `unload` – nur darauf ist auf iOS Verlass.
    window.addEventListener('pagehide', stopStream)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', stopStream)
      stopStream()
    }
  }, [])

  /** Die letzte Vorschau freigeben, wenn der Screen verschwindet. */
  useEffect(() => {
    return () => {
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current)
      shotUrlRef.current = null
    }
  }, [])

  const replaceShot = (image: CapturedImage | null) => {
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current)
    if (!image) {
      shotUrlRef.current = null
      setShot(null)
      return
    }
    const url = URL.createObjectURL(image.blob)
    shotUrlRef.current = url
    setShot({ image, url })
  }

  const shutter = async () => {
    if (busy) return

    // Ohne Livebild ist der Auslöser der Knopf für die iOS-Kamera.
    if (mode !== 'live') {
      cameraInputRef.current?.click()
      return
    }

    const video = videoRef.current
    if (!video?.videoWidth) return

    setBusy(true)
    setError(null)
    try {
      replaceShot(await captureFrame(video))
    } catch {
      setError('Die Aufnahme hat nicht geklappt. Bitte noch einmal versuchen.')
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Zurücksetzen, sonst löst dieselbe Datei beim zweiten Mal kein `change` aus.
    event.target.value = ''
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      replaceShot(await fileToJpeg(file))
    } catch {
      setError('Das Bild konnte nicht gelesen werden. Bitte ein anderes wählen.')
    } finally {
      setBusy(false)
    }
  }

  const use = () => {
    if (!shot) return
    setPendingCapture(shot.image)
    navigate('/scan/verarbeitung')
  }

  const retake = () => {
    setError(null)
    replaceShot(null)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bar}>
        <Link to="/" className={styles.cancel}>
          Abbrechen
        </Link>
        <div className={styles.title}>Bon scannen</div>
      </div>

      <div className={styles.stage}>
        {mode === 'fallback' && !shot ? (
          <div className={styles.fallback}>
            <p className={styles.fallbackTitle}>Kamera in der App nicht verfügbar</p>
            <p className={styles.fallbackText}>
              Der Auslöser öffnet stattdessen die Kamera von iOS. Der Rahmen zum Ausrichten entfällt
              dabei – Bon trotzdem flach und vollständig aufnehmen.
            </p>
          </div>
        ) : (
          <div
            className={shot ? `${styles.frame} ${styles['frame--shot']}` : styles.frame}
            style={{ '--frame-aspect': aspect } as CSSProperties}
          >
            {/*
             * Das <video> bleibt während der Vorschau montiert und wird nur vom
             * Bild überdeckt. Ein neu erzeugtes <video> hätte den Strom
             * verloren, und „Neu aufnehmen" müsste die Berechtigung erneut
             * abfragen – auf iOS jedes Mal mit Systemdialog.
             */}
            {mode !== 'fallback' && (
              <video
                ref={videoRef}
                className={styles.video}
                playsInline
                muted
                autoPlay
                // Erst hier stehen die echten Maße des Stroms fest.
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  if (video.videoWidth && video.videoHeight) {
                    setAspect(video.videoWidth / video.videoHeight)
                  }
                }}
              />
            )}

            {/* Rahmen-Hilfe: nur beim Ausrichten, nicht über der Vorschau. */}
            {mode === 'live' && !shot && (
              <>
                <span className={`${styles.corner} ${styles['corner--tl']}`} />
                <span className={`${styles.corner} ${styles['corner--tr']}`} />
                <span className={`${styles.corner} ${styles['corner--bl']}`} />
                <span className={`${styles.corner} ${styles['corner--br']}`} />
                <span className={styles.scanLine} />
              </>
            )}

            {mode === 'starting' && <span className={styles.placeholder}>Kamera startet…</span>}
            {shot && <img src={shot.url} alt="Aufgenommener Bon" className={styles.shot} />}
          </div>
        )}

        {busy && <div className={styles.busy}>Bild wird aufbereitet…</div>}
      </div>

      {shot ? (
        <>
          <p className={styles.hint}>
            Ist der Bon vollständig und scharf? Unscharfe Bilder werden nicht besser erkannt.
          </p>
          <div className={styles.decision}>
            <button type="button" className={styles.secondary} onClick={retake}>
              Neu aufnehmen
            </button>
            <button type="button" className={styles.primary} onClick={use}>
              Verwenden
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.hint}>{error ?? HINTS[mode]}</p>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.sideButton}
              onClick={() => galleryInputRef.current?.click()}
            >
              Galerie
            </button>
            <button
              type="button"
              className={styles.shutter}
              onClick={shutter}
              disabled={busy || mode === 'starting'}
              aria-label="Auslösen"
            />
            <div className={`${styles.sideButton} ${styles['sideButton--off']}`} aria-hidden="true">
              Blitz
            </div>
          </div>
        </>
      )}

      {/*
        Zwei Datei-Felder mit demselben Zweck, aber unterschiedlichem Verhalten:
        mit `capture` öffnet iOS direkt die Kamera, ohne `capture` die Galerie –
        für Bons, die schon vorher fotografiert wurden.
      */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.fileInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={pickFile}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className={styles.fileInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={pickFile}
      />
    </div>
  )
}
