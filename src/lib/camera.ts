/**
 * Aufnahme und Aufbereitung eines Bon-Fotos.
 *
 * Hier steht das **Canvas-Handwerk**: Bildquelle auf eine Zeichenfläche,
 * Pixeldaten heraus, Pixeldaten zurück, JPEG erzeugen. Was mit den Pixeln
 * dazwischen geschieht — drehen, zuschneiden, Kontrast, kacheln — steht in
 * `preprocess.ts`, weil es sich dort ohne Browser testen lässt.
 *
 * Ergebnis ist immer dasselbe: ein oder mehrere JPEGs bekannter Größe, egal ob
 * das Bild aus dem Livebild, aus der iOS-Kamera oder aus der Galerie kommt.
 */

import {
  DEFAULT_FLAGS,
  clahe,
  cropToReceipt,
  crop as cropBitmap,
  findReceipt,
  fitWithin as fitWithinBox,
  grayToBitmap,
  rotateBitmap,
  rotatedBounds,
  rotationFor,
  tileRanges,
  toGray,
} from './preprocess.ts'
import type { Bitmap, PreprocessFlags } from './preprocess.ts'

/**
 * Lange Kante des fertigen Bildes in Pixeln.
 *
 * Bons sind schmal und lang. Deshalb wird ausschließlich proportional
 * verkleinert und **nichts** blind zugeschnitten – ein quadratischer Zuschnitt
 * würde den unteren Teil des Bons abschneiden. Der Zuschnitt auf die *gefundene
 * Textfläche* (siehe `preprocess.ts`) ist etwas anderes: Er nimmt nur weg, was
 * nachweislich kein Bon ist.
 */
export const MAX_EDGE = 2000

/**
 * Dieselbe Kante beim zweiten Versuch — dem Knopf „Genauer erkennen".
 *
 * **Ein Wiederholen-Knopf, der dieselbe Anfrage noch einmal schickt, ist ein
 * Knopf, der lügt.** Dasselbe Bild ergibt beim selben Modell mit Temperatur 0
 * fast dasselbe Ergebnis; der Nutzer wartet dann ein zweites Mal auf denselben
 * Fehler. Der zweite Versuch geht deshalb mit mehr Auflösung hinein — und, wenn
 * der Bon lang ist, mit Kacheln.
 *
 * 2600 und nicht 4000: Die Base64-Größe wächst quadratisch, und bei drei
 * Kacheln liefe der Aufruf sonst gegen die 8-MB-Grenze der Edge Function.
 */
export const MAX_EDGE_RETRY = 2600

/**
 * JPEG-Qualität.
 *
 * Von 0,8 auf 0,85 angehoben (Schritt 18). Der Unterschied klingt klein und ist
 * bei Thermodruck sichtbar: JPEG wirft zuerst hohe Frequenzen weg, und genau
 * daraus bestehen dünne graue Striche auf hellem Grund. Was 0,8 kostet, sind
 * Kommas und die Unterschiede zwischen 3, 8 und 9 — also alles, worauf es
 * ankommt. Der Aufschlag bei der Dateigröße liegt bei etwa einem Fünftel.
 */
export const JPEG_QUALITY = 0.85

/**
 * Obergrenze für die **Analyse**, nicht für das Ergebnis.
 *
 * Die Vorverarbeitung arbeitet auf einem Zahlenfeld mit vier Bytes je Pixel.
 * Ein 12-Megapixel-Foto wären knapp 50 MB, und mehrere Zwischenschritte davon
 * bringen ein älteres iPhone zum Absturz. Für das Finden des Bons genügt gut
 * ein Megapixel bei Weitem — gesucht wird eine Fläche, nicht ein Buchstabe.
 *
 * Das **Ergebnis** wird trotzdem aus der Originalquelle gezeichnet, nicht aus
 * dieser Verkleinerung: Zweimal verkleinern kostet Schärfe.
 */
const ANALYSIS_MAX_EDGE = 1400

/**
 * Obergrenze für die **Arbeitskopie**, auf der gedreht und zugeschnitten wird.
 *
 * Dieselbe Rechnung wie oben, nur ernster: Ein 12-Megapixel-Foto sind 48 MB als
 * Zahlenfeld, und `rotateBitmap` legt ein zweites gleicher Größe an. Zusammen
 * mit dem Kontrastausgleich stünden zeitweise weit über hundert Megabyte im
 * Speicher — auf einem älteren iPhone der sichere Absturz, und zwar mitten im
 * Scan, mit dem Bon in der Hand.
 *
 * 3000 px lange Kante sind knapp 7 Megapixel. Nach dem Zuschnitt auf den Bon
 * bleiben davon typischerweise 1500–2500 px auf seiner Länge — also genau die
 * Größenordnung, die am Ende ohnehin hinausgeht. Was hier verloren geht, hätte
 * das Verkleinern gleich danach ohnehin weggenommen.
 */
const WORK_MAX_EDGE = 3000

/** Ein fertig aufbereitetes Bon-Foto. */
export interface CapturedImage {
  /** Die erste (oder einzige) Kachel. */
  blob: Blob
  /**
   * Weitere Kacheln, von oben nach unten. Im Normalfall leer.
   *
   * Sie entstehen nur bei einem sehr langen Bon und gehen zusammen mit `blob`
   * in **einem** Aufruf an das Modell — sonst wüsste es nichts von der
   * Überlappung und zählte die doppelten Zeilen zweimal.
   */
  tiles: Blob[]
  width: number
  height: number
  /**
   * Die Maße der Quelle vor dem Verkleinern.
   *
   * Nur zur Kontrolle: Stimmen Quelle und Ergebnis überein, wurde nichts
   * verkleinert – dann liefert die Kamera bereits weniger als die lange Kante
   * zulässt.
   */
  sourceWidth: number
  sourceHeight: number
  /**
   * Das unbearbeitete Bild.
   *
   * **Der Grund, warum es aufgehoben wird:** Der zweite Versuch soll das Foto
   * anders aufbereiten, nicht dasselbe Ergebnis noch einmal schicken. Ohne die
   * Quelle bliebe nur, den Nutzer erneut fotografieren zu lassen — und der Bon
   * liegt vielleicht schon nicht mehr da.
   */
  sourceBlob: Blob
  /** Um wie viel gedreht wurde, in Grad. Für die Zeile unter dem Vorschaubild. */
  rotatedBy: number
  /** Welche Schritte gelaufen sind. */
  flags: PreprocessFlags
}

/** Was beim Aufbereiten eingestellt werden kann. */
export interface PrepareOptions {
  maxEdge?: number
  quality?: number
  flags?: Partial<PreprocessFlags>
}

/**
 * Zielgröße unter Beibehaltung des Seitenverhältnisses.
 *
 * Bleibt hier stehen und wird nicht nur durchgereicht, weil die Voreinstellung
 * `MAX_EDGE` dazugehört — und weil die Tests daneben an ihr hängen.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  return fitWithinBox(width, height, maxEdge)
}

/* ------------------------------------------------------- Canvas-Handwerk */

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Der Browser stellt keine Zeichenfläche bereit.')
  return context
}

/** Eine Bildquelle in gewünschter Größe auf ein Canvas zeichnen. */
function draw(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height)
  const context = contextOf(canvas)
  /*
   * Vier Argumente, nicht acht: Die Quelle geht vollständig in das Ziel, nur
   * kleiner. Die Zuschnitt-Variante von `drawImage` ist hier bewusst nicht im
   * Spiel – ein Bon darf an keiner Kante verlieren.
   */
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function toBitmap(canvas: HTMLCanvasElement): Bitmap {
  const image = contextOf(canvas).getImageData(0, 0, canvas.width, canvas.height)
  return { width: image.width, height: image.height, data: image.data }
}

function toCanvas(bitmap: Bitmap): HTMLCanvasElement {
  const canvas = makeCanvas(bitmap.width, bitmap.height)
  const context = contextOf(canvas)
  /*
   * Über `createImageData` und `set` statt über `new ImageData(...)`: Der
   * Konstruktor verlangt einen `Uint8ClampedArray` über einem echten
   * `ArrayBuffer`, und die Felder aus `preprocess.ts` sind absichtlich nicht
   * darauf festgelegt — sie sollen auch in den Tests ohne DOM entstehen können.
   */
  const image = context.createImageData(canvas.width, canvas.height)
  image.data.set(bitmap.data)
  context.putImageData(image, 0, 0)
  return canvas
}

/** `canvas.toBlob` als Promise – der Rückruf liefert im Fehlerfall `null`. */
function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG konnte nicht erzeugt werden.'))),
      'image/jpeg',
      quality,
    )
  })
}

/* --------------------------------------------------------- Die Aufbereitung */

/**
 * Aus einer Bildquelle wird ein fertiges Bon-Foto.
 *
 * Die Reihenfolge der Schritte ist nicht beliebig, sondern zwingend:
 *
 *   1. **Analysieren** auf einer kleinen Kopie — wo liegt der Bon, wie schief?
 *   2. **Drehen** auf der vollen Auflösung. Erst danach bedeuten 2000 px lange
 *      Kante wirklich 2000 px Bonlänge (siehe Kopf von `preprocess.ts`).
 *   3. **Neu suchen** auf dem gedrehten Bild. Der Rahmen von vorhin gilt nicht
 *      mehr — er beschrieb ein anderes Koordinatensystem.
 *   4. **Zuschneiden**, dann **Kontrast**, dann **kacheln**, dann verkleinern.
 *
 * Schlägt das Finden fehl, entfallen Schritt 2 bis 4 stillschweigend und das
 * Bild geht wie vor Schritt 18 hinaus. Ein Zuschnitt auf Verdacht wäre
 * schlimmer als keiner: Er kann den Bon halbieren.
 */
async function prepare(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  sourceBlob: Blob,
  options: PrepareOptions = {},
): Promise<CapturedImage> {
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Das Bild hat keine lesbare Größe.')
  }

  const flags: PreprocessFlags = { ...DEFAULT_FLAGS, ...options.flags }
  const maxEdge = options.maxEdge ?? MAX_EDGE
  const quality = options.quality ?? JPEG_QUALITY

  /*
   * 0. Der schnelle Weg: Ist alles abgeschaltet, wird die Quelle direkt in der
   *    Zielgröße gezeichnet — genau wie vor Schritt 18.
   *
   * Das ist nicht bloß eine Abkürzung, sondern der Grund, warum sich die
   * Schalter überhaupt zum A/B-Vergleich eignen: Mit `NO_FLAGS` läuft
   * buchstäblich der alte Code, ohne dass irgendwo ein Zahlenfeld über das
   * ganze Foto angelegt würde.
   */
  if (!flags.autoRotate && !flags.autoCrop && !flags.contrast && !flags.tiling) {
    const size = fitWithinBox(sourceWidth, sourceHeight, maxEdge)
    return {
      blob: await toJpeg(draw(source, size.width, size.height), quality),
      tiles: [],
      width: size.width,
      height: size.height,
      sourceWidth,
      sourceHeight,
      sourceBlob,
      rotatedBy: 0,
      flags,
    }
  }

  /* 1. Analysieren — auf einer kleinen Kopie, um Speicher zu sparen. */
  let region = null
  let rotation = 0

  const small = fitWithinBox(sourceWidth, sourceHeight, ANALYSIS_MAX_EDGE)
  if (flags.autoRotate || flags.autoCrop) {
    region = findReceipt(toGray(toBitmap(draw(source, small.width, small.height))))
    // Ausrichten am Textblock, zuschneiden am Papier — zwei verschiedene Dinge,
    // siehe `ReceiptRegion`.
    if (region && flags.autoRotate) rotation = rotationFor(region.text)
  }

  /*
   * 2. Die Arbeitskopie zeichnen und drehen.
   *
   * Gedeckelt auf `WORK_MAX_EDGE` — siehe dort. Ein Foto, das ohnehin kleiner
   * ist, wird dabei nicht angefasst.
   */
  const work = fitWithinBox(sourceWidth, sourceHeight, WORK_MAX_EDGE)
  const upright = { width: work.width, height: work.height }
  let bitmap = toBitmap(draw(source, work.width, work.height))
  if (rotation !== 0) bitmap = rotateBitmap(bitmap, rotation)

  /*
   * 3./4. Zuschneiden — auf den **mitgedrehten** Rahmen von vorhin.
   *
   * Hier stand ein zweites `findReceipt` auf dem gedrehten Bild, und das war
   * falsch: Das Drehen füllt die freien Ecken weiß, und diese Füllkante ist die
   * längste und kontrastreichste Linie im ganzen Bild. Sie hat jede Suche
   * gewonnen, der Rahmen war danach das gesamte Bild, und zugeschnitten wurde
   * gar nicht. Genau so sah das erste echte Ergebnis auch aus.
   *
   * Gerechnet statt gesucht: Wo der Bon liegt, ist bekannt, und um wie viel
   * gedreht wurde, auch.
   */
  if (flags.autoCrop && region) {
    bitmap = cropToReceipt(
      bitmap,
      rotatedBounds(region.paper, work.width / small.width, upright, bitmap, rotation),
    )
  }

  if (flags.contrast) {
    bitmap = grayToBitmap(clahe(toGray(bitmap)))
  }

  /* 5. Kacheln — oder die eine Kachel über die volle Höhe. */
  const ranges = flags.tiling
    ? tileRanges(bitmap.width, bitmap.height)
    : [{ y: 0, height: bitmap.height }]

  const blobs: Blob[] = []
  let firstWidth = 0
  let firstHeight = 0

  for (const range of ranges) {
    const piece =
      ranges.length === 1 ? bitmap : cropBitmap(bitmap, 0, range.y, bitmap.width, range.height)
    const size = fitWithinBox(piece.width, piece.height, maxEdge)
    const canvas = draw(toCanvas(piece), size.width, size.height)

    blobs.push(await toJpeg(canvas, quality))
    if (blobs.length === 1) {
      firstWidth = size.width
      firstHeight = size.height
    }
  }

  return {
    blob: blobs[0],
    tiles: blobs.slice(1),
    width: firstWidth,
    height: firstHeight,
    sourceWidth,
    sourceHeight,
    sourceBlob,
    rotatedBy: Math.round((rotation * 180) / Math.PI),
    flags,
  }
}

/* --------------------------------------------------------- Die Eingänge */

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

/** Ein Einzelbild aus dem laufenden Kamerastrom. */
export async function captureFrame(
  video: HTMLVideoElement,
  options?: PrepareOptions,
): Promise<CapturedImage> {
  /*
   * Der Rahmen wird zusätzlich unbearbeitet festgehalten. Er ist die Quelle für
   * den zweiten Versuch — ein Videobild ist weg, sobald der Strom weiterläuft,
   * und ohne ihn ließe sich „Genauer erkennen" nicht anders aufbereiten.
   */
  const full = draw(video, video.videoWidth, video.videoHeight)
  const original = await toJpeg(full, 0.95)

  return await prepare(full, video.videoWidth, video.videoHeight, original, options)
}

/** Ein Foto aus der iOS-Kamera oder aus der Galerie, fertig aufbereitet. */
export async function fileToJpeg(file: File, options?: PrepareOptions): Promise<CapturedImage> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    // Die Datei selbst ist die Quelle — unangetastet, samt EXIF.
    return await prepare(image, image.naturalWidth, image.naturalHeight, file, options)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Dasselbe Foto noch einmal aufbereiten — mit anderen Einstellungen.
 *
 * Das ist, was hinter „Genauer erkennen" steckt: mehr Auflösung, und bei einem
 * langen Bon Kacheln. Ohne diesen Weg wäre der Knopf eine Wiederholung
 * derselben Anfrage, und die liefert bei Temperatur 0 fast dasselbe Ergebnis.
 */
export async function reprocess(
  capture: CapturedImage,
  options: PrepareOptions,
): Promise<CapturedImage> {
  const url = URL.createObjectURL(capture.sourceBlob)
  try {
    const image = await loadImage(url)
    return await prepare(image, image.naturalWidth, image.naturalHeight, capture.sourceBlob, options)
  } finally {
    URL.revokeObjectURL(url)
  }
}
