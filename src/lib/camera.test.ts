import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EDGE, fitWithin } from './camera.ts'

/**
 * `fitWithin` ist der einzige Teil der Kamera, der sich ohne Browser prüfen
 * lässt – und der einzige, in dem gerechnet wird. Alles andere (Kamerastrom,
 * Canvas, EXIF-Drehung) braucht ein echtes Gerät.
 */
describe('fitWithin', () => {
  test('lässt kleine Bilder unangetastet – Hochrechnen bringt keine Schärfe', () => {
    assert.deepEqual(fitWithin(1200, 1600), { width: 1200, height: 1600 })
    assert.deepEqual(fitWithin(2000, 1500), { width: 2000, height: 1500 })
  })

  test('verkleinert die lange Kante auf 2000 px, egal ob hoch oder quer', () => {
    assert.deepEqual(fitWithin(3024, 4032), { width: 1500, height: 2000 })
    assert.deepEqual(fitWithin(4032, 3024), { width: 2000, height: 1500 })
  })

  test('behält das Seitenverhältnis – ein Bon wird nicht quadratisch', () => {
    const bon = fitWithin(1200, 6000)
    assert.deepEqual(bon, { width: 400, height: 2000 })
    assert.equal(bon.height / bon.width, 5)
  })

  test('lange Kante trifft die Vorgabe genau', () => {
    for (const [width, height] of [
      [4032, 3024],
      [3024, 4032],
      [8000, 1000],
      [2001, 2001],
    ]) {
      assert.equal(Math.max(...Object.values(fitWithin(width, height))), MAX_EDGE)
    }
  })

  test('rundet nie auf null – ein extrem schmales Bild behält eine Kante', () => {
    assert.deepEqual(fitWithin(3, 90000), { width: 1, height: 2000 })
  })
})
