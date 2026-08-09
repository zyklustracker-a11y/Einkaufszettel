import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, euro, monthName } from './report.ts'
import type { ReportNumbers } from './report.ts'

/** Ein Monat ohne Besonderheiten — die Abweichungen setzen die Tests selbst. */
function numbers(overrides: Partial<ReportNumbers> = {}): ReportNumbers {
  return {
    month: '2026-08-01',
    foodCents: 31250,
    diningCents: 4300,
    nonfoodCents: 2450,
    totalCents: 38000,
    receiptCount: 12,
    budgetCents: 0,
    previousTotalCents: 0,
    topProductName: null,
    topProductCents: 0,
    savingsExcessCents: 0,
    ...overrides,
  }
}

test('Beträge und Monate', async (t) => {
  await t.test('deutsche Schreibweise mit Tausenderpunkt', () => {
    assert.equal(euro(38000), '380,00 €')
    assert.equal(euro(123456), '1.234,56 €')
    assert.equal(euro(5), '0,05 €')
    assert.equal(euro(0), '0,00 €')
    assert.equal(euro(-250), '−2,50 €')
  })

  await t.test('Monatsnamen ohne Zeitzonen-Umweg', () => {
    // `Intl` mit einer Zeitzone im Rücken könnte den 1. August als 31. Juli
    // lesen. Hier wird die Zeichenkette zerlegt, und mehr passiert nicht.
    assert.equal(monthName('2026-08-01'), 'August 2026')
    assert.equal(monthName('2026-01-01'), 'Januar 2026')
    assert.equal(monthName('2025-12-01'), 'Dezember 2025')
  })
})

test('Monatsreport', async (t) => {
  await t.test('Titel ist Monat und Summe', () => {
    assert.equal(buildReport(numbers()).title, 'August 2026: 380,00 €')
  })

  await t.test('ohne Budget und ohne Vormonat bleibt es bei den Zahlen', () => {
    assert.equal(buildReport(numbers()).body, '12 Einkäufe · Lebensmittel 312,50 €')
  })

  await t.test('ein gerissenes Budget ist die wichtigste Nachricht', () => {
    const report = buildReport(numbers({ budgetCents: 35000, previousTotalCents: 20000 }))
    assert.ok(report.body.endsWith('30,00 € über Budget'), report.body)
    // Der Vormonatsvergleich steht dann ausdrücklich NICHT zusätzlich da.
    assert.ok(!report.body.includes('Vormonat'))
  })

  await t.test('unter Budget wird genauso gesagt', () => {
    assert.ok(buildReport(numbers({ budgetCents: 45000 })).body.endsWith('70,00 € unter Budget'))
  })

  await t.test('ohne Budget wird mit dem Vormonat verglichen', () => {
    assert.ok(
      buildReport(numbers({ previousTotalCents: 30000 })).body.endsWith(
        '80,00 € mehr als im Vormonat',
      ),
    )
    assert.ok(
      buildReport(numbers({ previousTotalCents: 42000 })).body.endsWith(
        '40,00 € weniger als im Vormonat',
      ),
    )
  })

  await t.test('ein leerer Vormonat wird nicht verglichen', () => {
    // „100 % mehr als im Vormonat" wäre richtig gerechnet und trotzdem Unsinn.
    const report = buildReport(numbers({ previousTotalCents: 0, topProductName: 'Rinderfilet' }))
    assert.ok(!report.body.includes('Vormonat'))
    assert.ok(report.body.endsWith('am teuersten: Rinderfilet'))
  })

  await t.test('ein einzelner Einkauf steht im Singular', () => {
    assert.ok(buildReport(numbers({ receiptCount: 1 })).body.startsWith('1 Einkauf ·'))
  })
})
