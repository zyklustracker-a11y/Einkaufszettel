import test from 'node:test'
import assert from 'node:assert/strict'
import type { ExtractionPhase } from './extraction.ts'
import {
  advanceProgress,
  CHECK_CEILING,
  COMPLETE,
  EXPECTED_MS,
  estimateProgress,
  PROGRESS_STEPS,
  WAIT_CEILING,
} from './progress.ts'

/**
 * Tests für den geschätzten Fortschritt.
 *
 * Der Balken darf schätzen — lügen darf er nicht. Genau die drei Zusicherungen,
 * die das ausmachen, stehen hier: nie rückwärts, Halt bei 95 %, solange die
 * Antwort aussteht, und 100 % erst mit dem Ergebnis.
 */

/** Der Takt des Screens, in dem auch die Simulationen unten laufen. */
const TICK = 100

/**
 * Spielt einen Durchlauf ab und gibt zurück, was der Balken dabei angezeigt hat.
 *
 * Genau die Kette, die auch der Screen fährt: `advanceProgress` mit dem
 * bisherigen Stand, alle 100 ms, über alle drei Abschnitte.
 */
function run(durations: Record<ExtractionPhase, number>): {
  shown: number[]
  afterPhase: Record<ExtractionPhase, number>
} {
  const shown: number[] = []
  const afterPhase = {} as Record<ExtractionPhase, number>
  let current = 0

  for (const step of PROGRESS_STEPS) {
    for (let elapsed = 0; elapsed <= durations[step.phase]; elapsed += TICK) {
      current = advanceProgress(current, step.phase, elapsed)
      shown.push(current)
    }
    afterPhase[step.phase] = current
  }

  return { shown, afterPhase }
}

/* ------------------------------------------------- die drei Beispielverläufe */

test('Beispielverläufe', async (t) => {
  await t.test('Normalfall: 14 s Modellaufruf ergibt 5 → 95 → 99', () => {
    const { afterPhase } = run({ vorbereiten: 800, senden: 14_000, auswerten: 700 })
    assert.equal(Math.round(afterPhase.vorbereiten), 5)
    assert.equal(Math.round(afterPhase.senden), 95)
    assert.equal(Math.round(afterPhase.auswerten), 99)
  })

  await t.test('Langsam: bei 45 s wartet er die ganze Zeit auf 95 %', () => {
    const { shown } = run({ vorbereiten: 800, senden: 45_000, auswerten: 0 })
    assert.equal(Math.round(Math.max(...shown)), WAIT_CEILING)

    // Und zwar wirklich wartend: Ab der erwarteten Dauer bewegt sich nichts mehr.
    const beiErwartung = estimateProgress('senden', EXPECTED_MS.senden)
    const vielSpaeter = estimateProgress('senden', EXPECTED_MS.senden * 5)
    assert.equal(beiErwartung, vielSpaeter)
    assert.equal(beiErwartung, WAIT_CEILING)
  })

  await t.test('Schnell: nach 4 s steht er bei 31 % und springt dann', () => {
    const nachVierSekunden = advanceProgress(5, 'senden', 4_000)
    assert.equal(Math.round(nachVierSekunden), 31)

    // Sobald die Antwort da ist, beginnt der nächste Abschnitt bei 95 %.
    const beimEintreffen = advanceProgress(nachVierSekunden, 'auswerten', 0)
    assert.equal(beimEintreffen, WAIT_CEILING)
  })
})

/* ------------------------------------------------------------ nie rückwärts */

test('läuft nie rückwärts', async (t) => {
  await t.test('über einen vollständigen Durchlauf', () => {
    const { shown } = run({ vorbereiten: 800, senden: 20_000, auswerten: 700 })
    for (let i = 1; i < shown.length; i++) {
      assert.ok(shown[i] >= shown[i - 1], `Takt ${i}: ${shown[i]} < ${shown[i - 1]}`)
    }
  })

  await t.test('auch wenn ein Abschnitt früher endet als geschätzt', () => {
    // Endet `vorbereiten` nach 10 ms, steht der Balken bei fast 0. Der nächste
    // Abschnitt beginnt trotzdem bei seinem `from` — ein Sprung nach vorn.
    const frueh = advanceProgress(0, 'vorbereiten', 10)
    assert.ok(frueh < 1)
    assert.equal(advanceProgress(frueh, 'senden', 0), 5)
  })

  await t.test('auch bei einem verspäteten Takt aus dem vorigen Abschnitt', () => {
    // Der Screen ist längst bei `auswerten`; ein Nachzügler aus `senden` darf
    // den Stand nicht wieder herunterziehen.
    const stand = advanceProgress(0, 'auswerten', 0)
    assert.equal(advanceProgress(stand, 'senden', 1_000), stand)
  })

  await t.test('auch bei unsinnigen Eingaben', () => {
    assert.equal(advanceProgress(50, 'senden', -5_000), 50)
    assert.ok(estimateProgress('senden', -5_000) >= 0)
  })
})

/* ------------------------------------------- 100 % erst mit dem Ergebnis */

test('erreicht 100 % erst mit dem Ergebnis', async (t) => {
  await t.test('die Schätzung selbst kommt nie auf 100', () => {
    for (const step of PROGRESS_STEPS) {
      for (const elapsed of [0, 500, 5_000, 60_000, 600_000]) {
        const value = estimateProgress(step.phase, elapsed)
        assert.ok(
          value <= CHECK_CEILING,
          `${step.phase} nach ${elapsed} ms: ${value} > ${CHECK_CEILING}`,
        )
      }
    }
    assert.ok(CHECK_CEILING < COMPLETE)
  })

  await t.test('auch ein sehr langer Durchlauf bleibt darunter', () => {
    const { shown } = run({ vorbereiten: 5_000, senden: 120_000, auswerten: 5_000 })
    assert.equal(Math.max(...shown), CHECK_CEILING)
    assert.ok(Math.max(...shown) < COMPLETE)
  })

  await t.test('solange die Antwort aussteht, ist bei 95 % Schluss', () => {
    // `auswerten` läuft erst, wenn die Antwort da ist. Alles davor ist gedeckelt.
    const { shown } = run({ vorbereiten: 5_000, senden: 120_000, auswerten: 0 })
    assert.equal(Math.max(...shown), WAIT_CEILING)
  })
})

/* ------------------------------------------------------------ die Bereiche */

test('die Prozentbereiche', async (t) => {
  await t.test('schließen lückenlos aneinander an', () => {
    for (let i = 1; i < PROGRESS_STEPS.length; i++) {
      assert.equal(PROGRESS_STEPS[i].from, PROGRESS_STEPS[i - 1].to)
    }
    assert.equal(PROGRESS_STEPS[0].from, 0)
    assert.equal(PROGRESS_STEPS[PROGRESS_STEPS.length - 1].to, CHECK_CEILING)
  })

  await t.test('sind nach der erwarteten Dauer gewichtet', () => {
    // Der längste Abschnitt muss auch den größten Bereich haben, sonst stünde
    // der Balken die meiste Zeit still.
    const total = Object.values(EXPECTED_MS).reduce((sum, ms) => sum + ms, 0)
    for (const step of PROGRESS_STEPS) {
      const anteilZeit = EXPECTED_MS[step.phase] / total
      const anteilBalken = (step.to - step.from) / CHECK_CEILING
      assert.ok(
        Math.abs(anteilZeit - anteilBalken) < 0.03,
        `${step.phase}: ${(anteilZeit * 100).toFixed(0)} % der Zeit, aber ` +
          `${(anteilBalken * 100).toFixed(0)} % des Balkens`,
      )
    }
  })
})
