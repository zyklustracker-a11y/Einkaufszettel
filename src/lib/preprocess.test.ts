import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boxBlur,
  clahe,
  crop,
  cropToReceipt,
  fitWithin,
  findReceipt,
  grayToBitmap,
  largestBlob,
  otsuThreshold,
  rotateBitmap,
  rotatedBounds,
  rotationFor,
  textEnergy,
  tileRanges,
  toGray,
} from './preprocess.ts'
import type { Bitmap } from './preprocess.ts'

/**
 * Tests für die Bildvorverarbeitung.
 *
 * Sie arbeiten auf **gebauten** Bildern und nicht auf echten Fotos: Ein Foto im
 * Repository wäre ein halbes Megabyte, das niemand mehr anfasst, und es würde
 * genau eine Situation abdecken. Ein gebautes Bild sagt dagegen, was geprüft
 * wird — „ein senkrechter Textblock links im Bild" ist eine Aussage, ein JPEG
 * ist keine.
 */

/* ------------------------------------------------------------- Werkzeuge */

/** Ein weißes Bild. */
function blank(width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { width, height, data }
}

/** Ein gefülltes Rechteck hineinmalen. */
function fill(bitmap: Bitmap, x0: number, y0: number, w: number, h: number, value: number) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) continue
      const p = (y * bitmap.width + x) * 4
      bitmap.data[p] = value
      bitmap.data[p + 1] = value
      bitmap.data[p + 2] = value
      bitmap.data[p + 3] = 255
    }
  }
}

/**
 * Ein „Bon": ein Block aus waagerechten dunklen Strichen — also Textzeilen.
 *
 * Genau so sieht ein Bon für die Kantenerkennung aus, und genau daran muss sich
 * seine Ausrichtung ablesen lassen.
 */
function receipt(
  bitmap: Bitmap,
  x: number,
  y: number,
  width: number,
  height: number,
  vertical = true,
) {
  const lineGap = 6
  if (vertical) {
    for (let row = y + 2; row < y + height - 2; row += lineGap) {
      fill(bitmap, x + 2, row, width - 4, 2, 40)
    }
  } else {
    // Quer liegender Bon: dieselben Zeilen, um 90° gedreht.
    for (let col = x + 2; col < x + width - 2; col += lineGap) {
      fill(bitmap, col, y + 2, 2, height - 4, 40)
    }
  }
}

/* ------------------------------------------------------------ Graustufen */

test('toGray und zurück', async (t) => {
  await t.test('Weiß bleibt weiß, Schwarz bleibt schwarz', () => {
    const bitmap = blank(4, 4)
    fill(bitmap, 0, 0, 2, 4, 0)
    const gray = toGray(bitmap)

    assert.equal(gray.data[0], 0)
    assert.equal(gray.data[3], 255)
    assert.equal(gray.width, 4)
    assert.equal(gray.data.length, 16)
  })

  await t.test('Grün wiegt schwerer als Blau', () => {
    // Nicht der schlichte Mittelwert: Sonst wären beide gleich hell.
    const green: Bitmap = { width: 1, height: 1, data: new Uint8ClampedArray([0, 255, 0, 255]) }
    const blue: Bitmap = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 255, 255]) }
    assert.ok(toGray(green).data[0] > toGray(blue).data[0])
  })

  await t.test('grayToBitmap macht daraus wieder RGBA', () => {
    const round = grayToBitmap(toGray(blank(3, 2)))
    assert.equal(round.width, 3)
    assert.equal(round.data.length, 3 * 2 * 4)
    assert.equal(round.data[3], 255)
  })
})

/* --------------------------------------------------------------- Weichzeichner */

test('boxBlur', async (t) => {
  await t.test('eine gleichmäßige Fläche bleibt gleich', () => {
    const gray = { width: 20, height: 20, data: new Uint8ClampedArray(400).fill(128) }
    const blurred = boxBlur(gray, 3)
    assert.ok(blurred.data.every((value) => value === 128))
  })

  await t.test('ein einzelner Punkt verteilt sich', () => {
    const data = new Uint8ClampedArray(400)
    data[10 * 20 + 10] = 255
    const blurred = boxBlur({ width: 20, height: 20, data }, 2)

    // In der Mitte weniger, daneben mehr als vorher.
    assert.ok(blurred.data[10 * 20 + 10] < 255)
    assert.ok(blurred.data[10 * 20 + 11] > 0)
  })

  await t.test('Radius 0 lässt alles unangetastet', () => {
    const gray = { width: 4, height: 4, data: new Uint8ClampedArray(16).fill(7) }
    assert.equal(boxBlur(gray, 0), gray)
  })
})

/* -------------------------------------------------------------- Schwelle */

test('otsuThreshold trennt zwei Gruppen', async (t) => {
  await t.test('die Schwelle teilt richtig auf', () => {
    /*
     * Geprüft wird, was die Schwelle **leistet**, nicht welche Zahl sie ist:
     * Bei zwei sauber getrennten Gruppen liegt jede Zahl von 20 bis 199 gleich
     * gut, und welche davon herauskommt, ist eine Frage der Implementierung —
     * kein Verhalten, das ein Test festnageln sollte.
     */
    const data = new Uint8ClampedArray(200)
    data.fill(20, 0, 100)
    data.fill(200, 100, 200)

    const threshold = otsuThreshold({ width: 20, height: 10, data })
    const above = [...data].filter((value) => value > threshold).length
    assert.equal(above, 100, `Schwelle ${threshold} trennt die Gruppen nicht`)
  })

  await t.test('passt sich an ein dunkles Bild an', () => {
    // Dasselbe Bild im Schatten: Die Schwelle muss mitwandern, sonst wäre eine
    // feste Zahl genauso gut.
    const dark = new Uint8ClampedArray(200)
    dark.fill(5, 0, 100)
    dark.fill(60, 100, 200)

    const threshold = otsuThreshold({ width: 20, height: 10, data: dark })
    const above = [...dark].filter((value) => value > threshold).length
    assert.equal(above, 100)
  })
})

/* ------------------------------------------------------------ Zusammenhang */

test('largestBlob', async (t) => {
  await t.test('findet den größeren von zwei Bereichen', () => {
    const mask = new Uint8Array(100)
    // Klein: 2×2 links oben.
    for (const p of [0, 1, 10, 11]) mask[p] = 1
    // Groß: 4×4 rechts unten.
    for (let y = 5; y < 9; y++) for (let x = 5; x < 9; x++) mask[y * 10 + x] = 1

    const blob = largestBlob(mask, 10, 10)
    assert.equal(blob?.size, 16)
    assert.equal(blob?.minX, 5)
    assert.equal(blob?.maxY, 8)
  })

  await t.test('eine leere Maske hat keinen Bereich', () => {
    assert.equal(largestBlob(new Uint8Array(100), 10, 10), null)
  })

  await t.test('diagonal berührende Pixel zählen nicht als verbunden', () => {
    // Vierer-Nachbarschaft: Zwei über die Ecke berührende Punkte sind zwei
    // Bereiche, nicht einer. Sonst zöge ein verrauschtes Foto alles zusammen.
    const mask = new Uint8Array(100)
    mask[0] = 1
    mask[11] = 1
    assert.equal(largestBlob(mask, 10, 10)?.size, 1)
  })

  await t.test('erkennt die Richtung einer langen Fläche', () => {
    // Ein waagerechter Balken: lange Achse waagerecht, also Winkel nahe 0.
    const mask = new Uint8Array(100)
    for (let x = 1; x < 9; x++) mask[5 * 10 + x] = 1
    assert.ok(Math.abs(largestBlob(mask, 10, 10)?.angle ?? 9) < 0.05)

    // Ein senkrechter Balken: Winkel nahe ±90°.
    const upright = new Uint8Array(100)
    for (let y = 1; y < 9; y++) upright[y * 10 + 5] = 1
    assert.ok(Math.abs(Math.abs(largestBlob(upright, 10, 10)?.angle ?? 0) - Math.PI / 2) < 0.05)
  })
})

/* ------------------------------------------------------- Bon im Bild finden */

test('findReceipt', async (t) => {
  await t.test('findet den Textblock', () => {
    const bitmap = blank(200, 200)
    receipt(bitmap, 60, 30, 60, 140)

    const blob = findReceipt(toGray(bitmap))
    assert.notEqual(blob, null)
    // Der gefundene Bereich liegt dort, wo der Block gemalt wurde — mit etwas
    // Luft, weil die Kantenenergie geglättet wird.
    assert.ok((blob?.minX ?? 0) < 70, `minX ${blob?.minX}`)
    assert.ok((blob?.maxX ?? 999) > 110, `maxX ${blob?.maxX}`)
  })

  await t.test('ignoriert ein leeres zweites Blatt', () => {
    /*
     * DER FALL AUS DEM ZWEITEN TESTFOTO: Neben dem Bon liegt ein größeres,
     * fast leeres Dokument. Über die Helligkeit wäre es die größere Fläche und
     * würde gewinnen. Über die Textdichte nicht — und genau darum wird sie
     * gemessen.
     */
    const bitmap = blank(300, 200)
    // Das große leere Blatt links: hell, aber ohne Text.
    fill(bitmap, 10, 10, 150, 180, 250)
    // Der Bon rechts: klein, aber dicht bedruckt.
    receipt(bitmap, 200, 40, 60, 120)

    const blob = findReceipt(toGray(bitmap))
    assert.notEqual(blob, null)
    // Der Schwerpunkt muss auf der rechten Seite liegen, beim Bon.
    assert.ok((blob?.centerX ?? 0) > 180, `Schwerpunkt bei x=${blob?.centerX}, erwartet > 180`)
  })

  await t.test('ein Bild ohne Text liefert nichts', () => {
    assert.equal(findReceipt(toGray(blank(100, 100))), null)
  })
})

/* ---------------------------------------------------------------- Drehen */

test('rotationFor', async (t) => {
  await t.test('ein querliegender Bon wird aufgerichtet', () => {
    const bitmap = blank(300, 200)
    receipt(bitmap, 40, 70, 220, 60, false)

    const blob = findReceipt(toGray(bitmap))
    assert.notEqual(blob, null)

    const angle = rotationFor(blob!)
    // Rund 90° — das ist der Schritt, der die 2000 px erst wirksam macht.
    assert.ok(
      Math.abs(Math.abs(angle) - Math.PI / 2) < 0.35,
      `Winkel ${((angle * 180) / Math.PI).toFixed(1)}° ist keine Vierteldrehung`,
    )
  })

  await t.test('ein aufrechter Bon bleibt aufrecht', () => {
    const bitmap = blank(200, 300)
    receipt(bitmap, 70, 40, 60, 220)

    const angle = rotationFor(findReceipt(toGray(bitmap))!)
    assert.ok(
      Math.abs(angle) < 0.35,
      `Winkel ${((angle * 180) / Math.PI).toFixed(1)}° — es sollte nicht gedreht werden`,
    )
  })
})

test('rotateBitmap', async (t) => {
  await t.test('eine Vierteldrehung tauscht die Kanten', () => {
    const turned = rotateBitmap(blank(40, 20), Math.PI / 2)
    assert.equal(turned.width, 20)
    assert.equal(turned.height, 40)
  })

  await t.test('ein Winkel von 0 kostet nichts', () => {
    const bitmap = blank(10, 10)
    assert.equal(rotateBitmap(bitmap, 0), bitmap)
  })

  await t.test('freie Ecken werden weiß, nicht schwarz', () => {
    // Schwarz würde den Kontrastausgleich danach in die Irre führen.
    const turned = rotateBitmap(blank(40, 40), Math.PI / 4)
    assert.equal(turned.data[0], 255)
    assert.equal(turned.data[3], 255)
  })

  await t.test('der Inhalt überlebt die Drehung', () => {
    const bitmap = blank(60, 20)
    fill(bitmap, 0, 0, 60, 20, 30)

    const turned = rotateBitmap(bitmap, Math.PI / 2)
    // In der Mitte muss der dunkle Inhalt liegen, nicht der weiße Rand.
    const middle = (Math.floor(turned.height / 2) * turned.width + Math.floor(turned.width / 2)) * 4
    assert.ok(turned.data[middle] < 100, `Mitte ist ${turned.data[middle]}, erwartet dunkel`)
  })
})

/* -------------------------------------------------------------- Zuschnitt */

test('crop', async (t) => {
  await t.test('schneidet den gewünschten Bereich', () => {
    const bitmap = blank(20, 20)
    fill(bitmap, 5, 5, 5, 5, 0)

    const cut = crop(bitmap, 5, 5, 5, 5)
    assert.equal(cut.width, 5)
    assert.equal(cut.height, 5)
    assert.equal(cut.data[0], 0)
  })

  await t.test('über den Rand hinaus wird gekürzt, nicht abgelehnt', () => {
    const cut = crop(blank(20, 20), -10, -10, 100, 100)
    assert.equal(cut.width, 20)
    assert.equal(cut.height, 20)
  })

  await t.test('bleibt mindestens ein Pixel groß', () => {
    const cut = crop(blank(20, 20), 19, 19, 0, 0)
    assert.ok(cut.width >= 1 && cut.height >= 1)
  })
})

/* ------------------------------------------------------------------ CLAHE */

test('clahe', async (t) => {
  await t.test('spreizt einen flauen Kontrast', () => {
    // Ein Bild, das nur zwischen 100 und 140 liegt — wie ein Bon im Schatten.
    const data = new Uint8ClampedArray(64 * 64)
    for (let i = 0; i < data.length; i++) data[i] = 100 + (i % 40)

    const result = clahe({ width: 64, height: 64, data })
    const spanBefore = 40
    const spanAfter = Math.max(...result.data) - Math.min(...result.data)
    assert.ok(spanAfter > spanBefore, `Spanne ${spanAfter} ist nicht größer als ${spanBefore}`)
  })

  await t.test('macht aus einer leeren Fläche keinen Zeichensalat', () => {
    /*
     * Der Grund für die Begrenzung: Eine gleichförmige Fläche — Papierrand ohne
     * Text — darf nicht auf den vollen Bereich gespreizt werden. Sonst wird aus
     * Rauschen sichtbare Struktur, und die liest das Modell mit.
     */
    const data = new Uint8ClampedArray(64 * 64).fill(200)
    const result = clahe({ width: 64, height: 64, data })
    assert.equal(Math.max(...result.data) - Math.min(...result.data), 0)
  })

  await t.test('behält die Maße', () => {
    const result = clahe({ width: 40, height: 70, data: new Uint8ClampedArray(2800).fill(90) })
    assert.equal(result.width, 40)
    assert.equal(result.height, 70)
  })

  await t.test('dreht die Reihenfolge nicht um', () => {
    // Dunkel bleibt dunkler als hell. Ein Kontrastausgleich, der das verletzt,
    // hat aus Text Hintergrund gemacht.
    const data = new Uint8ClampedArray(64 * 64)
    for (let i = 0; i < data.length; i++) data[i] = i < data.length / 2 ? 60 : 190

    const result = clahe({ width: 64, height: 64, data })
    assert.ok(result.data[0] <= result.data[data.length - 1])
  })
})

/* ---------------------------------------------------------------- Kacheln */

test('tileRanges', async (t) => {
  await t.test('ein normaler Bon bleibt ganz', () => {
    // 1:3 — unterhalb der Grenze.
    assert.deepEqual(tileRanges(600, 1800), [{ y: 0, height: 1800 }])
  })

  await t.test('ein sehr langer Bon wird geschnitten', () => {
    // 1:6 — darüber.
    const ranges = tileRanges(400, 2400)
    assert.ok(ranges.length >= 2 && ranges.length <= 3)
  })

  await t.test('die Kacheln überlappen sich', () => {
    const ranges = tileRanges(400, 2400)
    for (let i = 1; i < ranges.length; i++) {
      const previousEnd = ranges[i - 1].y + ranges[i - 1].height
      assert.ok(
        ranges[i].y < previousEnd,
        `Kachel ${i} beginnt bei ${ranges[i].y}, die vorige endet erst bei ${previousEnd}`,
      )
    }
  })

  await t.test('zusammen decken sie den ganzen Bon ab', () => {
    // Der eigentliche Zweck: Keine Zeile darf zwischen zwei Kacheln fallen.
    const height = 3000
    const ranges = tileRanges(400, height)
    assert.equal(ranges[0].y, 0)
    const last = ranges[ranges.length - 1]
    assert.equal(last.y + last.height, height)
  })

  await t.test('nie mehr als drei Kacheln', () => {
    // Ein absurd langer Bon: 1:40. Mehr Bilder machen den Aufruf teurer als er
    // nützt — dann muss die Auflösung reichen.
    assert.ok(tileRanges(100, 4000).length <= 3)
  })

  await t.test('keine Kachel ragt über den Rand', () => {
    for (const height of [2400, 3000, 4000, 5000]) {
      for (const range of tileRanges(400, height)) {
        assert.ok(range.y >= 0, `y=${range.y} bei Höhe ${height}`)
        assert.ok(range.y + range.height <= height, `ragt über den Rand bei Höhe ${height}`)
        assert.ok(range.height > 0)
      }
    }
  })
})

/* ------------------------------------------------------------ Verkleinern */

test('fitWithin', async (t) => {
  await t.test('behält das Seitenverhältnis', () => {
    const size = fitWithin(4000, 2000, 2000)
    assert.deepEqual(size, { width: 2000, height: 1000 })
  })

  await t.test('rechnet nicht hoch', () => {
    assert.deepEqual(fitWithin(800, 600, 2000), { width: 800, height: 600 })
  })

  await t.test('misst an der langen Kante, egal welche das ist', () => {
    assert.deepEqual(fitWithin(1000, 5000, 2000), { width: 400, height: 2000 })
  })
})

/* ---------------------------------------------------------- Kantenenergie */

test('textEnergy zeigt dort etwas, wo Text ist', () => {
  const bitmap = blank(120, 120)
  receipt(bitmap, 20, 20, 40, 80)

  const energy = textEnergy(toGray(bitmap))
  const inText = energy.data[50 * 120 + 40]
  const outside = energy.data[10 * 120 + 100]

  assert.ok(inText > outside, `im Text ${inText}, außerhalb ${outside}`)
})

/* ============================================================================
 * DIE BEIDEN FEHLER AUS DEM ERSTEN ECHTEN SCAN
 * ========================================================================== */

/**
 * Feinkörnige Struktur, wie Asphalt sie hat — deterministisch statt zufällig,
 * damit ein Fehlschlag reproduzierbar bleibt.
 */
function concrete(bitmap: Bitmap, base = 110, amplitude = 45) {
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      // Ein billiger, aber gut durchmischter Hash über die Koordinaten.
      const hash = ((x * 73856093) ^ (y * 19349663) ^ ((x + y) * 83492791)) >>> 0
      const value = base + ((hash % 1000) / 1000) * amplitude - amplitude / 2
      const p = (y * bitmap.width + x) * 4
      bitmap.data[p] = value
      bitmap.data[p + 1] = value
      bitmap.data[p + 2] = value
      bitmap.data[p + 3] = 255
    }
  }
}

test('ein Bon auf Beton', async (t) => {
  /*
   * ---------------------------------------------------------------------------
   * WAS DIESER TEST LEISTET — UND WAS NICHT
   * ---------------------------------------------------------------------------
   *
   * Er sichert, dass ein strukturierter dunkler Hintergrund den Bon nicht
   * verdrängt. Das ist die Lage auf dem echten Foto: Bon auf Gehwegplatte.
   *
   * **Er belegt aber nicht, dass die Helligkeitsschwelle in `findReceipt` nötig
   * ist.** Ich habe es nachgemessen: Auch die Fassung ohne sie besteht diesen
   * Test — synthetisches Korn ist richtungslos und zieht die Hauptachse nicht,
   * egal wie grob es ist. Die Helligkeit ist damit eine begründete Vorsichts-
   * maßnahme gegen echten Asphalt und keine nachgewiesene Reparatur.
   *
   * Wer sie später entfernen will, hat von diesem Test keinen Widerspruch zu
   * erwarten. Der Fehler, der auf dem echten Foto nachweislich zugeschlagen hat,
   * war ein anderer — siehe `rotatedBounds` weiter unten.
   */
  const bitmap = blank(240, 200)
  concrete(bitmap)
  // Der Bon: helles Papier, quer liegend, mit Textzeilen darauf.
  fill(bitmap, 30, 80, 180, 50, 245)
  receipt(bitmap, 30, 80, 180, 50, false)

  const blob = findReceipt(toGray(bitmap))

  await t.test('wird gefunden und nicht der Gehweg', () => {
    assert.notEqual(blob, null)
    // Der Schwerpunkt muss im Bon liegen, nicht in der Bildmitte des Betons.
    assert.ok((blob?.centerY ?? 0) > 70, `Schwerpunkt y=${blob?.centerY}, erwartet > 70`)
    assert.ok((blob?.centerY ?? 999) < 140, `Schwerpunkt y=${blob?.centerY}, erwartet < 140`)
  })

  await t.test('und wird aufgerichtet', () => {
    const angle = rotationFor(blob!)
    assert.ok(
      Math.abs(Math.abs(angle) - Math.PI / 2) < 0.35,
      `Winkel ${((angle * 180) / Math.PI).toFixed(1)}° — der Bon liegt quer und müsste aufgerichtet werden`,
    )
  })
})

test('ein füllendes Bild ohne dunklen Hintergrund', () => {
  /*
   * Die Gegenprobe zur Helligkeitsschwelle: Füllt der Bon das ganze Bild, gibt
   * es keinen dunklen Hintergrund, gegen den er sich abheben könnte. Dann darf
   * die Helligkeit nicht plötzlich Text von Papier trennen und das halbe Papier
   * verwerfen — dafür ist der Rückfall auf die Kantendichte da.
   */
  const bitmap = blank(200, 300)
  receipt(bitmap, 10, 10, 180, 280)

  const blob = findReceipt(toGray(bitmap))
  assert.notEqual(blob, null)
  assert.ok((blob?.size ?? 0) > 200 * 300 * 0.3, `nur ${blob?.size} Pixel gefunden`)
})

test('rotatedBounds statt zweiter Suche', async (t) => {
  /*
   * DER ZWEITE FEHLER AUS DEM ERSTEN ECHTEN SCAN. Nach dem Drehen wurde noch
   * einmal gesucht — aber das Drehen erzeugt selbst die stärkste Kante im Bild:
   * die Grenze zwischen der weißen Eckenfüllung und dem Foto. Sie umläuft das
   * ganze Bild, gewinnt jeden Flächenvergleich, und der Rahmen war danach das
   * gesamte Bild. Zugeschnitten wurde also gar nicht.
   */
  await t.test('ohne Drehung bleibt der Rahmen, wo er war', () => {
    const bounds = rotatedBounds(
      { minX: 10, minY: 20, maxX: 30, maxY: 40 },
      1,
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      0,
    )
    assert.deepEqual(bounds, { minX: 10, minY: 20, maxX: 30, maxY: 40 })
  })

  await t.test('eine Vierteldrehung dreht auch den Rahmen mit', () => {
    // Ein breiter, flacher Rahmen wird zu einem schmalen, hohen.
    const bounds = rotatedBounds(
      { minX: 10, minY: 40, maxX: 90, maxY: 60 },
      1,
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      Math.PI / 2,
    )
    assert.ok(
      bounds.maxY - bounds.minY > bounds.maxX - bounds.minX,
      `Rahmen ist ${bounds.maxX - bounds.minX}×${bounds.maxY - bounds.minY}, erwartet hochkant`,
    )
  })

  await t.test('der Maßstab von der Analyse auf die Arbeitskopie', () => {
    const bounds = rotatedBounds(
      { minX: 10, minY: 10, maxX: 20, maxY: 20 },
      2,
      { width: 200, height: 200 },
      { width: 200, height: 200 },
      0,
    )
    assert.deepEqual(bounds, { minX: 20, minY: 20, maxX: 40, maxY: 40 })
  })

  await t.test('der Rahmen bleibt im Bild', () => {
    const bounds = rotatedBounds(
      { minX: 0, minY: 0, maxX: 99, maxY: 99 },
      1,
      { width: 100, height: 100 },
      { width: 142, height: 142 },
      Math.PI / 4,
    )
    assert.ok(bounds.minX >= 0 && bounds.minY >= 0)
    assert.ok(bounds.maxX <= 141 && bounds.maxY <= 141)
  })

  await t.test('der Bon liegt nach dem Drehen wirklich in diesem Rahmen', () => {
    /*
     * Die eigentliche Zusicherung, und sie prüft Rechnung gegen Wirklichkeit:
     * Der berechnete Rahmen wird gegen das tatsächlich gedrehte Bild gehalten.
     * Läge er daneben, würde der Zuschnitt den Bon anschneiden.
     */
    const bitmap = blank(200, 140)
    fill(bitmap, 20, 50, 160, 40, 30)

    const angle = Math.PI / 2
    const turned = rotateBitmap(bitmap, angle)
    const bounds = rotatedBounds(
      { minX: 20, minY: 50, maxX: 179, maxY: 89 },
      1,
      bitmap,
      turned,
      angle,
    )

    // In der Mitte des berechneten Rahmens muss der dunkle Inhalt liegen.
    const cx = Math.round((bounds.minX + bounds.maxX) / 2)
    const cy = Math.round((bounds.minY + bounds.maxY) / 2)
    const p = (cy * turned.width + cx) * 4
    assert.ok(turned.data[p] < 100, `Rahmenmitte ist ${turned.data[p]}, erwartet dunkel`)

    // Und knapp außerhalb darf er nicht mehr liegen.
    const outside = ((bounds.minY > 4 ? bounds.minY - 4 : 0) * turned.width + cx) * 4
    assert.ok(turned.data[outside] > 150, 'der Rahmen ist zu groß geraten')
  })
})

test('cropToReceipt schneidet nie in den Bon hinein', async (t) => {
  /*
   * Die ungleichen Kosten: Etwas Gehweg zu viel kostet Bildpunkte, eine
   * abgeschnittene Zeile kostet einen Betrag — und wenn es die unterste ist,
   * die Gesamtsumme.
   */
  await t.test('der gefundene Rahmen bleibt vollständig erhalten', () => {
    const bitmap = blank(400, 600)
    const bounds = { minX: 100, minY: 150, maxX: 300, maxY: 500 }
    const cut = cropToReceipt(bitmap, bounds)

    // Breiter und höher als der Rahmen — also mit Luft ringsum.
    assert.ok(cut.width > bounds.maxX - bounds.minX, `Breite ${cut.width} zu knapp`)
    assert.ok(cut.height > bounds.maxY - bounds.minY, `Höhe ${cut.height} zu knapp`)
  })

  await t.test('bei einem langen Bon ist der Rand großzügig', () => {
    // 400 × 2000: Der Rand richtet sich nach der langen Kante, weil oben und
    // unten Kopf- und Summenzeile stehen.
    const bitmap = blank(1000, 3000)
    const cut = cropToReceipt(bitmap, { minX: 300, minY: 400, maxX: 700, maxY: 2400 })
    assert.ok(cut.width >= 400 + 100, `Breite ${cut.width}, erwartet mindestens 500`)
    assert.ok(cut.height >= 2000 + 100, `Höhe ${cut.height}, erwartet mindestens 2100`)
  })

  await t.test('ein Rahmen am Bildrand wird gekürzt statt abgelehnt', () => {
    const cut = cropToReceipt(blank(200, 200), { minX: 0, minY: 0, maxX: 199, maxY: 199 })
    assert.equal(cut.width, 200)
    assert.equal(cut.height, 200)
  })
})
