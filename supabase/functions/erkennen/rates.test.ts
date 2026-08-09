import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ecbUrl,
  isIsoDate,
  parseEcbCsv,
  pickObservation,
  resolveExchangeRate,
  shiftDays,
  toEuroRate,
  toForeignCurrency,
} from './rates.ts'
import type { EcbObservation, RateStore } from './rates.ts'

/**
 * Die Zeilen stammen wörtlich aus einer echten Antwort der EZB
 * (`D.CHF.EUR.SP00.A`, Ende Juli / Anfang August 2026), gekürzt auf die
 * Spalten, die vorkommen müssen. Der 1. und 2. August fehlen darin — das war
 * ein Wochenende, und genau darum geht es weiter unten.
 */
const CSV = [
  'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE',
  'EXR.D.CHF.EUR.SP00.A,D,CHF,EUR,SP00,A,2026-07-30,0.9324,A,"Swiss franc/Euro, 2.15 pm (C.E.T.)"',
  'EXR.D.CHF.EUR.SP00.A,D,CHF,EUR,SP00,A,2026-07-31,0.9304,A,"Swiss franc/Euro, 2.15 pm (C.E.T.)"',
  'EXR.D.CHF.EUR.SP00.A,D,CHF,EUR,SP00,A,2026-08-03,0.932,A,"Swiss franc/Euro, 2.15 pm (C.E.T.)"',
  'EXR.D.CHF.EUR.SP00.A,D,CHF,EUR,SP00,A,2026-08-04,0.9319,A,"Swiss franc/Euro, 2.15 pm (C.E.T.)"',
].join('\n')

test('parseEcbCsv', async (t) => {
  await t.test('holt Datum und Kurs heraus', () => {
    const rows = parseEcbCsv(CSV)
    assert.equal(rows.length, 4)
    assert.deepEqual(rows[0], { date: '2026-07-30', perEuro: 0.9324 })
    assert.deepEqual(rows[3], { date: '2026-08-04', perEuro: 0.9319 })
  })

  await t.test('sucht die Spalten über die Kopfzeile, nicht über feste Nummern', () => {
    // Dieselben Daten, andere Spaltenreihenfolge. Die EZB darf ihre
    // Metadatenspalten jederzeit umsortieren — ein Kurs aus der falschen Spalte
    // wäre der teuerste denkbare Fehler.
    const vertauscht = [
      'OBS_VALUE,TIME_PERIOD,KEY',
      '0.9324,2026-07-30,EXR.D.CHF.EUR.SP00.A',
    ].join('\n')
    assert.deepEqual(parseEcbCsv(vertauscht), [{ date: '2026-07-30', perEuro: 0.9324 }])
  })

  await t.test('überspringt Zeilen ohne Beobachtung', () => {
    // Eine Zeile ohne Wert ist eine Lücke und keine Null.
    const mitLuecke = [
      'TIME_PERIOD,OBS_VALUE',
      '2026-07-30,0.9324',
      '2026-08-01,',
      '2026-08-02,0',
    ].join('\n')
    assert.deepEqual(parseEcbCsv(mitLuecke), [{ date: '2026-07-30', perEuro: 0.9324 }])
  })

  await t.test('bleibt bei einer unbrauchbaren Antwort still', () => {
    assert.deepEqual(parseEcbCsv(''), [])
    assert.deepEqual(parseEcbCsv('irgendein Fehlertext'), [])
    assert.deepEqual(parseEcbCsv('SPALTE_A,SPALTE_B\n1,2'), [])
  })

  await t.test('sortiert aufsteigend, egal wie die Antwort kommt', () => {
    const verdreht = ['TIME_PERIOD,OBS_VALUE', '2026-08-04,0.9319', '2026-07-30,0.9324'].join('\n')
    assert.deepEqual(
      parseEcbCsv(verdreht).map((row) => row.date),
      ['2026-07-30', '2026-08-04'],
    )
  })
})

test('pickObservation', async (t) => {
  const rows = parseEcbCsv(CSV)

  await t.test('nimmt den Kurs des Bon-Tages, wenn es einen gibt', () => {
    assert.equal(pickObservation(rows, '2026-08-03')?.date, '2026-08-03')
  })

  await t.test('nimmt am Wochenende den letzten Werktag davor', () => {
    // Der 1. August 2026 ist ein Samstag: Es gilt der Freitag, der 31. Juli.
    assert.equal(pickObservation(rows, '2026-08-01')?.date, '2026-07-31')
    assert.equal(pickObservation(rows, '2026-08-02')?.date, '2026-07-31')
  })

  await t.test('nimmt nie einen Kurs von nach dem Bon-Datum', () => {
    // Er hätte am Bontag noch gar nicht existiert.
    assert.equal(pickObservation(rows, '2026-07-29'), null)
  })

  await t.test('gibt ohne Beobachtungen null zurück', () => {
    assert.equal(pickObservation([], '2026-08-03'), null)
  })
})

test('toEuroRate dreht die Richtung um', () => {
  // Die EZB veröffentlicht „Franken je Euro"; gerechnet wird „Betrag × Kurs =
  // Euro", also mit dem Kehrwert.
  assert.equal(toEuroRate(0.9347), 1.069862)
  assert.equal(toEuroRate(1), 1)

  // Und die Probe, auf die es ankommt: 45,00 CHF werden zu 48,14 €.
  assert.equal(Math.round(4500 * toEuroRate(0.9347)), 4814)
})

test('toForeignCurrency', async (t) => {
  await t.test('nimmt einen Dreibuchstaben-Code an', () => {
    assert.equal(toForeignCurrency('chf'), 'CHF')
    assert.equal(toForeignCurrency(' USD '), 'USD')
  })

  await t.test('lehnt Euro ab', () => {
    // Für Euro gibt es nichts zu holen, und ein Kurs von 1,0 wäre eine Zahl
    // ohne Aussage.
    assert.equal(toForeignCurrency('EUR'), null)
  })

  await t.test('lehnt alles ab, was kein Code ist', () => {
    assert.equal(toForeignCurrency('Fr.'), null)
    assert.equal(toForeignCurrency(''), null)
    assert.equal(toForeignCurrency(null), null)
    assert.equal(toForeignCurrency(42), null)
  })
})

test('shiftDays und isIsoDate', async (t) => {
  await t.test('rechnet über Monats- und Jahresgrenzen', () => {
    assert.equal(shiftDays('2026-08-09', -14), '2026-07-26')
    assert.equal(shiftDays('2026-01-05', -14), '2025-12-22')
    assert.equal(shiftDays('2024-03-01', -1), '2024-02-29')
  })

  await t.test('lässt nur Daten durch, die es gibt', () => {
    assert.equal(isIsoDate('2026-08-09'), true)
    assert.equal(isIsoDate('2026-02-31'), false)
    assert.equal(isIsoDate('09.08.2026'), false)
  })
})

test('ecbUrl', () => {
  assert.equal(
    ecbUrl('CHF', '2026-07-26', '2026-08-09'),
    'https://data-api.ecb.europa.eu/service/data/EXR/D.CHF.EUR.SP00.A' +
      '?startPeriod=2026-07-26&endPeriod=2026-08-09&format=csvdata',
  )
})

/* ------------------------------------------------------------ Der Ablauf */

/**
 * Ein Zwischenspeicher zum Zusehen: Er merkt sich, was gelesen und geschrieben
 * wurde. Damit lässt sich prüfen, was diese Datei verspricht — derselbe Tag
 * wird nicht zweimal bei der EZB abgefragt.
 */
function fakeStore(seed: Record<string, number> = {}) {
  const rows = new Map<string, number>(Object.entries(seed))
  const writes: EcbObservation[][] = []

  const store: RateStore = {
    read: (currency, onDate) => Promise.resolve(rows.get(`${currency}:${onDate}`) ?? null),
    write: (currency, observations) => {
      writes.push(observations)
      for (const observation of observations) {
        const key = `${currency}:${observation.date}`
        // „Ein einmal gespeicherter Tag wird nie überschrieben" — wie
        // `on conflict do nothing` in der Datenbank.
        if (!rows.has(key)) rows.set(key, toEuroRate(observation.perEuro))
      }
      return Promise.resolve()
    },
  }

  return { store, writes, rows }
}

test('resolveExchangeRate', async (t) => {
  await t.test('nimmt den zwischengespeicherten Kurs, ohne zu fragen', async () => {
    const { store, writes } = fakeStore({ 'CHF:2026-08-07': 1.069862 })
    const outcome = await resolveExchangeRate(store, 'CHF', '2026-08-07')

    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.ok && outcome.value, { rate: 1.069862, rateDate: '2026-08-07' })
    // Kein Schreibvorgang heißt hier: Es gab auch keinen Abruf.
    assert.equal(writes.length, 0)
  })

  await t.test('lehnt Euro ab, ohne irgendetwas zu tun', async () => {
    const { store, writes } = fakeStore()
    const outcome = await resolveExchangeRate(store, 'EUR', '2026-08-07')

    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.failure.code, 'waehrung_unbekannt')
    assert.equal(writes.length, 0)
  })

  await t.test('lehnt ein unmögliches Datum ab', async () => {
    const { store } = fakeStore()
    const outcome = await resolveExchangeRate(store, 'CHF', '2026-02-31')
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.failure.code, 'kein_kurs')
  })

  await t.test('jeder Fehlschlag trägt einen fertigen deutschen Satz', async () => {
    // Der Korrektur-Screen zeigt ihn wörtlich an — eine technische Meldung
    // erreicht die Oberfläche nie.
    const { store } = fakeStore()
    const outcome = await resolveExchangeRate(store, 'EUR', '2026-08-07')
    assert.equal(outcome.ok, false)
    assert.match(!outcome.ok ? outcome.failure.message : '', /Kurs für diesen Bon von Hand/)
  })
})
