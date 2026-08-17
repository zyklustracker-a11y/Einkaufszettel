/**
 * Bildvorverarbeitung für Bon-Fotos.
 *
 * ---------------------------------------------------------------------------
 * WARUM DIESE DATEI ÜBERHAUPT EXISTIERT
 * ---------------------------------------------------------------------------
 *
 * Bis Schritt 18 bestand die ganze Aufbereitung aus einem `drawImage` auf 2000
 * px lange Kante. Das klingt großzügig und ist es auf dem Papier auch — nur
 * greift die Zahl an der falschen Kante.
 *
 * Ein Bon wird fast immer **quer** fotografiert: Er ist lang und schmal, das
 * Telefon ist breit, und man dreht es. Die 2000 px liegen dann auf der
 * *waagerechten* Kante, also der Länge des Bons. Für seine Breite bleiben bei
 * einem 16:9-Foto rund 1100 px, und davon füllt der Bon vielleicht die Hälfte.
 * Eine gedruckte Textzeile ist danach **fünf bis sieben Pixel hoch**. Das ist
 * die Grenze des Lesbaren, und genau dort fängt ein Modell an zu raten, Zeilen
 * zu verschmelzen oder sich zu wiederholen, bis das Token-Budget alle ist.
 *
 * Die Auflösung war also nie das Problem — die *Ausrichtung* war es. Deshalb
 * steht hier in dieser Reihenfolge:
 *
 *   1. **Textfläche finden.** Nicht die hellste Fläche, sondern die mit den
 *      meisten Kanten: Ein zweites Blatt Papier neben dem Bon ist genauso weiß,
 *      hat aber kaum Text. Über die Helligkeit wären beide dasselbe.
 *   2. **Drehen**, bis die Textzeilen waagerecht liegen und der Bon aufrecht
 *      steht. Erst danach bedeuten 2000 px lange Kante wirklich 2000 px Bonlänge.
 *   3. **Zuschneiden** auf die Textfläche plus Rand. Was übrig bleibt, ist Bon
 *      und nicht Gehweg.
 *   4. **Kontrast** anheben — mild, mit CLAHE. Nicht binarisieren.
 *   5. **Kacheln**, wenn der Bon selbst dann noch zu lang ist.
 *
 * ---------------------------------------------------------------------------
 * WAS HIER BEWUSST NICHT PASSIERT
 * ---------------------------------------------------------------------------
 *
 * **Keine Perspektivkorrektur.** Sie stand auf der Liste und fehlt trotzdem,
 * und der Grund ist nicht Faulheit: Der schwierige Teil ist nicht das Verzerren
 * — der Resampler unten könnte das —, sondern das **Finden der vier Ecken**.
 * Ohne die Konturmaschinerie von OpenCV ist eine Eckenschätzung auf einem
 * zerknitterten Thermobon vor grauem Beton unzuverlässig, und eine falsch
 * geschätzte Homographie macht aus einem lesbaren Bon einen unlesbaren. Eine
 * Drehung kann höchstens leicht danebenliegen; eine Homographie kann das Bild
 * zerstören. Solange die Ecken nicht sicher zu finden sind, ist die Drehung der
 * bessere Tausch.
 *
 * **Kein hartes Binarisieren.** Thermodruck ist grau, nicht schwarz, und seine
 * Striche sind dünn. Jede feste Schwelle löscht die dünnsten davon — meist
 * Kommas und Ziffern, also genau das, worauf es ankommt.
 *
 * ---------------------------------------------------------------------------
 * FORM DER DATEI
 * ---------------------------------------------------------------------------
 *
 * Alles hier sind **reine Funktionen über Zahlenfeldern**, ohne Canvas, ohne
 * DOM. Das ist der Grund, warum sie nebenan getestet werden können: Ein Schritt,
 * der nur im Browser läuft, wird nie geprüft, und Bildverarbeitung ohne Prüfung
 * ist Raten mit Zwischenschritten. Das Canvas-Handwerk steht in `camera.ts`.
 */

/* ============================================================== Die Formen */

/** Ein Bild als RGBA, wie `ImageData` es liefert. */
export interface Bitmap {
  width: number
  height: number
  /** Vier Bytes je Pixel: R, G, B, A. */
  data: Uint8ClampedArray
}

/** Ein Graustufenbild — ein Byte je Pixel. */
export interface GrayMap {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Welche Schritte laufen sollen.
 *
 * **Jeder einzeln abschaltbar, und das ist keine Spielerei.** Bildverarbeitung
 * ist eine Kette, in der jeder Schritt den nächsten verschlechtern kann. Wenn
 * ein Bon plötzlich schlechter gelesen wird, ist die einzige brauchbare Frage:
 * *welcher* Schritt war es? Ohne einzelne Schalter lässt sich das nur durch
 * Auskommentieren beantworten — und dann vergisst es jemand wieder
 * einzukommentieren.
 */
export interface PreprocessFlags {
  /** Den Bon aufrecht drehen. */
  autoRotate: boolean
  /** Auf die Textfläche zuschneiden. */
  autoCrop: boolean
  /** Graustufen und mildes CLAHE. */
  contrast: boolean
  /** Sehr lange Bons in überlappende Kacheln schneiden. */
  tiling: boolean
}

export const DEFAULT_FLAGS: PreprocessFlags = {
  autoRotate: true,
  autoCrop: true,
  contrast: true,
  tiling: true,
}

/** Alles aus — das Verhalten von vor Schritt 18, für den A/B-Vergleich. */
export const NO_FLAGS: PreprocessFlags = {
  autoRotate: false,
  autoCrop: false,
  contrast: false,
  tiling: false,
}

/* ========================================================== Graustufen */

/**
 * RGB zu Helligkeit, nach der üblichen Gewichtung.
 *
 * Nicht der schlichte Mittelwert: Das Auge — und jede Kamera — ist für Grün am
 * empfindlichsten. Auf einem Bon fällt das kaum auf, weil er grau auf weiß ist;
 * bei einem Foto mit Farbstich schon.
 */
export function toGray(bitmap: Bitmap): GrayMap {
  const { width, height, data } = bitmap
  const out = new Uint8ClampedArray(width * height)

  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }

  return { width, height, data: out }
}

/** Graustufen zurück nach RGBA — für den Weg auf das Canvas. */
export function grayToBitmap(gray: GrayMap): Bitmap {
  const data = new Uint8ClampedArray(gray.width * gray.height * 4)

  for (let p = 0, i = 0; p < gray.data.length; p++, i += 4) {
    data[i] = gray.data[p]
    data[i + 1] = gray.data[p]
    data[i + 2] = gray.data[p]
    data[i + 3] = 255
  }

  return { width: gray.width, height: gray.height, data }
}

/* ====================================================== Wo steht der Bon? */

/**
 * Wie viel „Text" an jeder Stelle ist.
 *
 * ---------------------------------------------------------------------------
 * DER TRICK, UM DEN ES GEHT
 * ---------------------------------------------------------------------------
 *
 * Die naheliegende Suche wäre „größte helle Fläche". Sie geht auf genau dem
 * Foto schief, das der Nutzer geschickt hat: Der Bon liegt dort **auf einem
 * zweiten, größeren Blatt Papier**. Beide sind weiß, beide hängen zusammen —
 * über die Helligkeit sind sie ein einziger Fleck, und der größere gewinnt.
 *
 * Was den Bon vom Nebendokument unterscheidet, ist nicht seine Farbe, sondern
 * seine **Textdichte**: dicht gedruckte Zeilen auf ganzer Länge. Ein
 * Formularblatt daneben ist überwiegend leer.
 *
 * Gemessen wird das als Kantenstärke (Betrag des Helligkeitsgradienten),
 * anschließend über ein Fenster geglättet. Ein einzelner Buchstabe ist danach
 * kein Ausschlag mehr, ein Absatz schon.
 */
export function textEnergy(gray: GrayMap, blurRadius = 6): GrayMap {
  const { width, height, data } = gray
  const edges = new Uint8ClampedArray(width * height)

  /*
   * Vorwärtsdifferenz statt Sobel. Ein Sobel-Kern wäre rauschärmer, kostet aber
   * das Neunfache an Rechenzeit — und geglättet wird gleich ohnehin. Auf einem
   * Telefon zählt das: Die Vorverarbeitung läuft vor dem Fortschrittsbalken.
   */
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const p = y * width + x
      const dx = Math.abs(data[p + 1] - data[p])
      const dy = Math.abs(data[p + width] - data[p])
      edges[p] = Math.min(255, dx + dy)
    }
  }

  return boxBlur({ width, height, data: edges }, blurRadius)
}

/**
 * Kastenweichzeichner, getrennt nach den beiden Achsen.
 *
 * Zwei Durchgänge über je eine Achse statt eines über das ganze Fenster: Das
 * Ergebnis ist dasselbe, der Aufwand wächst aber mit dem Radius statt mit
 * seinem Quadrat. Bei Radius 6 ist das der Faktor 6.
 */
export function boxBlur(gray: GrayMap, radius: number): GrayMap {
  if (radius < 1) return gray

  const { width, height } = gray
  const pass1 = new Uint8ClampedArray(width * height)
  const pass2 = new Uint8ClampedArray(width * height)

  // Waagerecht.
  for (let y = 0; y < height; y++) {
    let sum = 0
    let count = 0
    const row = y * width

    for (let x = -radius; x < width; x++) {
      if (x + radius < width) {
        sum += gray.data[row + x + radius]
        count++
      }
      if (x - radius - 1 >= 0) {
        sum -= gray.data[row + x - radius - 1]
        count--
      }
      if (x >= 0) pass1[row + x] = sum / count
    }
  }

  // Senkrecht.
  for (let x = 0; x < width; x++) {
    let sum = 0
    let count = 0

    for (let y = -radius; y < height; y++) {
      if (y + radius < height) {
        sum += pass1[(y + radius) * width + x]
        count++
      }
      if (y - radius - 1 >= 0) {
        sum -= pass1[(y - radius - 1) * width + x]
        count--
      }
      if (y >= 0) pass2[y * width + x] = sum / count
    }
  }

  return { width, height, data: pass2 }
}

/**
 * Die Schwelle zwischen „Text" und „Hintergrund", nach Otsu.
 *
 * Otsu sucht die Schwelle, die die beiden entstehenden Gruppen am deutlichsten
 * trennt. Der Vorteil gegenüber einer festen Zahl: Sie passt sich an. Ein Foto
 * im Schatten und eins in der Sonne haben völlig verschiedene Kantenstärken,
 * und eine feste Schwelle wäre bei einem der beiden immer falsch.
 */
export function otsuThreshold(gray: GrayMap): number {
  const histogram = new Array(256).fill(0)
  for (const value of gray.data) histogram[value]++

  const total = gray.data.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]

  let sumBackground = 0
  let weightBackground = 0
  let best = 0
  let bestVariance = -1

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue

    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const between =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2

    if (between > bestVariance) {
      bestVariance = between
      best = t
    }
  }

  return best
}

/** Ein zusammenhängender Bereich der Maske, samt allem, was daraus folgt. */
export interface Blob {
  /** Wie viele Pixel dazugehören. */
  size: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Schwerpunkt. */
  centerX: number
  centerY: number
  /**
   * Die Richtung der langen Achse, in Radiant.
   *
   * 0 heißt waagerecht. Gemessen aus den zweiten Momenten — das ist dasselbe,
   * was `minAreaRect` bei einer länglichen Fläche liefert, nur ohne
   * Konturverfolgung: Bei einem Textblock zeigt die lange Achse entlang der
   * Zeilen.
   */
  angle: number
}

/**
 * Der größte zusammenhängende Bereich einer Maske.
 *
 * Iterativ mit eigenem Stapel und **nicht** rekursiv: Eine Textfläche auf einem
 * 12-Megapixel-Foto hat Millionen Pixel, und eine Rekursion darüber sprengt den
 * Aufrufstapel zuverlässig — auf dem Telefon des Nutzers, nicht hier.
 */
export function largestBlob(mask: Uint8Array, width: number, height: number): Blob | null {
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  let best: Blob | null = null

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue

    seen[start] = 1
    stack.push(start)

    let size = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    // Für Schwerpunkt und zweite Momente. Als Summen mitgeführt, damit die
    // Fläche nur einmal durchlaufen werden muss.
    let sumX = 0
    let sumY = 0
    let sumXX = 0
    let sumYY = 0
    let sumXY = 0

    while (stack.length > 0) {
      const p = stack.pop() as number
      const x = p % width
      const y = (p - x) / width

      size++
      sumX += x
      sumY += y
      sumXX += x * x
      sumYY += y * y
      sumXY += x * y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      // Vierer-Nachbarschaft. Acht wäre durchlässiger und würde auf einem
      // verrauschten Foto zwei getrennte Blöcke über eine Pixelbrücke
      // zusammenziehen.
      if (x > 0 && mask[p - 1] === 1 && seen[p - 1] === 0) {
        seen[p - 1] = 1
        stack.push(p - 1)
      }
      if (x + 1 < width && mask[p + 1] === 1 && seen[p + 1] === 0) {
        seen[p + 1] = 1
        stack.push(p + 1)
      }
      if (y > 0 && mask[p - width] === 1 && seen[p - width] === 0) {
        seen[p - width] = 1
        stack.push(p - width)
      }
      if (y + 1 < height && mask[p + width] === 1 && seen[p + width] === 0) {
        seen[p + width] = 1
        stack.push(p + width)
      }
    }

    if (best !== null && size <= best.size) continue

    const centerX = sumX / size
    const centerY = sumY / size
    /*
     * Die zweiten Zentralmomente. Daraus die Hauptachse:
     *
     *     angle = ½ · atan2(2·µxy, µxx − µyy)
     *
     * Das ist die Richtung, in der die Fläche am weitesten ausgedehnt ist — bei
     * einem Bon also entlang seiner Länge.
     */
    const varX = sumXX / size - centerX * centerX
    const varY = sumYY / size - centerY * centerY
    const covXY = sumXY / size - centerX * centerY

    best = {
      size,
      minX,
      minY,
      maxX,
      maxY,
      centerX,
      centerY,
      angle: 0.5 * Math.atan2(2 * covXY, varX - varY),
    }
  }

  return best
}

/**
 * Die Textfläche eines Bon-Fotos finden.
 *
 * Zurück kommt null, wenn nichts Brauchbares gefunden wurde — etwa bei einem
 * Foto ohne Text. Dann bleibt das Bild unverändert: Ein Zuschnitt auf Verdacht
 * wäre schlimmer als keiner.
 */
export function findReceipt(gray: GrayMap, blurRadius = 6): Blob | null {
  const energy = textEnergy(gray, blurRadius)
  const energyThreshold = otsuThreshold(energy)

  /*
   * ---------------------------------------------------------------------------
   * ZWEI MERKMALE STATT EINEM (nachgeschärft nach dem ersten echten Test)
   * ---------------------------------------------------------------------------
   *
   * Die erste Fassung suchte allein nach Kantendichte. Auf dem ersten echten
   * Foto ist sie damit voll auf den **Gehweg** hereingefallen: Asphalt ist über
   * das ganze Bild hinweg feinkörnig strukturiert und liefert damit fast überall
   * hohe Kantenenergie. Der gefundene „Bon" war der halbe Beton, und der Bon
   * stand danach schief im Bild.
   *
   * Kantendichte allein reicht also nicht. Was einen Bon zusätzlich auszeichnet:
   * Er ist **hell**. Papier ist weiß, Asphalt ist grau.
   *
   * Beide Merkmale zusammen decken beide echten Fehlerfälle ab, und zwar jedes
   * für sich einen:
   *
   *   * **Gehweg** — strukturiert, aber dunkel. Fällt über die Helligkeit weg.
   *   * **Zweites Dokument** daneben — hell, aber kaum bedruckt. Fällt über die
   *     Kantendichte weg.
   *
   * Gemessen wird die *örtlich gemittelte* Helligkeit, nicht die des einzelnen
   * Pixels: Ein Buchstabe ist schwarz, das Papier darum herum nicht. Über das
   * geglättete Bild ist eine bedruckte Papierfläche trotzdem hell.
   */
  const brightness = boxBlur(gray, blurRadius)
  const brightThreshold = otsuThreshold(brightness)

  const both = new Uint8Array(energy.data.length)
  const energyOnly = new Uint8Array(energy.data.length)
  for (let i = 0; i < both.length; i++) {
    const hasEdges = energy.data[i] > energyThreshold
    energyOnly[i] = hasEdges ? 1 : 0
    both[i] = hasEdges && brightness.data[i] > brightThreshold ? 1 : 0
  }

  const minimum = gray.width * gray.height * 0.01
  const blob = largestBlob(both, gray.width, gray.height)

  /*
   * Eine Fläche unter einem Prozent des Bildes ist kein Bon, sondern ein
   * Grashalm, eine Münze oder ein Fleck auf dem Beton. Darauf zuzuschneiden
   * würde den Bon vollständig verwerfen.
   */
  if (blob !== null && blob.size >= minimum) return blob

  /*
   * Rückfall auf die Kantendichte allein. Nötig für den Bon, der das ganze Bild
   * ausfüllt: Dann gibt es keinen dunklen Hintergrund, gegen den sich das Papier
   * abheben könnte, und die Helligkeitsschwelle trennt stattdessen Text von
   * Papier — womit sie das halbe Papier verwirft.
   */
  const fallback = largestBlob(energyOnly, gray.width, gray.height)
  if (fallback === null || fallback.size < minimum) return null
  return fallback
}

/* ------------------------------------------- Der Rahmen nach dem Drehen */

/** Ein achsenparalleles Rechteck, wie `Blob` es aufspannt. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Wo der gefundene Rahmen nach dem Drehen liegt.
 *
 * ---------------------------------------------------------------------------
 * WARUM GERECHNET UND NICHT NEU GESUCHT
 * ---------------------------------------------------------------------------
 *
 * Die erste Fassung hat nach dem Drehen einfach noch einmal `findReceipt`
 * aufgerufen. Das ging auf dem ersten echten Foto gründlich schief, und der
 * Grund ist bitter: **Das Drehen erzeugt selbst die stärkste Kante im Bild.**
 * Die freien Ecken werden weiß gefüllt, und die Grenze zwischen dieser weißen
 * Füllung und dem Foto ist eine kerzengerade, bildlange, maximal kontrastreiche
 * Diagonale. Sie ist zusammenhängend, sie umläuft das ganze Foto, und sie
 * gewinnt jeden Vergleich um die größte Fläche. Der Rahmen war danach das ganze
 * Bild — also wurde gar nicht zugeschnitten.
 *
 * Neu zu suchen war ohnehin unnötig: Wo der Bon liegt, ist bereits bekannt, und
 * um wie viel gedreht wurde, auch. Die vier Ecken des Rahmens durch dieselbe
 * Drehung zu schicken ist exakt, kostet nichts und kann gar nicht auf eine
 * Kante hereinfallen, die es vorher nicht gab.
 */
export function rotatedBounds(
  bounds: Bounds,
  /** Faktor von der Analysegröße auf die Arbeitsgröße. */
  scale: number,
  source: { width: number; height: number },
  out: { width: number; height: number },
  angle: number,
): Bounds {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const sourceCenterX = source.width / 2
  const sourceCenterY = source.height / 2
  const outCenterX = out.width / 2
  const outCenterY = out.height / 2

  const corners: Array<[number, number]> = [
    [bounds.minX * scale, bounds.minY * scale],
    [bounds.maxX * scale, bounds.minY * scale],
    [bounds.minX * scale, bounds.maxY * scale],
    [bounds.maxX * scale, bounds.maxY * scale],
  ]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const [sx, sy] of corners) {
    const ux = sx - sourceCenterX
    const uy = sy - sourceCenterY
    /*
     * Die Umkehrung der Abbildung in `rotateBitmap`. Dort wird rückwärts
     * abgetastet (Ziel → Quelle); hier wird vorwärts gerechnet (Quelle → Ziel),
     * also mit der transponierten Drehmatrix.
     */
    const x = cos * ux - sin * uy + outCenterX
    const y = sin * ux + cos * uy + outCenterY

    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return {
    minX: Math.max(0, Math.round(minX)),
    minY: Math.max(0, Math.round(minY)),
    maxX: Math.min(out.width - 1, Math.round(maxX)),
    maxY: Math.min(out.height - 1, Math.round(maxY)),
  }
}

/* ================================================================== Drehen */

/**
 * Um welchen Winkel muss gedreht werden, damit der Bon aufrecht steht?
 *
 * Zwei Dinge zugleich, und sie hängen zusammen:
 *
 *   1. Die Textzeilen sollen **waagerecht** liegen. Der Winkel der langen Achse
 *      des Textblocks sagt, wie schief sie gerade sind.
 *   2. Der Bon soll **hochkant** stehen. Er ist lang und schmal; liegt er quer,
 *      kommt nach dem Verkleinern zu wenig Höhe an (siehe Dateikopf).
 *
 * Der zweite Punkt ist der, der die 2000 px erst wirksam macht. Ein quer
 * liegender Bon wird deshalb um zusätzliche 90° gedreht.
 */
export function rotationFor(blob: Blob): number {
  /*
   * Die lange Achse des Textblocks soll **senkrecht** stehen.
   *
   * Das ist die ganze Rechnung, und sie ersetzt eine erste Fassung, die zwei
   * Dinge vermischt hat: „Textzeilen geradeziehen" und „Bon aufrichten" wurden
   * dort getrennt behandelt und addiert — mit dem Ergebnis, dass ein bereits
   * aufrechter Bon um 90° gekippt wurde. Der Test daneben hat es gefunden.
   *
   * Der Denkfehler dahinter: Die Hauptachse eines zusammenhängenden Textblocks
   * zeigt entlang des **Bons**, nicht entlang seiner Textzeilen. Bei einem
   * aufrecht stehenden Bon ist sie senkrecht — und genau dann ist nichts zu
   * tun. Es gibt also nur eine Aufgabe, nicht zwei.
   */
  let rotation = Math.PI / 2 - blob.angle

  /*
   * Eine Achse hat keine Richtung: „nach oben" und „nach unten" sind dieselbe
   * Achse. Ohne diese Normierung würde ein Bon, dessen Achse als −90° statt als
   * +90° gemessen wird, um volle 180° gedreht — er stünde dann auf dem Kopf,
   * obwohl er schon richtig lag.
   *
   * Der Rest in (−90°, +90°] ist immer der kürzeste Weg zum selben Ziel.
   */
  while (rotation > Math.PI / 2) rotation -= Math.PI
  while (rotation <= -Math.PI / 2) rotation += Math.PI

  return rotation
}

/**
 * Das Bild drehen, mit bilinearer Abtastung.
 *
 * **Rückwärts abgetastet**, also für jedes Zielpixel die Quelle gesucht statt
 * umgekehrt. Vorwärts entstünden Löcher: Zwei Quellpixel können auf dasselbe
 * Ziel fallen und ein drittes Ziel leer lassen. Bei Text sieht man das sofort —
 * dünne Striche bekommen Lücken, und genau die dünnen Striche sind bei
 * Thermodruck die Ziffern.
 *
 * Die Zielgröße wächst so, dass nichts abgeschnitten wird. Was dabei an den
 * Ecken frei bleibt, wird weiß: Ein Bon liegt auf hellem Grund, und Schwarz
 * würde den Kontrastausgleich später in die Irre führen.
 */
export function rotateBitmap(bitmap: Bitmap, angle: number): Bitmap {
  if (Math.abs(angle) < 1e-6) return bitmap

  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const { width, height, data } = bitmap

  const outWidth = Math.max(1, Math.round(Math.abs(width * cos) + Math.abs(height * sin)))
  const outHeight = Math.max(1, Math.round(Math.abs(width * sin) + Math.abs(height * cos)))
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)

  const centerX = width / 2
  const centerY = height / 2
  const outCenterX = outWidth / 2
  const outCenterY = outHeight / 2

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const dx = x - outCenterX
      const dy = y - outCenterY
      // Rückwärts: die Drehung um −angle auf das Zielpixel anwenden.
      const sourceX = cos * dx + sin * dy + centerX
      const sourceY = -sin * dx + cos * dy + centerY
      const target = (y * outWidth + x) * 4

      if (sourceX < 0 || sourceY < 0 || sourceX >= width - 1 || sourceY >= height - 1) {
        out[target] = 255
        out[target + 1] = 255
        out[target + 2] = 255
        out[target + 3] = 255
        continue
      }

      const x0 = Math.floor(sourceX)
      const y0 = Math.floor(sourceY)
      const fx = sourceX - x0
      const fy = sourceY - y0

      const p00 = (y0 * width + x0) * 4
      const p10 = p00 + 4
      const p01 = p00 + width * 4
      const p11 = p01 + 4

      for (let channel = 0; channel < 3; channel++) {
        const top = data[p00 + channel] * (1 - fx) + data[p10 + channel] * fx
        const bottom = data[p01 + channel] * (1 - fx) + data[p11 + channel] * fx
        out[target + channel] = top * (1 - fy) + bottom * fy
      }
      out[target + 3] = 255
    }
  }

  return { width: outWidth, height: outHeight, data: out }
}

/* =============================================================== Zuschnitt */

/**
 * Einen Ausschnitt herausschneiden, an den Bildrändern abgeschnitten.
 *
 * Ein Ausschnitt, der über den Rand hinausragt, wird gekürzt statt abgelehnt —
 * die Ränder unten kommen aus einer Schätzung, und eine Schätzung darf über den
 * Rand zeigen, ohne dass deshalb der ganze Zuschnitt entfällt.
 */
export function crop(
  bitmap: Bitmap,
  x: number,
  y: number,
  width: number,
  height: number,
): Bitmap {
  const left = Math.max(0, Math.min(bitmap.width - 1, Math.round(x)))
  const top = Math.max(0, Math.min(bitmap.height - 1, Math.round(y)))
  const right = Math.max(left + 1, Math.min(bitmap.width, Math.round(x + width)))
  const bottom = Math.max(top + 1, Math.min(bitmap.height, Math.round(y + height)))

  const outWidth = right - left
  const outHeight = bottom - top
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)

  for (let row = 0; row < outHeight; row++) {
    const source = ((top + row) * bitmap.width + left) * 4
    out.set(bitmap.data.subarray(source, source + outWidth * 4), row * outWidth * 4)
  }

  return { width: outWidth, height: outHeight, data: out }
}

/**
 * Wie viel Rand um die gefundene Textfläche stehen bleibt, als Anteil ihrer
 * Breite.
 *
 * Nicht null: Die Textfläche endet am Text, nicht am Papier. Ein Zuschnitt
 * genau auf sie würde die erste und letzte Zeile am Rand anschneiden, und
 * angeschnittene Zeilen liest kein Modell.
 */
const CROP_MARGIN = 0.06

/** Den Bon aus dem Bild schneiden — Textfläche plus Rand. */
export function cropToReceipt(bitmap: Bitmap, bounds: Bounds): Bitmap {
  const width = bounds.maxX - bounds.minX + 1
  const height = bounds.maxY - bounds.minY + 1
  const margin = Math.round(Math.max(width, height * 0.15) * CROP_MARGIN)

  return crop(
    bitmap,
    bounds.minX - margin,
    bounds.minY - margin,
    width + margin * 2,
    height + margin * 2,
  )
}

/* ================================================================== CLAHE */

/**
 * Kontrastausgleich mit Begrenzung — CLAHE.
 *
 * ---------------------------------------------------------------------------
 * WARUM NICHT EINFACH DEN KONTRAST HOCHDREHEN
 * ---------------------------------------------------------------------------
 *
 * Ein Bon-Foto ist selten gleichmäßig ausgeleuchtet: Oben Sonne, unten der
 * Schatten der eigenen Hand, quer darüber eine Falte. Eine globale
 * Kontrastanhebung richtet sich nach dem Gesamtbild und macht damit den
 * hellen Teil weiß und den dunklen schwarz — die Zeilen im Schatten
 * verschwinden.
 *
 * CLAHE rechnet stattdessen **je Kachel** und gleicht zwischen den Kacheln
 * weich ab. Jeder Bereich bekommt den Kontrast, den er braucht.
 *
 * Die **Begrenzung** (das C in CLAHE) ist der Teil, ohne den es schadet: Eine
 * gleichmäßig weiße Kachel — Papierrand ohne Text — hat fast keine
 * Helligkeitsunterschiede, und ein ungebremster Ausgleich würde ihr Rauschen
 * auf den vollen Bereich spreizen. Aus einem leeren Rand würde Zeichensalat.
 * Die Kappung verhindert genau das.
 *
 * `clipLimit` 2 ist mild und Absicht: Thermodruck ist grau, nicht schwarz, und
 * seine Striche sind dünn. Es geht darum, sie **lesbar** zu machen, nicht
 * darum, ein Schwarzweißbild zu erzeugen — beim harten Binarisieren brechen
 * genau diese Striche weg.
 */
export function clahe(gray: GrayMap, tiles = 8, clipLimit = 2): GrayMap {
  const { width, height, data } = gray
  const tileWidth = Math.max(1, Math.ceil(width / tiles))
  const tileHeight = Math.max(1, Math.ceil(height / tiles))
  const tilesX = Math.ceil(width / tileWidth)
  const tilesY = Math.ceil(height / tileHeight)

  /** Für jede Kachel die fertige Zuordnung „alter Wert → neuer Wert". */
  const maps: Uint8ClampedArray[] = []

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileWidth
      const y0 = ty * tileHeight
      const x1 = Math.min(width, x0 + tileWidth)
      const y1 = Math.min(height, y0 + tileHeight)

      const histogram = new Array(256).fill(0)
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          histogram[data[y * width + x]]++
          count++
        }
      }

      /*
       * Kappen und gleichmäßig umverteilen. Das Abgeschnittene verschwindet
       * nicht, es wird auf alle Helligkeitsstufen verteilt — sonst würde die
       * Gesamtzahl der Pixel nicht mehr stimmen und die Zuordnung wäre keine
       * Verteilungsfunktion mehr.
       */
      const limit = Math.max(1, Math.floor((clipLimit * count) / 256))
      let excess = 0
      for (let i = 0; i < 256; i++) {
        if (histogram[i] > limit) {
          excess += histogram[i] - limit
          histogram[i] = limit
        }
      }
      const share = Math.floor(excess / 256)
      for (let i = 0; i < 256; i++) histogram[i] += share

      const map = new Uint8ClampedArray(256)
      let running = 0
      const total = count || 1
      for (let i = 0; i < 256; i++) {
        running += histogram[i]
        map[i] = Math.min(255, Math.round((running / total) * 255))
      }
      maps.push(map)
    }
  }

  /*
   * Und jetzt weich zwischen den Kacheln überblenden. Ohne diesen Schritt
   * sieht man die Kachelgrenzen als Raster im Bild — jede Kachel hätte ihre
   * eigene Zuordnung und damit einen sichtbaren Sprung an der Kante.
   */
  const out = new Uint8ClampedArray(width * height)

  for (let y = 0; y < height; y++) {
    // Position zwischen den Kachelmitten.
    const fy = (y - tileHeight / 2) / tileHeight
    const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fy)))
    const ty1 = Math.max(0, Math.min(tilesY - 1, ty0 + 1))
    const wy = Math.max(0, Math.min(1, fy - ty0))

    for (let x = 0; x < width; x++) {
      const fx = (x - tileWidth / 2) / tileWidth
      const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(fx)))
      const tx1 = Math.max(0, Math.min(tilesX - 1, tx0 + 1))
      const wx = Math.max(0, Math.min(1, fx - tx0))

      const value = data[y * width + x]
      const top =
        maps[ty0 * tilesX + tx0][value] * (1 - wx) + maps[ty0 * tilesX + tx1][value] * wx
      const bottom =
        maps[ty1 * tilesX + tx0][value] * (1 - wx) + maps[ty1 * tilesX + tx1][value] * wx

      out[y * width + x] = top * (1 - wy) + bottom * wy
    }
  }

  return { width, height, data: out }
}

/* ================================================================= Kacheln */

/**
 * Ab welchem Seitenverhältnis ein Bon zerschnitten wird.
 *
 * Höher als 1:4 heißt: Selbst aufrecht und zugeschnitten bleibt er so lang,
 * dass 2000 px auf der Länge zu wenig Höhe je Zeile lassen.
 */
export const TILING_ASPECT = 4

/**
 * Wie stark sich zwei Kacheln überlappen.
 *
 * 15 % sind kein runder Zufallswert: Eine Zeile muss in mindestens einer Kachel
 * **vollständig** zu sehen sein. Ohne Überlappung liegt irgendwann eine Zeile
 * genau auf der Schnittkante und ist in beiden Kacheln nur halb da — dann fehlt
 * sie ganz, und ihr Betrag mit ihr. Der Preis ist, dass die überlappenden
 * Zeilen doppelt gelesen werden; dass sie zusammenzuführen sind, sagt der
 * Prompt (`STRUCTURE_TILED_USER_PROMPT`).
 */
export const TILE_OVERLAP = 0.15

/** Höchstens drei Kacheln — mehr Bilder machen den Aufruf teurer als er nützt. */
export const MAX_TILES = 3

export interface TileRange {
  y: number
  height: number
}

/**
 * Wie ein Bild der Höhe nach zu zerschneiden ist.
 *
 * Zurück kommt eine einzige Kachel über die volle Höhe, wenn nicht geschnitten
 * werden muss. Der Aufrufer braucht dann keine Sonderbehandlung — er bekommt
 * immer eine Liste.
 */
export function tileRanges(
  width: number,
  height: number,
  aspectLimit = TILING_ASPECT,
  overlap = TILE_OVERLAP,
  maxTiles = MAX_TILES,
): TileRange[] {
  const aspect = height / Math.max(1, width)
  if (aspect <= aspectLimit) return [{ y: 0, height }]

  /*
   * So viele Kacheln, dass jede höchstens das Grenzverhältnis hat — gedeckelt.
   * `ceil` und nicht `round`: Eine Kachel, die knapp zu lang ist, hat genau das
   * Problem wieder, das die Kachelung lösen soll.
   */
  const count = Math.min(maxTiles, Math.max(2, Math.ceil(aspect / aspectLimit)))

  /*
   * Die Rechnung dahinter: `count` Kacheln der Höhe `h`, die sich je um
   * `overlap · h` überlappen, decken zusammen
   *
   *     h · (count − (count − 1) · overlap)
   *
   * ab. Das soll die Gesamthöhe sein — nach `h` aufgelöst steht es unten.
   */
  const tileHeight = Math.ceil(height / (count - (count - 1) * overlap))
  const step = Math.ceil(tileHeight * (1 - overlap))

  const ranges: TileRange[] = []
  for (let i = 0; i < count; i++) {
    // Die letzte Kachel wird nach oben gezogen statt über den Rand zu ragen:
    // Sonst hätte sie einen leeren Streifen, und der letzte Betrag des Bons
    // stünde am äußersten Rand.
    const y = i === count - 1 ? Math.max(0, height - tileHeight) : i * step
    ranges.push({ y, height: Math.min(tileHeight, height - y) })
  }

  return ranges
}

/* ============================================================ Verkleinern */

/**
 * Zielgröße unter Beibehaltung des Seitenverhältnisses.
 *
 * Kleinere Bilder bleiben unangetastet: Hochrechnen bringt keine Schärfe,
 * kostet aber Dateigröße.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge) return { width, height }

  const factor = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}
