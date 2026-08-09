import test from 'node:test'
import assert from 'node:assert/strict'
import { EXPECTED_MS, estimateProgress } from './progress.ts'
import { SAMPLE_LIMIT, expectedFrom, median, withSample } from './timing.ts'

/**
 * Die Selbstjustierung des Fortschrittsbalkens.
 *
 * `EXPECTED_MS` war geraten; die tatsächliche Dauer meldet die Edge Function bei
 * jedem Scan. Was hier geprüft wird, ist die Rechnung dazwischen — sie ist rein
 * und fasst `localStorage` nicht an, genau damit diese Tests ohne Browser
 * laufen.
 */

test('Median', async (t) => {
  await t.test('ungerade Anzahl: der mittlere Wert', () => {
    assert.equal(median([9, 1, 5]), 5)
  })

  await t.test('gerade Anzahl: das gerundete Mittel der beiden mittleren', () => {
    assert.equal(median([1, 2, 3, 5]), 3)
  })

  await t.test('leer ist null und nicht 0', () => {
    // 0 wäre eine Dauer und damit eine Behauptung.
    assert.equal(median([]), null)
  })

  await t.test('ein Ausreißer verschiebt ihn nicht', () => {
    // Genau dafür steht hier der Median und nicht der Mittelwert: Ein Scan im
    // Funkloch soll den Balken nicht für die nächsten zehn Scans träge machen.
    assert.equal(median([14_000, 13_000, 15_000, 14_500, 55_000]), 14_500)
  })
})

test('Messreihen', async (t) => {
  await t.test('hängt an und behält nur die letzten acht', () => {
    let samples = {}
    for (let i = 1; i <= SAMPLE_LIMIT + 4; i++) {
      samples = withSample(samples, 'lesen', 1000 + i)
    }

    const values = (samples as { lesen: number[] }).lesen
    assert.equal(values.length, SAMPLE_LIMIT)
    assert.equal(values[0], 1005, 'die ältesten Messungen fallen heraus')
    assert.equal(values[values.length - 1], 1012)
  })

  await t.test('verwirft, was kein Alltag sein kann', () => {
    // 50 ms: da war kein Modell im Spiel. 90 s: das war ein Funkloch.
    assert.deepEqual(withSample({}, 'lesen', 50), {})
    assert.deepEqual(withSample({}, 'lesen', 90_000), {})
    assert.deepEqual(withSample({}, 'lesen', Number.NaN), {})
  })
})

test('Erwartete Dauern', async (t) => {
  await t.test('ohne Messungen gilt die Voreinstellung', () => {
    assert.deepEqual(expectedFrom({}), EXPECTED_MS)
  })

  await t.test('unter drei Messungen bleibt es bei der Voreinstellung', () => {
    // Bei einer einzigen wäre die „Schätzung" schlicht der letzte Scan.
    assert.equal(expectedFrom({ lesen: [9000, 9000] }).lesen, EXPECTED_MS.lesen)
  })

  await t.test('ab drei Messungen zählt der Median', () => {
    assert.equal(expectedFrom({ lesen: [9000, 8000, 10_000] }).lesen, 9000)
  })

  await t.test('jede Phase für sich', () => {
    const expected = expectedFrom({ lesen: [9000, 9000, 9000] })
    assert.equal(expected.lesen, 9000)
    assert.equal(expected.zuordnen, EXPECTED_MS.zuordnen)
  })

  await t.test('der Balken rechnet damit', () => {
    // Bei halber erwarteter Dauer steht er in der Mitte seines Abschnitts —
    // egal, ob die Dauer geschätzt oder gemessen ist.
    const expected = expectedFrom({ lesen: [6000, 6000, 6000] })
    assert.equal(estimateProgress('lesen', 3000, expected), estimateProgress('lesen', EXPECTED_MS.lesen / 2))
  })
})
