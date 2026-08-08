/**
 * Aufnahme und Aufbereitung eines Bon-Fotos.
 *
 * Hier steht alles, was mit Pixeln zu tun hat – der Screen selbst kümmert sich
 * nur um Kamerastrom, Bedienung und Zustand. Ergebnis ist immer dasselbe:
 * ein JPEG mit bekannter Größe, egal ob es aus dem Livebild, aus der
 * iOS-Kamera oder aus der Galerie kommt.
 */

/**
 * Lange Kante des fertigen Bildes in Pixeln.
 *
 * Bons sind schmal und lang. Deshalb wird ausschließlich proportional
 * verkleinert und **nichts zugeschnitten** – ein quadratischer Zuschnitt würde
 * den unteren Teil des Bons abschneiden.
 */
export const MAX_EDGE = 2000

/** JPEG-Qualität. 0,8 ist der Kompromiss aus Lesbarkeit und Dateigröße. */
export const JPEG_QUALITY = 0.8

/** Ein fertig aufbereitetes Bon-Foto. */
export interface CapturedImage {
  blob: Blob
  width: number
  height: number
}

/**
 * Zielgröße unter Beibehaltung des Seitenverhältnisses.
 *
 * Kleinere Bilder bleiben unangetastet: Hochrechnen bringt keine Schärfe,
 * kostet aber Dateigröße.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge) return { width, height }

  const factor = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}

/** `canvas.toBlob` als Promise – der Rückruf liefert im Fehlerfall `null`. */
function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG konnte nicht erzeugt werden.'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Zeichnet eine Bildquelle verkleinert auf ein Canvas und gibt ein JPEG zurück.
 *
 * Die Quellgröße wird bewusst übergeben statt geraten: ein `<video>` kennt sie
 * als `videoWidth/videoHeight`, ein `<img>` als `naturalWidth/naturalHeight`.
 */
async function drawToJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<CapturedImage> {
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Das Bild hat keine lesbare Größe.')
  }

  const size = fitWithin(sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Der Browser stellt keine Zeichenfläche bereit.')

  context.drawImage(source, 0, 0, size.width, size.height)
  return { blob: await toJpeg(canvas), width: size.width, height: size.height }
}

/** Ein Einzelbild aus dem laufenden Kamerastrom. */
export function captureFrame(video: HTMLVideoElement): Promise<CapturedImage> {
  return drawToJpeg(video, video.videoWidth, video.videoHeight)
}

/**
 * Lädt eine Bilddatei in ein `<img>`.
 *
 * **Warum der Umweg über `<img>` und nicht über die Rohdaten:** iPhone-Fotos
 * stehen in der Datei fast immer quer und tragen die tatsächliche Ausrichtung
 * nur als EXIF-Feld. Ein `<img>` dreht das Bild von sich aus richtig herum
 * (`image-orientation: from-image` ist seit Safari 13.4 die Voreinstellung),
 * und `naturalWidth/naturalHeight` melden bereits die gedrehten Maße. Wer die
 * Datei stattdessen selbst dekodiert, muss EXIF von Hand auswerten – dafür
 * bräuchte es eine zusätzliche Bibliothek.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'))
    image.src = url
  })
}

/** Ein Foto aus der iOS-Kamera oder aus der Galerie, fertig aufbereitet. */
export async function fileToJpeg(file: File): Promise<CapturedImage> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    return await drawToJpeg(image, image.naturalWidth, image.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}
